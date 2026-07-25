import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { useLocation } from "wouter";

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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(localStorage.getItem(ACCESS_TOKEN_KEY));
  const [, setLocation] = useLocation();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const doRefresh = async () => {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) {
      logout();
      return;
    }
    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Refresh failed");
      applySession(body.access_token, body.refresh_token, body.expires_in);
    } catch {
      // Refresh token is invalid/expired too — nothing to do but log out
      // and let the user sign in again.
      logout();
    }
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

  return (
    <AuthContext.Provider
      value={{
        token,
        login,
        logout,
        isAuthenticated: !!token,
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
