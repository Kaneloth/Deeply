import { useState } from "react";
import { Capacitor } from "@capacitor/core";
import { GoogleSignIn, ErrorCode as GoogleSignInErrorCode } from "@capawesome/capacitor-google-sign-in";
import { BiometricAuth, AndroidBiometryStrength } from "@aparajita/capacitor-biometric-auth";
import {
  useAuth,
  getSignInMethod,
  disableBiometricSignIn,
  loadBiometricRefreshToken,
} from "@/contexts/AuthContext";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion, AnimatePresence } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, Fingerprint } from "lucide-react";
import { BlockedAccountScreen, type BlockInfo } from "@/components/BlockedAccountScreen";
import { supabaseClient } from "@/lib/supabaseClient";
import { captureError } from "@/lib/sentry";

// Runs the OS-level (or WebAuthn) fingerprint prompt, then exchanges the
// biometric-gated refresh token for a fresh session via the same
// /api/auth/refresh endpoint AuthContext's own doRefresh() uses — so a
// biometric login rotates the token exactly like a normal silent refresh
// does, and applySession() picks up and re-stores the new gated copy
// automatically since SIGNIN_METHOD_KEY is already "biometric" at that
// point.
//
// Throws one of: "no-credential" | "unsupported" | "cancelled" |
// "fingerprint-failed" | "session-expired" — the caller maps these to
// user-facing behavior.
async function triggerBiometricLogin(): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const refreshToken = loadBiometricRefreshToken();
  if (!refreshToken) throw new Error("no-credential");

  if (Capacitor.isNativePlatform()) {
    const check = await BiometricAuth.checkBiometry();
    if (!check.strongBiometryIsAvailable) {
      throw new Error(check.strongCode === "biometryNotEnrolled" ? "no-credential" : "unsupported");
    }
    try {
      await BiometricAuth.authenticate({
        reason: "Sign in to Deeply",
        androidTitle: "Deeply",
        androidSubtitle: "Sign in with your fingerprint",
        androidBiometryStrength: AndroidBiometryStrength.strong,
      });
    } catch (err) {
      const code = (err as { code?: string } | undefined)?.code;
      if (code === "userCancel" || code === "systemCancel" || code === "appCancel") {
        throw new Error("cancelled");
      }
      throw new Error("fingerprint-failed");
    }
  } else {
    // Web — WebAuthn verification against the credential saved at
    // registration time in SettingsPage.
    if (!window.PublicKeyCredential) throw new Error("unsupported");
    const storedId = localStorage.getItem("deeply_biometric_credential_id");
    if (!storedId) throw new Error("no-credential");
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    const rawId = Uint8Array.from(atob(storedId), (c) => c.charCodeAt(0));
    try {
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [{ id: rawId, type: "public-key" }],
          userVerification: "required",
          timeout: 60000,
        },
      });
      if (!assertion) throw new Error("fingerprint-failed");
    } catch (err) {
      if ((err as { name?: string } | undefined)?.name === "NotAllowedError") {
        throw new Error("cancelled");
      }
      throw new Error("fingerprint-failed");
    }
  }

  // Fingerprint confirmed — now actually redeem the gated refresh token.
  const res = await fetch("/api/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const body = await res.json().catch(() => ({}));
  // A rejected refresh here almost always means the refresh token was
  // already rotated out from under the gated copy (e.g. it was used
  // elsewhere, or is simply too old) — the fingerprint itself succeeded,
  // it's the stored token that's dead.
  if (!res.ok) throw new Error("session-expired");
  return { access_token: body.access_token, refresh_token: body.refresh_token, expires_in: body.expires_in };
}

/** Google's official multi-color "G" mark — used per Google's own brand
 *  guidelines for "Sign in with Google" buttons. */
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.03l2.99-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.97l2.99 2.33C4.66 5.17 6.65 3.58 9 3.58z"
      />
    </svg>
  );
}

