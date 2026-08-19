import { createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode } from "react";
import { useAuth } from "./AuthContext";
import { useToast } from "@/hooks/use-toast";

// Thresholds are computed against the monthly free grant, matching the
// airtime-style notifications: "You have 75 Sparks left", etc.
const MONTHLY_GRANT = 300;

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
}

const SparksContext = createContext<SparksContextType | undefined>(undefined);

export function SparksProvider({ children }: { children: ReactNode }) {
  const { token, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [balance, setBalance] = useState<number | null>(null);
  const [nextGrantAt, setNextGrantAt] = useState<string | null>(null);
  const notifiedThresholds = useRef<Set<string>>(new Set());
  const prevBalance = useRef<number | null>(null);

  const checkThresholds = useCallback(
    (newBalance: number) => {
      const prev = prevBalance.current;

      for (const t of THRESHOLDS) {
        const cutoff = Math.floor(MONTHLY_GRANT * t.fraction);
        const crossedDown = prev !== null && prev > cutoff && newBalance <= cutoff;
        const alreadyLowOnFirstLoad = prev === null && newBalance <= cutoff;

        if ((crossedDown || alreadyLowOnFirstLoad) && !notifiedThresholds.current.has(t.key)) {
          notifiedThresholds.current.add(t.key);
          toast({
            title: t.title,
            description: t.description(newBalance),
            variant: t.fraction === 0 ? "destructive" : "default",
          });
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
      checkThresholds(body.balance);
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

  return (
    <SparksContext.Provider value={{ balance, nextGrantAt, refresh }}>
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
