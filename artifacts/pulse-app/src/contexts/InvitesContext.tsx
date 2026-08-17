import { createContext, useContext, useEffect, useCallback, useState, ReactNode } from "react";
import { useAuth } from "./AuthContext";

const POLL_INTERVAL_MS = 45_000;

interface InvitesContextType {
  invitesCount: number;
  refresh: () => Promise<void>;
}

const InvitesContext = createContext<InvitesContextType | undefined>(undefined);

export function InvitesProvider({ children }: { children: ReactNode }) {
  const { token, isAuthenticated } = useAuth();
  const [invitesCount, setInvitesCount] = useState(0);

  // Only new_count feeds the badge — NOT revealed.length. revealed is the
  // list of inviters already paid-for and permanently visible on the
  // Invites page; counting them here too would mean the badge never goes
  // down even after you've seen and dealt with every one of them. A nav
  // badge should mean "new/unseen".
  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/discover/invites", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const body = await res.json();
      setInvitesCount(body.new_count ?? 0);
    } catch {
      // Silent — non-critical background fetch.
    }
  }, [token]);

  useEffect(() => {
    if (!isAuthenticated) {
      setInvitesCount(0);
      return;
    }
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  return <InvitesContext.Provider value={{ invitesCount, refresh }}>{children}</InvitesContext.Provider>;
}

export function useInvites() {
  const ctx = useContext(InvitesContext);
  if (ctx === undefined) {
    throw new Error("useInvites must be used within an InvitesProvider");
  }
  return ctx;
}
