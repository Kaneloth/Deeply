import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { supabaseClient } from "@/lib/supabaseClient";

/** Landing point for /auth/callback — this is the redirectTo URL passed
 *  to supabase.auth.signInWithOAuth. Supabase's client-side SDK parses
 *  the access/refresh tokens out of the callback URL automatically
 *  (detectSessionInUrl: true on the client in supabaseClient.ts), so by
 *  the time this component mounts, getSession() already has them
 *  in-memory — we just need to read them out and hand off to the app's
 *  own AuthContext, exactly like the email/password and OTP flows do. */
export default function AuthCallbackPage() {
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const [error, setError] = useState<string | null>(null);
  const hasRun = useRef(false);

  useEffect(() => {
    // StrictMode/fast-refresh can mount this twice — only run the
    // exchange once, since a second getSession() call after login() has
    // already fired would be redundant at best.
    if (hasRun.current) return;
    hasRun.current = true;

    (async () => {
      const { data, error: sessionError } = await supabaseClient.auth.getSession();

      if (sessionError || !data.session) {
        setError("Could not complete Google sign-in. Please try again.");
        return;
      }

      const { access_token, refresh_token, expires_in } = data.session;
      login(access_token, refresh_token, expires_in);

      // New Google sign-ups get a profiles row via the same DB trigger
      // signup goes through, but onboarding_completed will still be
      // false for them — route accordingly, same distinction the
      // signup/login handlers on AuthPage already make.
      //
      // IMPORTANT: this only ever sends someone to /onboarding on a
      // CONFIRMED `false` from the backend — never as a fallback for "the
      // request failed" or "couldn't tell". Right after the OAuth token
      // is minted, this first request is more prone to a transient
      // failure than a normal logged-in request — and mobile browsers
      // (slower JS re-init and more variable timing coming back from the
      // full-page redirect to Google) hit that window far more often
      // than desktop, which is what was actually causing already-
      // onboarded users to get bounced through onboarding again. If we
      // can't get a confirmed answer after retrying, default to
      // /discover — a genuinely new user seeing an empty Discover screen
      // for a moment is a far smaller problem than risking a returning
      // user re-running onboarding and overwriting their real data.
      const fetchProfile = () =>
        fetch("/api/profile/me", { headers: { Authorization: `Bearer ${access_token}` } });

      let onboardingCompleted: boolean | null = null;
      for (const delayMs of [0, 400, 1200]) {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        try {
          const res = await fetchProfile();
          if (res.ok) {
            const profile = await res.json();
            onboardingCompleted = profile?.onboarding_completed === true;
            break;
          }
        } catch {
          // Network error — fall through and retry.
        }
      }

      setLocation(onboardingCompleted === false ? "/onboarding" : "/discover");
    })();
  }, [login, setLocation]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[100dvh] px-6 w-full text-center gap-3">
        <p className="text-destructive text-sm">{error}</p>
        <button
          onClick={() => setLocation("/")}
          className="text-primary text-sm font-medium hover:underline"
        >
          ← Back to sign in
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[100dvh] px-6 w-full text-center">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-4" />
      <p className="text-muted-foreground text-sm">Signing you in…</p>
    </div>
  );
}
