import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import type { BlockInfo } from "@/components/BlockedAccountScreen";

const ACCESS_TOKEN_KEY = "deeply_access_token";
const REFRESH_TOKEN_KEY = "deeply_refresh_token";
const EXPIRES_AT_KEY = "deeply_expires_at";

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
    setAuthTokenGetter(() => accessToken);
    setToken(accessToken);
    scheduleRefresh(expiresAt);
  };

  // Returns the fresh access token on success, or null if refresh failed
  // (in which case logout() has already been triggered).
  const doRefresh = async (): Promise<string | null> => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;

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
    applySession(accessToken, refreshToken, expiresIn);
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
