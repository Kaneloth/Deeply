import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { GoogleSignIn } from "@capawesome/capacitor-google-sign-in";
import { useQueryClient } from "@tanstack/react-query";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import type { BlockInfo } from "@/components/BlockedAccountScreen";
import { setUser as setSentryUser } from "@/lib/sentry";
import { clearAllPersistentCaches } from "@/lib/persistentCache";

const ACCESS_TOKEN_KEY = "deeply_access_token";
const REFRESH_TOKEN_KEY = "deeply_refresh_token";
const EXPIRES_AT_KEY = "deeply_expires_at";

// Separate from REFRESH_TOKEN_KEY on purpose: this copy is gated behind a
// successful biometric prompt on the login screen, so logout() clearing the
// normal tokens must NOT touch it. It's kept in lockstep with every token
// rotation (see applySession) so biometric sign-in keeps working after the
// very first refresh cycle, instead of dying the moment the initially
// registered refresh token gets rotated out from under it.
const BIOMETRIC_REFRESH_TOKEN_KEY = "deeply_biometric_refresh_token";
const SIGNIN_METHOD_KEY = "deeply_signin_method";

// Refresh this many ms before actual expiry, so we never hand out a token
// that's about to die mid-request.
const REFRESH_BUFFER_MS = 60_000;

setAuthTokenGetter(() => localStorage.getItem(ACCESS_TOKEN_KEY));

interface AuthContextType {
  token: string | null;
  login: (accessToken: string, refreshToken: string, expiresIn: number) => void;
  logout: () => void;
  isAuthenticated: boolean;
  blockInfo: BlockInfo | null;
  clearBlockInfo: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(localStorage.getItem(ACCESS_TOKEN_KEY));
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ensures concurrent 401s all wait on the SAME refresh attempt instead of
  // firing multiple parallel refreshes (which would race against Supabase's
  // single-use/rotating refresh tokens and likely break one of them).
  const refreshPromiseRef = useRef<Promise<string | null> | null>(null);
  // The real, unpatched fetch — used internally so our own refresh/retry
  // calls never recursively re-enter the interceptor below.
  const originalFetchRef = useRef<typeof window.fetch>(window.fetch.bind(window));
  const [blockInfo, setBlockInfo] = useState<BlockInfo | null>(null);

  const clearRefreshTimer = () => {
    if (refreshTimer.current) {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }
  };

  const logout = () => {
    clearRefreshTimer();
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(EXPIRES_AT_KEY);
    setAuthTokenGetter(() => null);
    setToken(null);
    setSentryUser(null);
    if (Capacitor.isNativePlatform()) {
      GoogleSignIn.signOut().catch(() => {
        // Non-fatal — our own session is already cleared above regardless.
      });
    }
    // Wipe every cached query — without this, react-query's cache is a
    // module-level singleton that outlives logout, so anything fetched
    // via a hook (profile, matches, messages, discover deck) can still
    // serve the PREVIOUS account's stale data to whoever logs in next on
    // this device, until each query happens to refetch on its own. Given
    // this is a dating app, that's both a confusing-UI bug (e.g. an
    // already-onboarded user getting bounced to onboarding because a
    // stale query still says onboarding_completed: false) and a real
    // cross-account data leak risk.
    queryClient.clear();
    // Same reasoning as queryClient.clear() above, for the separate
    // localStorage-backed persistent cache used by Search, Invites,
    // Matches, Preferences, and Profile to show instant content across
    // full app restarts — without this, that cache is exactly the same
    // cross-account data leak risk queryClient.clear() exists to prevent,
    // just via a different storage mechanism.
    clearAllPersistentCaches();
    setLocation("/");
  };

  const scheduleRefresh = (expiresAt: number) => {
    clearRefreshTimer();
    const delay = Math.max(0, expiresAt - Date.now() - REFRESH_BUFFER_MS);
    refreshTimer.current = setTimeout(() => {
      void doRefresh();
    }, delay);
  };

  const applySession = (accessToken: string, refreshToken: string, expiresIn: number) => {
    const expiresAt = Date.now() + expiresIn * 1000;
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    localStorage.setItem(EXPIRES_AT_KEY, String(expiresAt));
    // If biometric sign-in is enabled, roll the gated copy forward too —
    // otherwise it'd still hold the token from whenever it was registered,
    // which will eventually be a stale/already-rotated-out refresh token.
    if (localStorage.getItem(SIGNIN_METHOD_KEY) === "biometric") {
      localStorage.setItem(BIOMETRIC_REFRESH_TOKEN_KEY, refreshToken);
    }
    setAuthTokenGetter(() => accessToken);
    setToken(accessToken);
    scheduleRefresh(expiresAt);
  };

  // Returns the fresh access token on success, or null if refresh failed
  // (in which case logout() has already been triggered).
  const doRefresh = async (): Promise<string | null> => {
    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }

    const promise = (async (): Promise<string | null> => {
      const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
      if (!refreshToken) {
        logout();
        return null;
      }
      try {
        const res = await originalFetchRef.current("/api/auth/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Refresh failed");
        applySession(body.access_token, body.refresh_token, body.expires_in);
        return body.access_token as string;
      } catch {
        // Refresh token is invalid/expired too — nothing to do but log out
        // and let the user sign in again.
        logout();
        return null;
      } finally {
        refreshPromiseRef.current = null;
      }
    })();

