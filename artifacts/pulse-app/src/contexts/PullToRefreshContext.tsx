import { createContext, useContext, useLayoutEffect, useRef, MutableRefObject, ReactNode } from "react";

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
 *  useLayoutEffect, not useEffect — this was the actual cause of the
 *  "needs two pulls" bug that three separate rounds of overscroll-CSS
 *  and native-WebView-glow fixes failed to touch, because none of them
 *  were addressing the real mechanism. useEffect callbacks are deferred
 *  until after the browser paints — so on a fresh navigation, there's a
 *  real window where the new page is already visible and touchable, but
 *  this effect (which is what actually points the shared ref at THIS
 *  page's onRefresh) hasn't run yet. A pull attempted in that window
 *  hits AppShell's onTouchStart with a stale ref — either null, or
 *  still the PREVIOUS page's handler — and either silently does nothing
 *  or refreshes the wrong page. The very next pull works cleanly simply
 *  because, by then, plenty of time has passed for the deferred effect
 *  to have run. useLayoutEffect runs synchronously right after the DOM
 *  is updated but strictly before the browser paints, so the ref is
 *  guaranteed correct by the time the page is actually visible/
 *  touchable at all — there's no window left for a pull to land in. */
export function usePullToRefresh(onRefresh: RefreshHandler): void {
  const ref = usePullToRefreshRef();
  useLayoutEffect(() => {
    ref.current = onRefresh;
    return () => {
      if (ref.current === onRefresh) ref.current = null;
    };
  });
}
