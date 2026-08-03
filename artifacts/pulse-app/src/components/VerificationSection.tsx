import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Camera, Clock, XCircle, CheckCircle2, CreditCard, Upload } from "lucide-react";

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
  const [isPaying, setIsPaying] = useState(false);
  const [isSubmittingPhoto, setIsSubmittingPhoto] = useState(false);
  const [isSubmittingId, setIsSubmittingId] = useState(false);
  const [showIdForm, setShowIdForm] = useState(false);
  const [submitFailed, setSubmitFailed] = useState(false);
  const [isRequestingRefund, setIsRequestingRefund] = useState(false);

  const selfieInputRef = useRef<HTMLInputElement>(null);
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
      if (paymentRes.ok) setHasPaidForId((await paymentRes.json()).hasPaid);
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

  const handleSelfieSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
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

  const handlePayForId = async () => {
    setIsPaying(true);
    try {
      const res = await fetch("/api/verification/id/pay", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Payment failed");
      setHasPaidForId(true);
      toast({ title: "Payment received", description: "You can now submit your ID documents." });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Payment failed.",
        variant: "destructive",
      });
    } finally {
      setIsPaying(false);
    }
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
            <input
              ref={selfieInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="user"
              onChange={handleSelfieSelected}
              className="hidden"
            />
            <Button
              onClick={() => selfieInputRef.current?.click()}
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
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">R99 once-off</span>
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
              <Button onClick={handlePayForId} disabled={isPaying} className="w-full h-11 rounded-xl gap-2 bg-gradient-accent border-0">
                <CreditCard size={16} />
                {isPaying ? "Processing..." : "Pay R99 to Start"}
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
                      Submission failed. Your R99 payment is still valid — you can try again, or request a refund instead.
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
  return (
    <div>
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture={capture ? "user" : undefined}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        className="hidden"
      />
      <button
        onClick={() => ref.current?.click()}
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
