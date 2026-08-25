import { createContext, useContext, useLayoutEffect, useRef, MutableRefObject, ReactNode } from "react";
import { pullDebugLog } from "@/lib/pullDebugLog";

type RefreshHandler = () => Promise<void> | void;

// Same registration pattern as DiscoverControlsContext (a page opts in
// by registering itself; AppShell reads whatever's currently
// registered) — but backed by a ref instead of state, since AppShell
// only ever needs the LATEST handler at the moment a gesture completes,
// never a re-render when it changes. Using state here would mean every
// page mount/unmount (i.e. every navigation) re-renders AppShell and
// everything inside <main>, which is exactly the kind of unnecessary-
// re-render-triggers-remount problem already called out in App.tsx's
// comment about inline route components.
const PullToRefreshRefContext = createContext<MutableRefObject<RefreshHandler | null> | undefined>(undefined);

export function PullToRefreshProvider({ children }: { children: ReactNode }) {
  const ref = useRef<RefreshHandler | null>(null);
  return <PullToRefreshRefContext.Provider value={ref}>{children}</PullToRefreshRefContext.Provider>;
}

/** Used by AppShell only — pages should use usePullToRefresh below
 *  instead. */
export function usePullToRefreshRef() {
  const ctx = useContext(PullToRefreshRefContext);
  if (ctx === undefined) {
    throw new Error("usePullToRefreshRef must be used within a PullToRefreshProvider");
  }
  return ctx;
}

/** Call from any page to make the pull-down-to-refresh gesture active
 *  while that page is mounted, running `onRefresh` when the user
 *  completes the gesture. Pages that never call this (Discover, in
 *  particular, where a downward pull already has its own meaning —
 *  revealing the next candidate — plus Preferences, Settings, Admin,
 *  etc.) simply never register a handler, so AppShell's gesture stays
 *  fully inert there — no route-list or special-casing needed.
 *
 *  Two separate refs, deliberately: `latestOnRefresh` always holds the
 *  most recent closure, updated on every render as a plain assignment
 *  during render — not inside an effect, so it has zero registration
 *  side effects and can't cause any churn no matter how often this
 *  component re-renders. The SHARED context ref (from
 *  usePullToRefreshRef) is set to a stable wrapper function exactly
 *  ONCE per mount, in a mount/unmount-only effect — that wrapper simply
 *  calls whatever's currently in latestOnRefresh at the moment
 *  AppShell's gesture completes, so it's always calling the current
 *  logic despite never itself needing to change.
 *
 *  This replaces an earlier version that set the shared ref directly,
 *  in a no-dependency-array effect re-run on every render. That worked
 *  correctly on paper, but in practice caused a real, measurable amount
 *  of unregister/re-register churn: any state update anywhere in
 *  AppShell (including, notably, the pull gesture's OWN setPullDistance
 *  calls during onTouchMove, which fire continuously while actively
 *  dragging) re-renders the page tree, re-running this effect and
 *  briefly nulling the shared ref before restoring it. First-capture
 *  debug logs showed this happening many times per second during an
 *  active gesture and even between renders with no user interaction at
 *  all. It's not confirmed to be the root cause of the reported "needs
 *  two pulls" bug, but it's a real, needless source of exactly the
 *  kind of brief-ref-is-null window that bug would look like, and is
 *  worth eliminating regardless of whether it's the whole explanation. */
export function usePullToRefresh(onRefresh: RefreshHandler): void {
  const ref = usePullToRefreshRef();
  const latestOnRefresh = useRef(onRefresh);
  latestOnRefresh.current = onRefresh;

  useLayoutEffect(() => {
    pullDebugLog(`REGISTER stable wrapper (path=${window.location.pathname})`);
    const wrapper: RefreshHandler = () => latestOnRefresh.current();
    ref.current = wrapper;
    return () => {
      if (ref.current === wrapper) {
        pullDebugLog(`UNREGISTER stable wrapper (path=${window.location.pathname})`);
        ref.current = null;
      } else {
        pullDebugLog(`UNREGISTER skipped — ref already points elsewhere (path=${window.location.pathname})`);
      }
    };
    // Intentionally empty deps — this now runs ONLY on mount/unmount,
    // never on every render, since the wrapper it registers never needs
    // to change; it always reads the current value via latestOnRefresh
    // regardless of when it's called.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