const loginSchema = z.object({
  email: z.string().email({ message: "Invalid email address" }),
  password: z.string().min(6, { message: "Password must be at least 6 characters" }),
});

const signupSchema = loginSchema
  .extend({
    confirmPassword: z.string().min(6, { message: "Please confirm your password" }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

/** A password Input with a show/hide eye toggle, wired to work inside
 *  react-hook-form's FormControl (same value/onChange contract as a
 *  normal field). */
function PasswordInput({ field }: { field: any }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        placeholder="••••••••"
        type={visible ? "text" : "password"}
        {...field}
        className="bg-card border-card-border pr-10"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        tabIndex={-1}
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [isSendingReset, setIsSendingReset] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [blockInfo, setBlockInfo] = useState<BlockInfo | null>(null);

  // "idle" / "biometric-loading" / "biometric-error" show the fingerprint
  // screen instead of the normal form. Starts there only if biometric
  // sign-in was actually registered on this device (checked once, on
  // mount) — if the user then chooses "Use password instead", this
  // permanently becomes "password" for the rest of this page's lifetime,
  // same as Deeply's other one-shot mount checks elsewhere in this file.
  const [loginStage, setLoginStage] = useState<"idle" | "biometric-loading" | "biometric-error" | "password">(
    () => (getSignInMethod() === "biometric" ? "idle" : "password")
  );

  const handleBiometricLogin = async () => {
    setLoginStage("biometric-loading");
    try {
      const session = await triggerBiometricLogin();
      login(session.access_token, session.refresh_token, session.expires_in);
      // Same onboarding check the Google native flow does below — login()
      // alone would let PublicRoute's isAuthenticated redirect send
      // everyone straight to /discover, including anyone who still needs
      // onboarding.
      try {
        const res = await fetch("/api/profile/me", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const profile = res.ok ? await res.json() : null;
        setLocation(profile?.onboarding_completed ? "/discover" : "/onboarding");
      } catch {
        setLocation("/discover");
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : "fingerprint-failed";
      if (reason === "cancelled") {
        setLoginStage("idle");
      } else if (reason === "no-credential" || reason === "unsupported") {
        disableBiometricSignIn();
        setLoginStage("password");
        toast({
          title: "Biometric unavailable",
          description:
            "No fingerprint is enrolled on this device, or it was removed. Sign in with your password, then re-enable biometric sign-in in Settings if you'd like.",
          variant: "destructive",
        });
      } else if (reason === "session-expired") {
        disableBiometricSignIn();
        setLoginStage("password");
        toast({
          title: "Session expired",
          description: "Your biometric session expired. Sign in with your password once — you can re-enable biometric sign-in in Settings afterward.",
          variant: "destructive",
        });
      } else {
        setLoginStage("biometric-error");
      }
    }
  };

  const loginForm = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const signupForm = useForm<z.infer<typeof signupSchema>>({
    resolver: zodResolver(signupSchema),
    defaultValues: { email: "", password: "", confirmPassword: "" },
  });

  const onLoginSubmit = async (data: z.infer<typeof loginSchema>) => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await res.json();

      if (res.status === 403 && (body.code === "BANNED" || body.code === "SUSPENDED")) {
        setBlockInfo({ code: body.code, reason: body.reason, suspendedUntil: body.suspendedUntil, email: data.email });
        return;
      }

      if (!res.ok) throw new Error(body.error ?? "Login failed");
      login(body.access_token, body.refresh_token, body.expires_in);
      // Previously this always went straight to /discover, unlike
      // biometric and Google login (both already check this) — so an
      // account that never finished onboarding for any reason would
      // silently land in Discover via password login instead of being
      // sent back to finish onboarding, masking the account's real
      // state rather than fixing it. Password login should behave the
      // same as every other login method.
      try {
        const profileRes = await fetch("/api/profile/me", {
          headers: { Authorization: `Bearer ${body.access_token}` },
        });
        const profile = profileRes.ok ? await profileRes.json() : null;
        setLocation(profile?.onboarding_completed ? "/discover" : "/onboarding");
      } catch {
        setLocation("/discover");
      }
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Invalid credentials. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const onSignupSubmit = async (data: z.infer<typeof signupSchema>) => {
    setIsLoading(true);
    try {
      // confirmPassword only exists for client-side validation — the
      // backend just needs email and password. Name is collected during
      // onboarding instead, not at signup — see OnboardingPage.tsx.
      const { confirmPassword, ...payload } = data;
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Signup failed");

      if (body.requiresEmailConfirmation) {
        setPendingEmail(body.user?.email ?? data.email);
        return;
      }

      login(body.access_token, body.refresh_token, body.expires_in);
      setLocation("/onboarding");
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Could not create account. Email may be taken.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!forgotEmail.trim()) {
      toast({ title: "Enter your email first", variant: "destructive" });
      return;
    }
    setIsSendingReset(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: forgotEmail.trim(),
          redirectTo: `${window.location.origin}/reset-password`,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to send reset email");
      }
      setResetSent(true);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to send reset email.",
        variant: "destructive",
      });
    } finally {
      setIsSendingReset(false);
    }
  };

  const onVerifyCode = async () => {
    if (!pendingEmail || code.length !== 6) return;
    setIsVerifying(true);
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: pendingEmail, code }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Invalid or expired code");
      login(body.access_token, body.refresh_token, body.expires_in);
      setLocation("/onboarding");
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Invalid or expired code.",
        variant: "destructive",
      });
    } finally {
      setIsVerifying(false);
    }
  };

  const onResendCode = async () => {
    if (!pendingEmail) return;
    setIsResending(true);
    try {
      const res = await fetch("/api/auth/resend-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: pendingEmail }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Could not resend code");
      }
      toast({ title: "Code sent", description: "Check your inbox for a new code." });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Could not resend code.",
        variant: "destructive",
      });
    } finally {
      setIsResending(false);
    }
  };

  // Same handler for both login and signup mode — Supabase's OAuth flow
  // creates the account on first sign-in and just logs in on subsequent
  // ones, so there's no separate "Google sign up" action needed.
  const onGoogleSignIn = async () => {
    setIsGoogleLoading(true);

    // Native: shows Android's own account picker directly via Credential
    // Manager — no browser handoff, no deep link, no PKCE exchange. The
    // whole class of "stuck in browser" / "stuck on Redirecting..." problems
    // simply doesn't exist with this approach, since there's no redirect to
    // lose track of in the first place.
    if (Capacitor.isNativePlatform()) {
      try {
        const result = await GoogleSignIn.signIn();
        if (!result?.idToken) {
          throw new Error("No ID token returned from Google.");
        }

        const { data, error } = await supabaseClient.auth.signInWithIdToken({
          provider: "google",
          token: result.idToken,
        });
        if (error) throw error;
        if (!data.session) {
          throw new Error("Sign-in succeeded but no session was returned.");
        }

        const { access_token, refresh_token, expires_in } = data.session;
        login(access_token, refresh_token, expires_in);

        // Same onboarding check the web flow's AuthCallbackPage does —
        // called explicitly here since login() alone would otherwise let
        // PublicRoute's own isAuthenticated redirect send everyone
        // (including brand-new users who still need onboarding) straight
        // to /discover.
        try {
          const res = await fetch("/api/profile/me", {
            headers: { Authorization: `Bearer ${access_token}` },
          });
          const profile = res.ok ? await res.json() : null;
          setLocation(profile?.onboarding_completed ? "/discover" : "/onboarding");
        } catch {
          setLocation("/discover");
        }
      } catch (err) {
        const code = (err as { code?: GoogleSignInErrorCode } | undefined)?.code;

        // A genuine cancellation (the person backed out of the native
        // account picker) is the one case that should stay completely
        // silent — no toast, no Sentry report, since nothing actually
        // went wrong.
        //
        // Previously this compared code against the plain strings
        // "canceled"/"cancelled", which never matched the plugin's
        // actual ErrorCode.SignInCanceled value — meaning this check
        // never worked, and every single error (including harmless
        // cancellations) fell through to the toast below regardless.
        // Comparing against the plugin's real enum value fixes that.
        if (code === GoogleSignInErrorCode.SignInCanceled) {
          return;
        }

        let description = err instanceof Error ? err.message : "Google sign-in failed.";
        if (code === GoogleSignInErrorCode.NoCredentialAvailable) {
          description = "No Google account is available on this device. Add a Google account in your device settings and try again.";
        } else if (code === GoogleSignInErrorCode.ProviderConfigurationError) {
          description = "Google Play services isn't available or needs updating on this device.";
        }

        // Sent to Sentry so this is diagnosable from the Sentry
        // dashboard on any computer — no USB debugging or physical
        // device access needed. Includes the real code and message
        // exactly as the plugin/Android reported them, which is what
        // actually distinguishes "missing Android OAuth client
        // registration" from every other possible failure here.
        captureError(err, {
          context: "onGoogleSignIn",
          code: code ?? "unknown",
          message: err instanceof Error ? err.message : String(err),
        });

        toast({
          title: "Error",
          description,
          variant: "destructive",
        });
      } finally {
        setIsGoogleLoading(false);
      }
      return;
    }

    // Web: unchanged browser-redirect OAuth flow.
    try {
      const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          // Without this, Google silently reuses whichever of the
          // browser's signed-in Google accounts was last active instead
          // of showing the picker — a real problem on a shared/dev
          // device where you want to switch test accounts, and
          // surprising for real users too if they have multiple Google
          // accounts signed in.
          queryParams: { prompt: "select_account" },
        },
      });
      if (error) throw error;
      // Browser navigates away to Google at this point — nothing left
      // to do here. AuthCallbackPage picks up when it redirects back.
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Could not start Google sign-in.",
        variant: "destructive",
      });
      setIsGoogleLoading(false);
    }
  };

  if (blockInfo) {
    return <BlockedAccountScreen blockInfo={blockInfo} onBack={() => setBlockInfo(null)} />;
  }

  if (loginStage === "idle" || loginStage === "biometric-loading" || loginStage === "biometric-error") {
    return (
      <div className="min-h-[100dvh] overflow-y-auto overflow-x-hidden flex flex-col px-6 w-full relative">
        <div className="absolute top-[-10%] left-[-20%] w-[150%] h-[50%] bg-primary/20 blur-[120px] rounded-full pointer-events-none" />
        <div className="z-10 w-full max-w-sm mx-auto my-auto py-10 text-center">
          <img src="/deeply-logo.png" alt="Deeply" className="h-16 w-auto mx-auto" />
          <p className="text-muted-foreground text-sm mt-4 mb-10">
            Deep connections begin with a spark.
          </p>

          <button
            type="button"
            onClick={handleBiometricLogin}
            disabled={loginStage === "biometric-loading"}
            className="w-24 h-24 rounded-full bg-card border border-card-border flex items-center justify-center mx-auto mb-6 hover:bg-card/70 transition-colors disabled:opacity-60"
          >
            <Fingerprint size={40} className={loginStage === "biometric-error" ? "text-destructive" : "text-primary"} />
          </button>

          <p className="text-sm font-medium mb-8">
            {loginStage === "biometric-loading"
              ? "Verifying…"
              : loginStage === "biometric-error"
                ? "Not recognised — tap to try again"
                : "Tap to sign in with Biometric"}
          </p>

          <button
            type="button"
            onClick={() => setLoginStage("password")}
            className="text-muted-foreground text-sm hover:text-primary transition-colors font-medium"
          >
            Use password instead
          </button>
        </div>
      </div>
    );
  }

  if (showForgotPassword) {
    return (
      // min-h-[100dvh] + overflow-y-auto on the outer container, my-auto
      // on the inner content block — centers vertically when content
      // fits, but naturally lands at the top (with room to scroll) if
      // it's ever taller than the viewport, instead of justify-center's
      // behavior of centering overflow equally in both directions (which
      // pushes content off the TOP of the screen just as much as it
      // clips the bottom — exactly what was happening on the signup
      // view below before this fix).
      <div className="min-h-[100dvh] overflow-y-auto overflow-x-hidden flex flex-col px-6 w-full relative">
        <div className="absolute top-[-10%] left-[-20%] w-[150%] h-[50%] bg-primary/20 blur-[120px] rounded-full pointer-events-none" />
        <div className="z-10 w-full max-w-sm mx-auto my-auto py-10 text-center">
          <img src="/deeply-logo.png" alt="Deeply" className="h-14 w-auto mx-auto" />
          {resetSent ? (
            <>
              <h1 className="text-2xl font-['Syne'] font-extrabold mt-6 mb-3">Check your email</h1>
              <p className="text-muted-foreground text-sm mb-6">
                If an account exists for <span className="text-foreground font-medium">{forgotEmail}</span>, we've sent a link to
                reset your password.
              </p>
              <button
                onClick={() => setShowForgotPassword(false)}
                className="text-muted-foreground text-sm hover:text-primary transition-colors font-medium"
              >
                ← Back to sign in
              </button>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-['Syne'] font-extrabold mt-6 mb-3">Reset your password</h1>
              <p className="text-muted-foreground text-sm mb-6">
                Enter your email and we'll send you a link to set a new password.
              </p>
              <Input
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                placeholder="you@example.com"
                type="email"
                className="bg-card border-card-border h-12 mb-4"
              />
              <Button
                className="w-full h-12 rounded-xl text-base font-semibold bg-gradient-accent border-0 mb-3"
                disabled={isSendingReset}
                onClick={handleForgotPassword}
              >
                {isSendingReset ? "Sending..." : "Send Reset Link"}
              </Button>
              <button
                onClick={() => setShowForgotPassword(false)}
                className="text-muted-foreground text-sm hover:text-primary transition-colors font-medium"
              >
                ← Back to sign in
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (pendingEmail) {
    return (
      <div className="min-h-[100dvh] overflow-y-auto overflow-x-hidden flex flex-col px-6 w-full relative">
        <div className="absolute top-[-10%] left-[-20%] w-[150%] h-[50%] bg-primary/20 blur-[120px] rounded-full pointer-events-none" />
        <div className="z-10 w-full max-w-sm mx-auto my-auto py-10 text-center">
          <img src="/deeply-logo.png" alt="Deeply" className="h-14 w-auto mx-auto" />
          <h1 className="text-2xl font-['Syne'] font-extrabold mt-6 mb-3">
            Enter your code
          </h1>
          <p className="text-muted-foreground text-sm mb-6">
            We sent a 6-digit code to <span className="text-foreground font-medium">{pendingEmail}</span>.
          </p>

          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="123456"
            inputMode="numeric"
            maxLength={6}
            className="bg-card border-card-border text-center text-2xl tracking-[0.5em] h-14 mb-4"
          />

          <Button
            className="w-full h-12 rounded-xl text-base font-semibold bg-gradient-accent border-0 mb-3"
            disabled={code.length !== 6 || isVerifying}
            onClick={onVerifyCode}
          >
            {isVerifying ? "Verifying..." : "Verify"}
          </Button>

          <button
            onClick={onResendCode}
            disabled={isResending}
            className="text-muted-foreground text-sm hover:text-primary transition-colors font-medium"
          >
            {isResending ? "Sending..." : "Didn't get it? Resend code"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] overflow-y-auto overflow-x-hidden flex flex-col px-6 w-full relative">
      {/* Background Glow */}
      <div className="absolute top-[-10%] left-[-20%] w-[150%] h-[50%] bg-primary/20 blur-[120px] rounded-full pointer-events-none" />

      {/* Single wrapper for logo + form together, so my-auto centers
          (or top-aligns-and-scrolls, once taller than the viewport) the
          whole thing as one unit. Previously the logo block and the
          form block were separate siblings under a justify-center flex
          parent — that's what let the signup form's extra height push
          the logo off the top of the screen instead of just making the
          page scrollable. */}
      <div className="w-full max-w-sm mx-auto z-10 my-auto py-10">
        <div className="w-full flex flex-col items-center mb-12">
          <img src="/deeply-logo.png" alt="Deeply" className="h-16 w-auto" />
          <p className="text-muted-foreground text-sm mt-4 text-center max-w-[280px]">
            Deep connections begin with a spark.
          </p>
        </div>

        <button
          type="button"
          onClick={onGoogleSignIn}
          disabled={isGoogleLoading}
          className="w-full h-12 rounded-xl text-sm font-semibold bg-card border border-card-border flex items-center justify-center gap-3 hover:bg-card/70 transition-colors disabled:opacity-60 mb-4"
        >
          <GoogleIcon />
          {isGoogleLoading ? "Redirecting…" : "Continue with Google"}
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-px bg-card-border" />
          <span className="text-xs text-muted-foreground">or</span>
          <div className="flex-1 h-px bg-card-border" />
        </div>

        <AnimatePresence mode="wait">
          {isLogin ? (
            <motion.div
              key="login"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.3 }}
            >
              <Form {...loginForm}>
                <form onSubmit={loginForm.handleSubmit(onLoginSubmit)} className="space-y-4">
                  <FormField
                    control={loginForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input placeholder="you@example.com" type="email" {...field} className="bg-card border-card-border" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={loginForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <PasswordInput field={field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="text-right -mt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setForgotEmail(loginForm.getValues("email") || "");
                        setResetSent(false);
                        setShowForgotPassword(true);
                      }}
                      className="text-xs text-muted-foreground hover:text-primary transition-colors font-medium"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <Button type="submit" className="w-full h-12 rounded-xl text-base font-semibold bg-gradient-accent border-0" disabled={isLoading}>
                    {isLoading ? "Logging in..." : "Log In"}
                  </Button>
                </form>
              </Form>
            </motion.div>
          ) : (
            <motion.div
              key="signup"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <Form {...signupForm}>
                <form onSubmit={signupForm.handleSubmit(onSignupSubmit)} className="space-y-4">
                  <FormField
                    control={signupForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input placeholder="you@example.com" type="email" {...field} className="bg-card border-card-border" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={signupForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <PasswordInput field={field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={signupForm.control}
                    name="confirmPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Confirm Password</FormLabel>
                        <FormControl>
                          <PasswordInput field={field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full h-12 rounded-xl text-base font-semibold bg-gradient-accent border-0" disabled={isLoading}>
                    {isLoading ? "Creating account..." : "Sign Up"}
                  </Button>
                  <p className="text-xs text-muted-foreground text-center leading-relaxed px-2">
                    By signing up, you agree to Deeply's{" "}
                    <a
                      href="https://deeplydating.co.za/terms"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-foreground underline underline-offset-2 hover:text-primary transition-colors"
                    >
                      Terms of Service
                    </a>{" "}
                    and{" "}
                    <a
                      href="https://deeplydating.co.za/privacy"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-foreground underline underline-offset-2 hover:text-primary transition-colors"
                    >
                      Privacy Policy
                    </a>
                    .
                  </p>
                </form>
              </Form>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-6 text-center space-y-2">
          <button
            onClick={() => setIsLogin(!isLogin)}
            className="text-muted-foreground text-sm hover:text-primary transition-colors font-medium block w-full"
          >
            {isLogin ? "Don't have an account? Sign up" : "Already have an account? Log in"}
          </button>
          {isLogin && getSignInMethod() === "biometric" && (
            <button
              type="button"
              onClick={() => setLoginStage("idle")}
              className="text-muted-foreground text-sm hover:text-primary transition-colors font-medium inline-flex items-center gap-1.5"
            >
              <Fingerprint size={14} /> Use biometric instead
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