    refreshPromiseRef.current = promise;
    return promise;
  };

  const login = (accessToken: string, refreshToken: string, expiresIn: number) => {
    queryClient.clear();
    applySession(accessToken, refreshToken, expiresIn);

    // Tag Sentry with who this is, straight from the JWT's own payload —
    // avoids an extra network round-trip just to attach an identity to
    // error reports.
    try {
      const payload = JSON.parse(atob(accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      setSentryUser({ id: payload.sub, email: payload.email });
    } catch {
      // Non-fatal — error reports just won't have a user attached.
    }
  };

  // On app load: if we have a stored session, refresh immediately when
  // it's already expired (or about to be), otherwise just schedule the
  // next silent refresh.
  useEffect(() => {
    const storedAccess = localStorage.getItem(ACCESS_TOKEN_KEY);
    const storedExpiresAt = Number(localStorage.getItem(EXPIRES_AT_KEY) ?? 0);

    if (!storedAccess) return;

    if (!storedExpiresAt || storedExpiresAt - Date.now() < REFRESH_BUFFER_MS) {
      void doRefresh();
    } else {
      scheduleRefresh(storedExpiresAt);
    }

    return () => clearRefreshTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reactive fallback — this is what actually saves us when the PROACTIVE
  // scheduled refresh above misses its window, which happens often on
  // mobile: browsers throttle or fully pause setTimeout while a tab is
  // backgrounded or the screen is locked. We patch window.fetch so that
  // ANY 401 response to a request carrying one of our own Bearer tokens
  // triggers a one-time refresh-and-retry, instead of failing forever.
  useEffect(() => {
    const original = originalFetchRef.current;

    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await original(input, init);

      // Detect a ban/suspension taking effect mid-session — requireAuth
      // returns this on EVERY request once an account is blocked, so this
      // catches it immediately regardless of which page/action triggered
      // it, rather than leaving the user on a broken page with no
      // explanation. Clone the response so the original body can still be
      // read normally by whatever code made this request.
      if (response.status === 403) {
        try {
          const cloned = response.clone();
          const body = await cloned.json();
          if (body?.code === "BANNED" || body?.code === "SUSPENDED") {
            setBlockInfo({ code: body.code, reason: body.reason, suspendedUntil: body.suspendedUntil });
            logout();
            return response;
          }
        } catch {
          // Not JSON, or some other unrelated 403 (e.g. blocked-user
          // messaging, insufficient admin scope) — ignore and fall through.
        }
      }

      if (response.status !== 401) return response;
      if ((init as { __isRetry?: boolean } | undefined)?.__isRetry) return response;

      const headers = init?.headers;
      const authValue =
        headers instanceof Headers
          ? headers.get("Authorization")
          : Array.isArray(headers)
            ? headers.find(([k]) => k.toLowerCase() === "authorization")?.[1]
            : (headers as Record<string, string> | undefined)?.["Authorization"];

      // Only intercept requests carrying one of OUR tokens — avoids
      // touching unrelated fetches (other origins, unauthenticated calls).
      if (!authValue?.startsWith("Bearer ")) return response;

      const newToken = await doRefresh();
      if (!newToken) return response;

      const retryHeaders = new Headers(init?.headers);
      retryHeaders.set("Authorization", `Bearer ${newToken}`);
      return original(input, { ...init, headers: retryHeaders, __isRetry: true } as RequestInit);
    }) as typeof window.fetch;

    return () => {
      window.fetch = original;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Native only: one-time setup so GoogleSignIn.signIn() is ready by the
  // time the user taps the button on AuthPage — must run before any
  // sign-in attempt, and before logout()'s signOut() call below too, so
  // this lives at the top of the provider's lifetime rather than lazily
  // on AuthPage itself.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    GoogleSignIn.initialize({
      // The WEB client ID from Google Cloud Console — NOT the Android
      // client ID. Android's Credential Manager verifies the calling
      // app via the separate Android OAuth client (package name + SHA-1
      // fingerprint), but the token it returns asserts this Web client
      // as its audience, which is what Supabase's signInWithIdToken
      // expects to see.
      clientId: "994284965352-vhmhm0pv3jt451b3nemha4119uj2vbr4.apps.googleusercontent.com",
    }).catch((err) => {
      console.error("Failed to initialize GoogleSignIn:", err);
    });
  }, []);

  return (
    <AuthContext.Provider
      value={{
        token,
        login,
        logout,
        isAuthenticated: !!token,
        blockInfo,
        clearBlockInfo: () => setBlockInfo(null),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

// --- Biometric sign-in helpers -------------------------------------------
// Plain module-level functions (not part of AuthContextType) so both
// SettingsPage (to register/unregister) and AuthPage (to sign in) can read
// and write this without needing to be inside the provider tree in any
// special way beyond the usual localStorage access.

export type SignInMethod = "password" | "biometric";

export function getSignInMethod(): SignInMethod {
  return localStorage.getItem(SIGNIN_METHOD_KEY) === "biometric" ? "biometric" : "password";
}

export function getCurrentRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

// Call after confirming biometric enrollment succeeded, to turn the
// feature on and snapshot the current refresh token as the gated copy.
export function enableBiometricSignIn(refreshToken: string) {
  localStorage.setItem(SIGNIN_METHOD_KEY, "biometric");
  localStorage.setItem(BIOMETRIC_REFRESH_TOKEN_KEY, refreshToken);
}

// Turns biometric sign-in off and wipes the gated copy. Does not touch the
// normal session (ACCESS_TOKEN_KEY / REFRESH_TOKEN_KEY) — the user stays
// logged in on this device, they just won't be offered fingerprint at their
// next login.
export function disableBiometricSignIn() {
  localStorage.removeItem(SIGNIN_METHOD_KEY);
  localStorage.removeItem(BIOMETRIC_REFRESH_TOKEN_KEY);
}

// For AuthPage: the refresh token to use once the OS-level biometric
// prompt has succeeded. Null means biometric was never registered, or was
// switched off.
export function loadBiometricRefreshToken(): string | null {
  if (getSignInMethod() !== "biometric") return null;
  return localStorage.getItem(BIOMETRIC_REFRESH_TOKEN_KEY);
}
