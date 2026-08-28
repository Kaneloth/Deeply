import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { COUNTRY_CODES } from "@/lib/countryCodes";

/** Phone number entry + 6-digit OTP verification, shared between
 *  OnboardingPage (as one step in the flow) and SettingsPage (as an
 *  expandable Account section). Verification itself is saved directly
 *  to the profile by the backend the moment the code is confirmed
 *  (see /api/phone/verify-otp) — this component doesn't need to hold
 *  or hand back any verified state beyond calling onVerified once, so
 *  an abandoned onboarding after a successful verify still keeps the
 *  phone number saved. */
export function PhoneVerificationFlow({
  onVerified,
  onSkip,
  onCancel,
}: {
  onVerified: (phoneNumber: string) => void;
  /** Shown as "Skip for now" below the primary button when provided —
   *  the onboarding use case. Omit entirely (Settings use case) to hide
   *  it, since skipping doesn't make sense once someone's deliberately
   *  opened this form to add or change their number. */
  onSkip?: () => void;
  /** Shown as a plain text "Cancel" link when provided — the Settings
   *  use case, to collapse the form without any action. */
  onCancel?: () => void;
}) {
  const { token } = useAuth();
  const { toast } = useToast();

  const [countryCode, setCountryCode] = useState("+27");
  const [localPhoneNumber, setLocalPhoneNumber] = useState("");
  const [isSendingOtp, setIsSendingOtp] = useState(false);

  const [showOtpEntry, setShowOtpEntry] = useState(false);
  const [otpDigits, setOtpDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const otpInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const resendTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (resendTimerRef.current) clearInterval(resendTimerRef.current);
    };
  }, []);

  // A leading 0 is how most people naturally type a local number
  // (e.g. "082 123 4567") even though E.164 excludes it — stripped here
  // rather than asking the user to know/omit it themselves.
  const fullPhoneNumber = `${countryCode}${localPhoneNumber.replace(/\D/g, "").replace(/^0+/, "")}`;
  const isPhoneEnteredEnough = localPhoneNumber.replace(/\D/g, "").length >= 7;
  const otpCode = otpDigits.join("");

  const startResendCooldown = () => {
    setResendCooldown(30);
    if (resendTimerRef.current) clearInterval(resendTimerRef.current);
    resendTimerRef.current = setInterval(() => {
      setResendCooldown((s) => {
        if (s <= 1) {
          if (resendTimerRef.current) clearInterval(resendTimerRef.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  };

  const sendOtp = async () => {
    setIsSendingOtp(true);
    setOtpError(null);
    try {
      const res = await fetch("/api/phone/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ phone_number: fullPhoneNumber }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "We couldn't send the code. Please check your number and try again.");
      setOtpDigits(["", "", "", "", "", ""]);
      setShowOtpEntry(true);
      startResendCooldown();
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "We couldn't send the code. Please check your number and try again.",
        variant: "destructive",
      });
    } finally {
      setIsSendingOtp(false);
    }
  };

  const verifyOtp = async () => {
    setIsVerifyingOtp(true);
    setOtpError(null);
    try {
      const res = await fetch("/api/phone/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code: otpCode }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOtpError(body.error ?? "Invalid code. Please try again.");
        return;
      }
      toast({ title: "Phone number verified" });
      onVerified(body.phone_number ?? fullPhoneNumber);
    } catch {
      setOtpError("Invalid code. Please try again.");
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  const handleOtpDigitChange = (index: number, rawValue: string) => {
    const digit = rawValue.replace(/\D/g, "").slice(-1);
    setOtpDigits((prev) => {
      const next = [...prev];
      next[index] = digit;
      return next;
    });
    if (digit && index < 5) otpInputRefs.current[index + 1]?.focus();
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !otpDigits[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length === 0) return;
    e.preventDefault();
    const next = pasted.split("").concat(Array(6).fill("")).slice(0, 6);
    setOtpDigits(next);
    otpInputRefs.current[Math.min(pasted.length, 5)]?.focus();
  };

  if (showOtpEntry) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-['Syne'] font-bold mb-2">Enter Verification Code</h2>
          <p className="text-sm text-muted-foreground">We sent a 6-digit code to {fullPhoneNumber}</p>
        </div>

        <div className="flex gap-2 justify-center">
          {otpDigits.map((digit, i) => (
            <input
              key={i}
              ref={(el) => (otpInputRefs.current[i] = el)}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(e) => handleOtpDigitChange(i, e.target.value)}
              onKeyDown={(e) => handleOtpKeyDown(i, e)}
              onPaste={handleOtpPaste}
              className="w-11 h-14 text-center text-xl font-semibold bg-card border border-card-border rounded-xl focus:outline-none focus:border-primary"
            />
          ))}
        </div>

        {otpError && <p className="text-xs text-destructive text-center">{otpError}</p>}

        <div className="space-y-2">
          <Button
            onClick={verifyOtp}
            disabled={otpCode.length !== 6 || isVerifyingOtp}
            className="w-full h-14 rounded-xl text-lg font-semibold bg-gradient-accent border-0 shadow-[0_4px_20px_rgba(225,29,72,0.3)]"
          >
            {isVerifyingOtp ? "Verifying..." : "Verify"}
          </Button>
          <Button
            onClick={sendOtp}
            disabled={resendCooldown > 0 || isSendingOtp}
            variant="ghost"
            className="w-full h-11 rounded-xl text-muted-foreground"
          >
            {resendCooldown > 0 ? `Resend Code (${resendCooldown}s)` : "Resend Code"}
          </Button>
          {onCancel && (
            <button onClick={onCancel} className="w-full text-center text-xs text-muted-foreground underline pt-1">
              Cancel
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-['Syne'] font-bold mb-2">Phone Number (Optional)</h2>
        <p className="text-sm text-muted-foreground">
          We'll use this to verify your account, keep it secure, and — if you choose to use it later — help you avoid matching with people already in your contacts.
        </p>
      </div>

      <div className="flex gap-2">
        <select
          value={countryCode}
          onChange={(e) => setCountryCode(e.target.value)}
          className="bg-card border border-card-border h-12 rounded-xl px-2 text-sm w-[104px] shrink-0"
        >
          {COUNTRY_CODES.map((c) => (
            <option key={`${c.code}-${c.label}`} value={c.code}>
              {c.label} {c.code}
            </option>
          ))}
        </select>
        <Input
          type="tel"
          inputMode="numeric"
          value={localPhoneNumber}
          onChange={(e) => setLocalPhoneNumber(e.target.value.replace(/[^\d\s]/g, ""))}
          placeholder="82 123 4567"
          className="bg-card border-card-border h-12 rounded-xl flex-1"
        />
      </div>

      <div className="space-y-2">
        <Button
          onClick={sendOtp}
          disabled={!isPhoneEnteredEnough || isSendingOtp}
          className="w-full h-14 rounded-xl text-lg font-semibold bg-gradient-accent border-0 shadow-[0_4px_20px_rgba(225,29,72,0.3)]"
        >
          {isSendingOtp ? "Sending..." : "Verify"}
        </Button>
        {onSkip && (
          <Button onClick={onSkip} variant="ghost" className="w-full h-12 rounded-xl text-muted-foreground">
            Skip for now
          </Button>
        )}
        {onCancel && (
          <button onClick={onCancel} className="w-full text-center text-xs text-muted-foreground underline pt-1">
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
