import { createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode } from "react";
import { useAuth } from "./AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useRefetchOnAppResume } from "@/hooks/useRefetchOnAppResume";

// Thresholds are computed against the monthly free grant, matching the
// airtime-style notifications: "You have 75 Sparks left", etc.
// Previously hardcoded to 300 here — went stale the moment the admin
// changed the actual grant to 60, since every new user starts BELOW
// the resulting 75-Sparks 25% cutoff and got "Getting low" on their
// very first app open. Now read live from /api/sparks below, which
// also already accounts for founder status (2x), matching the same
// fix already applied server-side in sparks-helper.ts's own
// low-balance check.

const THRESHOLDS = [
  {
    key: "25",
    fraction: 0.25,
    title: "Getting low",
    description: (balance: number) => `You have ${balance} Sparks left. Top up to keep the conversation going.`,
  },
  {
    key: "10",
    fraction: 0.1,
    title: "Almost out",
    description: (balance: number) => `You have ${balance} Sparks left. Add more to stay connected.`,
  },
  {
    key: "0",
    fraction: 0,
    title: "Out of Sparks",
    description: () => "Recharge now or wait for your next monthly grant to keep going.",
  },
];

interface SparksContextType {
  balance: number | null;
  nextGrantAt: string | null;
  refresh: () => Promise<void>;
  // Lets a caller that's about to show its own, more specific toast
  // about a Sparks spend (e.g. ChatPage's 12-second chat-unlock
  // explainer) tell this context to hold off on ITS OWN low-balance
  // warning for a moment, rather than the two competing for the same
  // single-toast slot and evicting each other. See checkThresholds
  // below for how this is actually used.
  suppressThresholdToast: () => void;
}

const SparksContext = createContext<SparksContextType | undefined>(undefined);

export function SparksProvider({ children }: { children: ReactNode }) {
  const { token, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [balance, setBalance] = useState<number | null>(null);
  const [nextGrantAt, setNextGrantAt] = useState<string | null>(null);
  const notifiedThresholds = useRef<Set<string>>(new Set());
  const prevBalance = useRef<number | null>(null);
  // See suppressThresholdToast below.
  const suppressUntilRef = useRef<number>(0);

  const checkThresholds = useCallback(
    (newBalance: number, monthlyGrant: number) => {
      const prev = prevBalance.current;

      for (const t of THRESHOLDS) {
        const cutoff = Math.floor(monthlyGrant * t.fraction);
        const crossedDown = prev !== null && prev > cutoff && newBalance <= cutoff;
        const alreadyLowOnFirstLoad = prev === null && newBalance <= cutoff;

        if ((crossedDown || alreadyLowOnFirstLoad) && !notifiedThresholds.current.has(t.key)) {
          if (Date.now() < suppressUntilRef.current) {
            // Suppressed — deliberately NOT marked as notified, so this
            // exact crossing is still eligible to fire on the next
            // balance check instead of being permanently skipped.
            // Something more specific (e.g. ChatPage's chat-unlock
            // explainer, which already reports the Sparks spent as part
            // of its own message) was just shown, and evicting it from
            // the single-toast slot for a more generic low-balance
            // warning isn't worth it — this same warning reliably shows
            // up moments later once the window passes, exactly as if
            // nothing had suppressed it at all.
          } else {
            notifiedThresholds.current.add(t.key);
            toast({
              title: t.title,
              description: t.description(newBalance),
              variant: t.fraction === 0 ? "destructive" : "default",
            });
          }
        }

        // If the balance goes back above a threshold (grant or purchase),
        // allow that notification to fire again next time it's crossed.
        if (newBalance > cutoff) {
          notifiedThresholds.current.delete(t.key);
        }
      }

      prevBalance.current = newBalance;
    },
    [toast],
  );

  // Deliberately a fixed window rather than tied to any specific
  // caller's own toast duration — this context has no visibility into
  // how long whatever the caller just showed will stay on screen, and
  // guessing wrong in the "too short" direction defeats the whole
  // point. 12s matches the longest custom toast duration used anywhere
  // in the app today (ChatPage's chat-unlock explainer); callers with
  // a shorter toast just get a small amount of extra safety margin for
  // free.
  const suppressThresholdToast = useCallback(() => {
    suppressUntilRef.current = Date.now() + 12000;
  }, []);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/sparks", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const body = await res.json();
      setBalance(body.balance);
      setNextGrantAt(body.next_grant_at);
      checkThresholds(body.balance, body.monthly_grant_amount);
    } catch {
      // Silent — a failed background balance check shouldn't interrupt the user.
    }
  }, [token, checkThresholds]);

  useEffect(() => {
    if (!isAuthenticated) {
      setBalance(null);
      setNextGrantAt(null);
      prevBalance.current = null;
      notifiedThresholds.current.clear();
      return;
    }

    // Self-rescheduling with random jitter, rather than a fixed
    // setInterval — this app has 2-3 independent background polls
    // mounted essentially everywhere (unread-count, match indicator,
    // this one), each on its own fixed timer. With no jitter, they tend
    // to drift into phase with each other over time and fire in the
    // same instant, which on a marginal connection means several
    // requests queuing and competing at once instead of spreading out.
    // 60s base (up from 30s) since this is a low-priority safety net —
    // the balance already gets refreshed immediately after any actual
    // spend via an explicit refresh() call elsewhere; this periodic
    // check only exists to catch a monthly-grant boundary being crossed
    // while the app sits idle.
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    const BASE_MS = 60_000;
    const JITTER_MS = 20_000;

    const scheduleNext = () => {
      const jitter = (Math.random() - 0.5) * JITTER_MS;
      timeoutId = setTimeout(async () => {
        if (cancelled) return;
        await refresh();
        if (!cancelled) scheduleNext();
      }, BASE_MS + jitter);
    };

    refresh();
    scheduleNext();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // The balance shown throughout the app (including on Profile) comes
  // from here, not from any page's own cache — so this is the one that
  // actually matters for keeping the number the user sees accurate. A
  // background poll that silently fails right after the app resumes
  // (exactly when several requests tend to compete at once) would
  // otherwise leave a stale balance on screen until the next 60s+jitter
  // tick happens to land — this gives every resume an immediate, direct
  // chance to catch up instead of waiting on that timer.
  useRefetchOnAppResume(refresh);

  return (
    <SparksContext.Provider value={{ balance, nextGrantAt, refresh, suppressThresholdToast }}>
      {children}
    </SparksContext.Provider>
  );
}

export function useSparks() {
  const ctx = useContext(SparksContext);
  if (ctx === undefined) {
    throw new Error("useSparks must be used within a SparksProvider");
  }
  return ctx;
}
