import { createContext, useContext, useEffect, useCallback, useState, ReactNode } from "react";
import { useAuth } from "./AuthContext";

const POLL_INTERVAL_MS = 45_000;
let latestInvitesBadgeRequest = 0;

interface InvitesContextType {
  invitesCount: number;
  refresh: () => Promise<void>;
  // Lets a page that just performed an action set the badge directly,
  // rather than trigger a fresh poll. A poll immediately after a write
  // (e.g. right after revealing invites) can hit the same Supabase
  // read-after-write lag traced elsewhere in this app — the poll's GET
  // request landing on a connection that hasn't yet seen the write this
  // same request just made moments earlier, showing a stale, too-high
  // count even though the reveal genuinely succeeded. Revealing marks
  // EVERY currently-pending invite as revealed in one action, so the
  // page that just did that already knows with certainty the new count
  // is 0 — no need to ask the server again and risk it answering with
  // stale data.
  setCount: (count: number) => void;
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
    const requestId = ++latestInvitesBadgeRequest;
    try {
      const res = await fetch("/api/discover/invites", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const body = await res.json();
      if (requestId !== latestInvitesBadgeRequest) return;
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

  const setCount = useCallback((count: number) => {
    latestInvitesBadgeRequest += 1;
    setInvitesCount(count);
  }, []);

  return <InvitesContext.Provider value={{ invitesCount, refresh, setCount }}>{children}</InvitesContext.Provider>;
}

export function useInvites() {
  const ctx = useContext(InvitesContext);
  if (ctx === undefined) {
    throw new Error("useInvites must be used within an InvitesProvider");
  }
  return ctx;
}
