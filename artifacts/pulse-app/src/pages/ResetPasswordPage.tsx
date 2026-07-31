import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, KeyRound, AlertTriangle } from "lucide-react";
import { HeartbeatVisual } from "@/components/Icons";

export default function ResetPasswordPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [linkInvalid, setLinkInvalid] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Supabase's recovery email link puts tokens in the URL fragment
  // (#access_token=...&type=recovery), which never reaches the server —
  // has to be read here, client-side.
  useEffect(() => {
    const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
    const params = new URLSearchParams(hash);
    const token = params.get("access_token");
    const type = params.get("type");

    if (!token || type !== "recovery") {
      setLinkInvalid(true);
      return;
    }
    setAccessToken(token);
  }, []);

  const handleSubmit = async () => {
    if (!accessToken) return;
    if (!newPassword || !confirmPassword) {
      toast({ title: "Fill in both fields", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    if (newPassword.length < 6) {
      toast({ title: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken, newPassword }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to reset password");

      toast({ title: "Password updated", description: "Please sign in with your new password." });
      setLocation("/");
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to reset password.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (linkInvalid) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[100dvh] px-6 w-full relative text-center">
        <div className="z-10 w-full max-w-sm space-y-4">
          <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            <AlertTriangle size={24} className="text-destructive" />
          </div>
          <h1 className="text-xl font-['Syne'] font-bold">This link is invalid or has expired</h1>
          <p className="text-sm text-muted-foreground">
            Password reset links only work once and expire after a while. Head back and request a new one.
          </p>
          <Button onClick={() => setLocation("/")} className="w-full h-12 rounded-xl bg-gradient-accent border-0">
            Back to Sign In
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[100dvh] px-6 w-full relative">
      <div className="absolute top-[-10%] left-[-20%] w-[150%] h-[50%] bg-primary/20 blur-[120px] rounded-full pointer-events-none" />
      <div className="w-full max-w-sm z-10">
        <div className="flex flex-col items-center mb-8">
          <HeartbeatVisual />
          <h1 className="text-2xl font-['Syne'] font-extrabold mt-4">Set New Password</h1>
          <p className="text-muted-foreground text-sm mt-2 text-center">Choose a new password for your account.</p>
        </div>

        <div className="space-y-4">
          <div className="relative">
            <Input
              type={showNewPw ? "text" : "password"}
              placeholder="New password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="bg-card border-card-border h-12 pr-10"
            />
            <button
              type="button"
              onClick={() => setShowNewPw((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              tabIndex={-1}
            >
              {showNewPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <div className="relative">
            <Input
              type={showConfirmPw ? "text" : "password"}
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              className="bg-card border-card-border h-12 pr-10"
            />
            <button
              type="button"
              onClick={() => setShowConfirmPw((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              tabIndex={-1}
            >
              {showConfirmPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || !accessToken}
            className="w-full h-12 rounded-xl text-base font-semibold bg-gradient-accent border-0 gap-2"
          >
            <KeyRound size={16} />
            {isSubmitting ? "Updating..." : "Update Password"}
          </Button>
        </div>
      </div>
    </div>
  );
}
