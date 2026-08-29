import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Capacitor } from "@capacitor/core";
import { Camera as CapacitorCamera } from "@capacitor/camera";
import { NativePurchases, PURCHASE_TYPE } from "@capgo/native-purchases";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Camera, Clock, XCircle, CheckCircle2, CreditCard, Upload, Crown } from "lucide-react";

const ID_VERIFICATION_GOOGLE_PRODUCT_ID = "id_verification_fee";

/** Opens the device's native camera directly (not a chooser between
 *  camera/gallery — the HTML file input's capture="user" attribute is
 *  only ever a *hint*, and Android's WebView doesn't reliably honor it,
 *  which is exactly why this exists instead). Returns null if the user
 *  cancels or camera access is denied. */
async function capturePhoto(): Promise<File | null> {
  try {
    const photo = await CapacitorCamera.takePhoto({ quality: 85 });
    if (!photo.webPath) return null;
    const response = await fetch(photo.webPath);
    const blob = await response.blob();
    return new File([blob], `selfie-${Date.now()}.jpg`, { type: blob.type || "image/jpeg" });
  } catch {
    return null;
  }
}

interface SubmissionStatus {
  id: string;
  verification_type: "photo" | "id";
  status: "pending" | "approved" | "rejected";
  rejection_reason: string | null;
  created_at: string;
}

interface VerificationStatusResponse {
  photo: SubmissionStatus | null;
  id: SubmissionStatus | null;
}

