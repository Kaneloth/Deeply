import { ReactNode, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { BottomNav } from "@/components/BottomNav";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { TextSizeProvider } from "@/contexts/TextSizeContext";
import { DiscoverControlsProvider } from "@/contexts/DiscoverControlsContext";
import { PullToRefreshProvider, usePullToRefreshRef } from "@/contexts/PullToRefreshContext";
import { useAuth } from "@/contexts/AuthContext";
import { BlockedAccountScreen } from "@/components/BlockedAccountScreen";

interface AppShellProps {
  children: ReactNode;
}

// Pull needs to travel this far (in already-damped, on-screen pixels)
// before releasing triggers a refresh — matches the rough feel of the
// native gesture this is modeled on (X, TikTok, etc.).
const PULL_THRESHOLD_PX = 70;
// Hard ceiling on how far the indicator can be dragged down, regardless
// of how far the finger actually travels — keeps the damped pull from
// pushing page content awkwardly far down.
const MAX_PULL_PX = 100;
// How much of the raw finger movement actually translates to visual
// pull distance — makes the gesture feel like it has resistance, same
// as the native version, rather than tracking 1:1 with the finger.
const PULL_DAMPING = 0.5;

/** Walks up from the actual touched element to find the nearest node
 *  that's genuinely scrollable (overflow-y auto/scroll AND has content
 *  taller than its own box) — stopping at `boundary` (<main> itself) if
 *  nothing closer qualifies. This is what onTouchStart below checks the
 *  scrollTop of, instead of always checking <main>'s.
 *
 *  Why this matters: <main> is a single, page-wide scroll container
 *  that every route's content renders inside. For a plain list (a
 *  page's own search/invite results, no overlay open), <main> IS the
 *  actual thing that scrolls, so checking its scrollTop is already
 *  correct — this function just resolves back to `boundary` in that
 *  case, unchanged from before. But when a page renders an in-page,
 *  fixed-position detail overlay on top of itself (e.g. SearchPage's
 *  and InvitesPage's ProfileDetailOverlay/InviteDetailOverlay — as
 *  opposed to MatchDetailPage, which is a genuinely separate ROUTE, so
 *  navigating to it unmounts MatchesPage and automatically clears its
 *  registered handler via usePullToRefresh's own cleanup), that overlay
 *  is still DOM-wise a child rendered inside <main> — just visually
 *  `position: fixed` on top of everything. <main> itself never scrolls
 *  at all while such an overlay is open; the overlay's own inner
 *  content (e.g. ProfileCard's own scrollable area) is a completely
 *  separate, nested scroll container with its own independent
 *  scrollTop. Previously, scrolling that inner area down to reveal
 *  details and then dragging down again to scroll back up would bubble
 *  up to <main>'s listener, which always saw <main>'s own scrollTop
 *  frozen at 0 (since it never moved) and wrongly claimed the gesture
 *  as a pull-to-refresh — even though the actual element being touched
 *  was nowhere near its own top. Resolving to the REAL scrollable
 *  ancestor of the touch fixes this generally, for any current or
 *  future nested scroll area, rather than special-casing overlays by
 *  page.
 *
 *  Checks classList for the literal "overflow-y-auto" Tailwind class
 *  (the exact class both <main> and ProfileCard's own scroll container
 *  actually use) rather than window.getComputedStyle(node).overflowY.
 *  An earlier version of this function used getComputedStyle, which
 *  forces a synchronous style recalculation — for the common case (no
 *  overlay open), the actual touch target is typically several DOM
 *  levels below <main> (a tile, a row, an icon), so this loop walks up
 *  through many intermediate elements before reaching <main> and
 *  returning it, paying that recalculation cost at EVERY level, on
 *  EVERY touch. This gesture has already proven, in earlier debugging
 *  this session, to be extremely sensitive to exactly this kind of
 *  added latency inside onTouchStart — that version reintroduced a
 *  "glitches on the first attempt" symptom close to the original bug
 *  this whole gesture system was built to avoid. classList.contains is
 *  a cheap set lookup with no style recalculation; scrollHeight/
 *  clientHeight are still layout-dependent but far cheaper than a full
 *  computed-style pass, and are now only read for the one or two
 *  elements that actually have the class, not every ancestor walked.
 *  Trade-off: a future new scrollable container must use this exact
 *  class for this function to recognize it — if one's ever added via
 *  inline style or a differently-named utility instead, add its
 *  marker here too. */
function findScrollableAncestor(target: EventTarget | null, boundary: HTMLElement): HTMLElement {
  let node = target instanceof Node ? (target instanceof HTMLElement ? target : target.parentElement) : null;
  while (node && node !== boundary) {
    if (node.classList.contains("overflow-y-auto") && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return boundary;
}

function AppShellInner({ children }: AppShellProps) {
  const [location] = useLocation();
  const { blockInfo, clearBlockInfo } = useAuth();
  const refreshHandlerRef = usePullToRefreshRef();

  // Computed early (before the gesture effect below) rather than in its
  // usual spot right before the JSX return — this effect needs it as a
  // dependency, and hooks must be called unconditionally before any
  // early return, so the value has to exist before that point too.
  const hideChrome = location === "/" || location === "/onboarding" || location === "/reset-password";
  const mainShouldExist = !blockInfo && !hideChrome;

  const mainRef = useRef<HTMLDivElement>(null);
  const touchStartYRef = useRef<number | null>(null);
  const isPullingRef = useRef(false);
  const pullDistanceRef = useRef(0);
  const isRefreshingRef = useRef(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Depends on mainShouldExist — NOT empty deps. <main> (and mainRef)
  // only exists in the non-hideChrome, non-blocked branch below; a
  // fresh login routinely renders the hideChrome branch first (the auth
  // page) before ever reaching a page with <main> at all. With empty
  // deps, this effect ran exactly once on that very first commit, found
  // mainRef.current still null, and exited — permanently, since empty
  // deps means it never runs again even after <main> mounts moments
  // later. That's not a flaky edge case, it's the normal shape of every
  // login: the gesture was never actually attached for practically any
  // real session. Re-running whenever mainShouldExist flips to true
  // fixes this — by the time this effect body runs, React has already
  // committed the DOM and set the ref, so mainRef.current is guaranteed
  // to be populated on that pass.
  //
  // Otherwise unchanged: everything inside still reads through refs, so
  // a pull in progress is never disrupted, and this doesn't re-run on
  // every render — only when <main>'s presence actually changes.
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      if (isRefreshingRef.current || !refreshHandlerRef.current) return;
      // Only engage right at the top of the scroll area, same as the
      // native gesture — otherwise this would fight normal scrolling
      // anywhere else in a long list. Checks the scrollTop of whatever
      // scrollable element the touch actually started within (see
      // findScrollableAncestor above), not always <main> itself.
      const scrollTarget = findScrollableAncestor(e.target, el);
      if (scrollTarget.scrollTop > 0) return;
      touchStartYRef.current = e.touches[0].clientY;
      isPullingRef.current = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!isPullingRef.current || touchStartYRef.current === null) return;
      const delta = e.touches[0].clientY - touchStartYRef.current;
      if (delta <= 0) {
        // Finger moved back up (or never moved down) — not a pull,
        // leave the browser's own scroll behavior alone.
        pullDistanceRef.current = 0;
        setPullDistance(0);
        return;
      }
      // Once genuinely pulling, stop the browser's own rubber-band
      // bounce from fighting this gesture.
      e.preventDefault();
      const damped = Math.min(delta * PULL_DAMPING, MAX_PULL_PX);
      pullDistanceRef.current = damped;
      setPullDistance(damped);
    };

    const onTouchEnd = async () => {
      if (!isPullingRef.current) return;
      isPullingRef.current = false;
      touchStartYRef.current = null;
      const finalDistance = pullDistanceRef.current;
      pullDistanceRef.current = 0;
      setPullDistance(0);

      if (finalDistance >= PULL_THRESHOLD_PX && refreshHandlerRef.current) {
        isRefreshingRef.current = true;
        setIsRefreshing(true);
        try {
          await refreshHandlerRef.current();
        } finally {
          isRefreshingRef.current = false;
          setIsRefreshing(false);
        }
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainShouldExist]);

  // The inner <main> is the app scroller, but Android Chrome/WebView can
  // still hand a top-edge gesture to the document when that scroller is at
  // scrollTop 0. Disable overscroll chaining on the document for app pages
  // so the browser's native pull-to-refresh cannot consume the first pull.
  useEffect(() => {
    if (!mainShouldExist) return;
    const html = document.documentElement;
    const body = document.body;
    const previousHtml = html.style.overscrollBehaviorY;
    const previousBody = body.style.overscrollBehaviorY;
    html.style.overscrollBehaviorY = "none";
    body.style.overscrollBehaviorY = "none";
    return () => {
      html.style.overscrollBehaviorY = previousHtml;
      body.style.overscrollBehaviorY = previousBody;
    };
  }, [mainShouldExist]);

  // A ban/suspension can be detected mid-session, on any route — this
  // takes over the entire screen regardless of what would otherwise
  // render, since continuing to show the underlying page while a "you've
  // been banned" state exists would be confusing.
  if (blockInfo) {
    return <BlockedAccountScreen blockInfo={blockInfo} onBack={clearBlockInfo} />;
  }

  if (hideChrome) {
    return (
      // overflow-y-auto, NOT overflow-hidden — these pages (especially
      // the signup form on AuthPage) can be taller than the viewport on
      // shorter/smaller screens. overflow-hidden made that content
      // completely unreachable: not just scrolled past, but physically
      // impossible to scroll to at all, since there was no way to
      // scroll in the first place.
      <div className="w-full max-w-[430px] mx-auto min-h-[100dvh] bg-background relative overflow-y-auto flex flex-col">
        {children}
      </div>
    );
  }

  const indicatorHeight = isRefreshing ? 50 : pullDistance;

  return (
    <div className="w-full max-w-[430px] mx-auto h-[100dvh] bg-background relative flex flex-col overflow-hidden overscroll-y-none">
      <TopBar />
      <AnnouncementBanner />

      {/* overscroll-y-none is the fix for a real glitch: without it, the
          browser/WebView's OWN native pull-to-refresh/rubber-band effect
          can fire alongside our custom gesture on this exact element —
          visually a second, plain (non-branded) spinner competing with
          ours, and functionally the cause of needing two pulls before
          it "took": the first gesture was partly consumed by the
          native behavior before our handlers could cleanly own it. This
          explicitly tells the browser this element handles its own
          overscroll, so it stops trying to layer its own gesture on
          top. */}
      <main ref={mainRef} className="flex-1 overflow-y-auto overscroll-y-none pb-20 no-scrollbar relative" style={{ overscrollBehaviorY: "none" }}>
        {indicatorHeight > 0 && (
          <div
            className="absolute left-0 right-0 top-0 flex items-center justify-center overflow-hidden pointer-events-none z-10"
            style={{ height: indicatorHeight, transition: isRefreshing ? "height 0.2s ease-out" : undefined }}
          >
            <Loader2
              size={20}
              className={`text-primary ${isRefreshing || pullDistance >= PULL_THRESHOLD_PX ? "animate-spin" : ""}`}
              style={{ opacity: Math.min(indicatorHeight / PULL_THRESHOLD_PX, 1) }}
            />
          </div>
        )}
        {indicatorHeight > 0 ? (
          // Only exists while actively pulling/refreshing — the h-full
          // here clamps this wrapper to exactly <main>'s visible height
          // rather than the page's true (often taller, scrollable)
          // content height. That's fine for the brief moment a pull is
          // in progress, but making this permanent (as an earlier
          // version of this file did, to fix Discover's card stack
          // needing a definite height to fill) broke every other
          // page's own position: sticky bottom-anchored elements (e.g.
          // Save buttons on Profile/Preferences) the rest of the time —
          // sticky positioning needs its container sized to the real
          // content, not artificially clamped to viewport height.
          // Discover itself never registers a pull-to-refresh handler
          // (see PullToRefreshContext's comment on why), so it never
          // hits this branch at all — its children are always direct
          // children of <main>, exactly as before, with no wrapper
          // interference ever.
          <div
            className="h-full"
            style={{ transform: `translateY(${indicatorHeight}px)`, transition: isRefreshing ? "transform 0.2s ease-out" : undefined }}
          >
            {children}
          </div>
        ) : (
          children
        )}
      </main>

      <BottomNav />
    </div>
  );
}

export function AppShell({ children }: AppShellProps) {
  return (
    <ThemeProvider>
      <TextSizeProvider>
        <DiscoverControlsProvider>
          <PullToRefreshProvider>
            <AppShellInner>{children}</AppShellInner>
          </PullToRefreshProvider>
        </DiscoverControlsProvider>
      </TextSizeProvider>
    </ThemeProvider>
  );
}
