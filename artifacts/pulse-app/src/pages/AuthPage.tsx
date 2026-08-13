import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
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
import { Eye, EyeOff } from "lucide-react";
import { BlockedAccountScreen, type BlockInfo } from "@/components/BlockedAccountScreen";
import { supabaseClient } from "@/lib/supabaseClient";

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
    name: z.string().min(2, { message: "Name is required" }),
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

  const loginForm = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const signupForm = useForm<z.infer<typeof signupSchema>>({
    resolver: zodResolver(signupSchema),
    defaultValues: { email: "", password: "", confirmPassword: "", name: "" },
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
        setBlockInfo({ code: body.code, reason: body.reason, suspendedUntil: body.suspendedUntil });
        return;
      }

      if (!res.ok) throw new Error(body.error ?? "Login failed");
      login(body.access_token, body.refresh_token, body.expires_in);
      setLocation("/discover");
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
      // backend just needs email, password, and name.
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

  if (showForgotPassword) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[100dvh] px-6 w-full relative text-center">
        <div className="absolute top-[-10%] left-[-20%] w-[150%] h-[50%] bg-primary/20 blur-[120px] rounded-full pointer-events-none" />
        <div className="z-10 w-full max-w-sm">
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
      <div className="flex flex-col items-center justify-center min-h-[100dvh] px-6 w-full relative text-center">
        <div className="absolute top-[-10%] left-[-20%] w-[150%] h-[50%] bg-primary/20 blur-[120px] rounded-full pointer-events-none" />
        <div className="z-10 w-full max-w-sm">
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
    <div className="flex flex-col items-center justify-center min-h-[100dvh] px-6 w-full relative">
      {/* Background Glow */}
      <div className="absolute top-[-10%] left-[-20%] w-[150%] h-[50%] bg-primary/20 blur-[120px] rounded-full pointer-events-none" />
      
      <div className="w-full z-10 flex flex-col items-center mt-[-10vh] mb-12">
        <img src="/deeply-logo.png" alt="Deeply" className="h-16 w-auto" />
        <p className="text-muted-foreground text-sm mt-4 text-center max-w-[280px]">
          Deep connections begin with a spark.
        </p>
      </div>

      <div className="w-full max-w-sm z-10">
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
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>First Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Alex" {...field} className="bg-card border-card-border" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
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
                </form>
              </Form>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-6 text-center">
          <button
            onClick={() => setIsLogin(!isLogin)}
            className="text-muted-foreground text-sm hover:text-primary transition-colors font-medium"
          >
            {isLogin ? "Don't have an account? Sign up" : "Already have an account? Log in"}
          </button>
        </div>
      </div>
    </div>
  );
}