export function VerificationSection() {
  const { token } = useAuth();
  const { toast } = useToast();

  const [status, setStatus] = useState<VerificationStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasPaidForId, setHasPaidForId] = useState(false);
  const [isFounderEligible, setIsFounderEligible] = useState(false);
  const [isPaying, setIsPaying] = useState(false);
  const [isSubmittingPhoto, setIsSubmittingPhoto] = useState(false);
  const [isSubmittingId, setIsSubmittingId] = useState(false);
  const [showIdForm, setShowIdForm] = useState(false);
  const [submitFailed, setSubmitFailed] = useState(false);
  const [isRequestingRefund, setIsRequestingRefund] = useState(false);
  // The fee used to be shown constantly — a badge next to the section
  // title, plus baked directly into the button text ("Pay R99 to
  // Start") — visible the whole time someone is just looking at their
  // profile, before they've expressed any intent to pay. Now the price
  // only ever appears inside this confirmation step, after they've
  // already tapped a neutral "Start Verification" button.
  const [showPaymentConfirm, setShowPaymentConfirm] = useState(false);

  // Computed once — the only thing that decides which payment path
  // shows. PayFast must never render inside the native app shell.
  const isNative = useMemo(() => Capacitor.isNativePlatform(), []);
  const [nativePrice, setNativePrice] = useState<string | null>(null);
  // The web-path equivalent of nativePrice — previously this whole
  // section had "R99" hardcoded directly in three separate places
  // (badge, button, and the post-failure notice), completely
  // disconnected from id_verification_fee_zar, the actual admin-
  // configurable value. Changing the price in the dashboard silently
  // had zero effect here. Fetched from /api/app-settings, which already
  // returns every app_settings row (including this one) unfiltered —
  // no new backend endpoint needed.
  const [webPriceZar, setWebPriceZar] = useState<number | null>(null);

  const [idFrontFile, setIdFrontFile] = useState<File | null>(null);
  const [idBackFile, setIdBackFile] = useState<File | null>(null);
  const [idSelfieFile, setIdSelfieFile] = useState<File | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const [statusRes, paymentRes] = await Promise.all([
        fetch("/api/verification/status", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/verification/id/payment-status", { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (statusRes.ok) setStatus(await statusRes.json());
      if (paymentRes.ok) {
        const paymentBody = await paymentRes.json();
        setHasPaidForId(paymentBody.hasPaid);
        setIsFounderEligible(!!paymentBody.isFounderEligible);
      }
    } catch {
      // Silent — non-critical.
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Run once on mount only.
  useEffect(() => {
    fetchStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isNative) return;
    NativePurchases.getProducts({
      productIdentifiers: [ID_VERIFICATION_GOOGLE_PRODUCT_ID],
      productType: PURCHASE_TYPE.INAPP,
    })
      .then(({ products }) => {
        if (products[0]) setNativePrice(products[0].priceString);
      })
      .catch(() => {
        // Silent — button stays disabled with a loading label until
        // real price info is available.
      });
  }, [isNative]);

  useEffect(() => {
    if (isNative) return;
    fetch("/api/app-settings", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (body && typeof body.id_verification_fee_zar === "number") {
          setWebPriceZar(body.id_verification_fee_zar);
        }
      })
      .catch(() => {
        // Silent — button/badge stay in their loading state until real
        // price info is available, same as the native path above.
      });
  }, [isNative, token]);

  const handleTakeSelfie = async () => {
    const file = await capturePhoto();
    if (!file) return;

    setIsSubmittingPhoto(true);
    try {
      const formData = new FormData();
      formData.append("selfie", file);
      const res = await fetch("/api/verification/photo", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to submit");
      toast({ title: "Selfie submitted", description: "We'll review it shortly." });
      fetchStatus();
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to submit selfie.",
        variant: "destructive",
      });
    } finally {
      setIsSubmittingPhoto(false);
    }
  };

  const handleClaimFree = async () => {
    setIsPaying(true);
    try {
      const res = await fetch("/api/verification/id/claim-free", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to claim free verification");
      setHasPaidForId(true);
      toast({ title: "Free verification claimed", description: "You can now submit your ID documents." });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to claim free verification.",
        variant: "destructive",
      });
    } finally {
      setIsPaying(false);
    }
  };

  const handleGooglePay = async () => {
    setIsPaying(true);
    try {
      const { isBillingSupported } = await NativePurchases.isBillingSupported();
      if (!isBillingSupported) throw new Error("Purchases aren't supported on this device.");

      const transaction = await NativePurchases.purchaseProduct({
        productIdentifier: ID_VERIFICATION_GOOGLE_PRODUCT_ID,
        productType: PURCHASE_TYPE.INAPP,
        quantity: 1,
        isConsumable: true,
        // Acknowledged server-side only after our own verification
        // succeeds — same reasoning as the Sparks purchase flow.
        autoAcknowledgePurchases: false,
      });

      const res = await fetch("/api/verification/id/pay/google", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ purchase_token: transaction.purchaseToken }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Payment failed");
      setHasPaidForId(true);
      toast({ title: "Payment received", description: "You can now submit your ID documents." });
    } catch (err) {
      // Don't show an error toast just because someone backed out of
      // Google's own purchase sheet.
      const message = err instanceof Error ? err.message : "Payment failed.";
      if (!message.toLowerCase().includes("cancel")) {
        toast({ title: "Error", description: message, variant: "destructive" });
      }
    } finally {
      setIsPaying(false);
    }
  };

  const handlePayfastCheckout = async () => {
    setIsPaying(true);
    try {
      const res = await fetch("/api/verification/id/checkout/payfast", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to start checkout");

      // A real HTML form POST, not a fetch — needs to actually navigate
      // the browser to PayFast's hosted payment page.
      const form = document.createElement("form");
      form.method = "POST";
      form.action = body.action_url;
      for (const [key, value] of Object.entries(body.fields as Record<string, string>)) {
        if (value === undefined || value === null) continue;
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = key;
        input.value = String(value);
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
      // No finally-reset on the success path — the page is about to
      // navigate away entirely.
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to start checkout.",
        variant: "destructive",
      });
      setIsPaying(false);
    }
  };

  const handlePayForId = () => {
    if (isFounderEligible) return handleClaimFree();
    if (isNative) return handleGooglePay();
    return handlePayfastCheckout();
  };

  // What the button itself calls. Founders go straight through — it's
  // free, there's nothing to confirm. Everyone else sees the price
  // clearly, in the confirmation modal, before anything happens.
  const handleStartVerificationTapped = () => {
    if (isFounderEligible) return handleClaimFree();
    setShowPaymentConfirm(true);
  };

  const handleSubmitId = async () => {
    if (!idFrontFile || !idBackFile || !idSelfieFile) {
      toast({ title: "All three photos are required", variant: "destructive" });
      return;
    }
    setIsSubmittingId(true);
    try {
      const formData = new FormData();
      formData.append("id_front", idFrontFile);
      formData.append("id_back", idBackFile);
      formData.append("selfie", idSelfieFile);
      const res = await fetch("/api/verification/id", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to submit");
      setSubmitFailed(false);
      toast({ title: "ID verification submitted", description: "We'll review it shortly." });
      setShowIdForm(false);
      setIdFrontFile(null);
      setIdBackFile(null);
      setIdSelfieFile(null);
      fetchStatus();
    } catch (err) {
      // A technical failure here does NOT touch the payment server-side —
      // it stays valid, so offer a real choice instead of just an error
      // toast: try again immediately, or explicitly request a refund.
      setSubmitFailed(true);
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to submit ID verification.",
        variant: "destructive",
      });
    } finally {
      setIsSubmittingId(false);
    }
  };

  const handleRequestRefund = async () => {
    setIsRequestingRefund(true);
    try {
      const res = await fetch("/api/verification/id/request-refund", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to request refund");
      setHasPaidForId(false);
      setShowIdForm(false);
      setSubmitFailed(false);
      toast({ title: "Refund requested", description: "Our team will process it within a few business days." });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to request refund.",
        variant: "destructive",
      });
    } finally {
      setIsRequestingRefund(false);
    }
  };

  if (isLoading) return null;

  const photoStatus = status?.photo;
  const idStatus = status?.id;

  return (
    <div className="bg-card border border-card-border rounded-2xl p-5 mb-8 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-gradient-accent flex items-center justify-center text-white shrink-0">
          <ShieldCheck size={18} />
        </div>
        <div>
          <h3 className="font-['Syne'] font-bold text-base">Verification</h3>
          <p className="text-xs text-muted-foreground">Both optional — build trust with other members</p>
        </div>
      </div>

      {/* Photo Verified — free tier */}
      <div className="border-t border-border pt-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold">Photo Verified</p>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground font-medium">Free</span>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Take a selfie — we'll compare it to your profile photos to confirm it's really you.
        </p>

        {photoStatus?.status === "approved" ? (
          <div className="flex items-center gap-2 text-sm text-green-500 font-medium">
            <CheckCircle2 size={16} /> Photo Verified
          </div>
        ) : photoStatus?.status === "pending" ? (
          <div className="flex items-center gap-2 text-sm text-amber-500">
            <Clock size={16} /> Pending review
          </div>
        ) : (
          <>
            {photoStatus?.status === "rejected" && (
              <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 rounded-xl p-3 mb-3">
                <XCircle size={14} className="shrink-0 mt-0.5" />
                <span>{photoStatus.rejection_reason || "Your submission was rejected."}</span>
              </div>
            )}
            <Button
              onClick={handleTakeSelfie}
              disabled={isSubmittingPhoto}
              variant="outline"
              className="w-full h-11 rounded-xl gap-2"
            >
              <Camera size={16} />
              {isSubmittingPhoto ? "Submitting..." : photoStatus?.status === "rejected" ? "Resubmit Selfie" : "Take a Selfie"}
            </Button>
          </>
        )}
      </div>

      {/* ID Verified — paid tier */}
      <div className="border-t border-border pt-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold">ID Verified</p>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
            {isFounderEligible ? "Free" : "Optional"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Submit your ID (front & back) plus a selfie for full verification.
        </p>

        {idStatus?.status === "approved" ? (
          <div className="flex items-center gap-2 text-sm text-green-500 font-medium">
            <CheckCircle2 size={16} /> ID Verified
          </div>
        ) : idStatus?.status === "pending" ? (
          <div className="flex items-center gap-2 text-sm text-amber-500">
            <Clock size={16} /> Pending review
          </div>
        ) : (
          <>
            {idStatus?.status === "rejected" && (
              <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 rounded-xl p-3 mb-3">
                <XCircle size={14} className="shrink-0 mt-0.5" />
                <span>{idStatus.rejection_reason || "Your submission was rejected."} You can resubmit at no extra charge.</span>
              </div>
            )}

            {!hasPaidForId ? (
              <Button
                onClick={handleStartVerificationTapped}
                disabled={isPaying || (isNative && !isFounderEligible && !nativePrice) || (!isNative && !isFounderEligible && webPriceZar === null)}
                className="w-full h-11 rounded-xl gap-2 bg-gradient-accent border-0"
              >
                {isFounderEligible ? <Crown size={16} /> : <CreditCard size={16} />}
                {isPaying
                  ? "Processing..."
                  : isFounderEligible
                    ? "Claim Free Verification (Founders)"
                    : "Start Verification"}
              </Button>
            ) : !showIdForm ? (
              <Button onClick={() => setShowIdForm(true)} variant="outline" className="w-full h-11 rounded-xl gap-2">
                <Upload size={16} />
                {idStatus?.status === "rejected" ? "Resubmit Documents" : "Upload Documents"}
              </Button>
            ) : (
              <div className="space-y-3">
                <FilePickerRow label="ID Front" file={idFrontFile} onChange={setIdFrontFile} />
                <FilePickerRow label="ID Back" file={idBackFile} onChange={setIdBackFile} />
                <FilePickerRow label="Selfie" file={idSelfieFile} onChange={setIdSelfieFile} capture />

                {submitFailed ? (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground bg-secondary/60 rounded-xl p-3">
                      Submission failed. Your payment is still valid — you can try again, or request a refund instead.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        onClick={handleSubmitId}
                        disabled={isSubmittingId || !idFrontFile || !idBackFile || !idSelfieFile}
                        className="flex-1 h-11 rounded-xl bg-gradient-accent border-0"
                      >
                        {isSubmittingId ? "Retrying..." : "Try Again"}
                      </Button>
                      <Button
                        onClick={handleRequestRefund}
                        disabled={isRequestingRefund}
                        variant="outline"
                        className="flex-1 h-11 rounded-xl"
                      >
                        {isRequestingRefund ? "Requesting..." : "Request Refund"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    onClick={handleSubmitId}
                    disabled={isSubmittingId || !idFrontFile || !idBackFile || !idSelfieFile}
                    className="w-full h-11 rounded-xl bg-gradient-accent border-0"
                  >
                    {isSubmittingId ? "Submitting..." : "Submit for Review"}
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {showPaymentConfirm && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setShowPaymentConfirm(false)} />
          <div className="fixed inset-x-6 top-1/2 -translate-y-1/2 z-50 bg-card border border-card-border rounded-2xl p-5 space-y-4 max-w-sm mx-auto">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-accent flex items-center justify-center text-white shrink-0">
                <CreditCard size={18} />
              </div>
              <h3 className="font-['Syne'] font-bold text-base">ID Verification</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              A one-time fee of{" "}
              <span className="font-semibold text-foreground">
                {isNative ? (nativePrice ?? "...") : webPriceZar !== null ? `R${webPriceZar}` : "..."}
              </span>{" "}
              gets your ID reviewed and adds the verified badge to your profile — no recurring charges.
            </p>
            <div className="flex gap-2">
              <Button
                onClick={() => setShowPaymentConfirm(false)}
                variant="outline"
                className="flex-1 h-11 rounded-xl"
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setShowPaymentConfirm(false);
                  handlePayForId();
                }}
                disabled={isPaying}
                className="flex-1 h-11 rounded-xl bg-gradient-accent border-0"
              >
                {isPaying ? "Processing..." : "Continue to Payment"}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function FilePickerRow({
  label,
  file,
  onChange,
  capture = false,
}: {
  label: string;
  file: File | null;
  onChange: (file: File | null) => void;
  capture?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);

  const handleClick = async () => {
    if (capture) {
      const captured = await capturePhoto();
      if (captured) onChange(captured);
      return;
    }
    ref.current?.click();
  };

  return (
    <div>
      {!capture && (
        <input
          ref={ref}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => onChange(e.target.files?.[0] ?? null)}
          className="hidden"
        />
      )}
      <button
        onClick={handleClick}
        className={`w-full flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
          file ? "border-primary/40 bg-primary/5" : "border-card-border hover:border-primary/30"
        }`}
      >
        {file ? (
          <img src={URL.createObjectURL(file)} alt="" className="w-12 h-9 object-cover rounded-lg shrink-0" />
        ) : (
          <div className="w-12 h-9 rounded-lg bg-secondary flex items-center justify-center shrink-0">
            <Upload size={14} className="text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium truncate">{label}</p>
          <p className="text-[10px] text-muted-foreground">{file ? file.name : capture ? "Tap to take a photo" : "Tap to upload"}</p>
        </div>
      </button>
    </div>
  );
}
