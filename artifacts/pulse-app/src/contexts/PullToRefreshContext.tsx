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
 *  `onRefresh` doesn't need to be memoized — a fresh closure every
 *  render is fine and in fact intentional, since it keeps AppShell
 *  always calling the CURRENT closure (current token, current state)
 *  rather than one captured on first mount. Registration is cleared on
 *  unmount so navigating away correctly disables the gesture.
 *
 *  useLayoutEffect, not useEffect — useEffect callbacks are deferred
 *  until after the browser paints, so on a fresh navigation there was a
 *  real window where the new page was already visible/touchable but
 *  this effect (which points the shared ref at THIS page's onRefresh)
 *  hadn't run yet. useLayoutEffect runs synchronously right after the
 *  DOM updates but strictly before paint, closing that window. This
 *  alone did not resolve the reported "needs two pulls" bug in testing
 *  — see the pullDebugLog calls below and in AppShell.tsx, added to
 *  find out why directly rather than theorize further. */
export function usePullToRefresh(onRefresh: RefreshHandler): void {
  const ref = usePullToRefreshRef();
  useLayoutEffect(() => {
    pullDebugLog(`REGISTER handler (path=${window.location.pathname})`);
    ref.current = onRefresh;
    return () => {
      if (ref.current === onRefresh) {
        pullDebugLog(`UNREGISTER handler (path=${window.location.pathname})`);
        ref.current = null;
      } else {
        pullDebugLog(`UNREGISTER skipped — ref already points elsewhere (path=${window.location.pathname})`);
      }
    };
  });
}
