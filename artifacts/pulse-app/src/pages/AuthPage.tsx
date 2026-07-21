import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { HeartbeatVisual } from "@/components/Icons";
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

const loginSchema = z.object({
  email: z.string().email({ message: "Invalid email address" }),
  password: z.string().min(6, { message: "Password must be at least 6 characters" }),
});

const signupSchema = loginSchema.extend({
  name: z.string().min(2, { message: "Name is required" }),
  age: z.coerce.number().min(18, { message: "Must be at least 18" }).max(120),
});

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const loginForm = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const signupForm = useForm<z.infer<typeof signupSchema>>({
    resolver: zodResolver(signupSchema),
    defaultValues: { email: "", password: "", name: "", age: undefined },
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
      if (!res.ok) throw new Error(body.error ?? "Login failed");
      login(body.access_token);
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
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Signup failed");

      if (body.requiresEmailConfirmation) {
        setPendingEmail(body.user?.email ?? data.email);
        return;
      }

      login(body.access_token);
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
      login(body.access_token);
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

  if (pendingEmail) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[100dvh] px-6 w-full relative text-center">
        <div className="absolute top-[-10%] left-[-20%] w-[150%] h-[50%] bg-primary/20 blur-[120px] rounded-full pointer-events-none" />
        <div className="z-10 w-full max-w-sm">
          <HeartbeatVisual />
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
        <HeartbeatVisual />
        <h1 className="text-5xl font-['Syne'] font-extrabold text-transparent bg-clip-text bg-gradient-accent mt-4 tracking-tighter">
          PULSE
        </h1>
        <p className="text-muted-foreground text-sm mt-2 text-center max-w-[280px]">
          Match slower. Date faster. Ghost never.
        </p>
      </div>

      <div className="w-full max-w-sm z-10">
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
                          <Input placeholder="••••••••" type="password" {...field} className="bg-card border-card-border" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
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
                    name="age"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Age</FormLabel>
                        <FormControl>
                          <Input placeholder="24" type="number" {...field} className="bg-card border-card-border" />
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
                          <Input placeholder="••••••••" type="password" {...field} className="bg-card border-card-border" />
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
