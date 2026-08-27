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
import { logPullDebug } from "@/lib/pullDebugLog";
import { useAuth } from "@/contexts/AuthContext";
import { BlockedAccountScreen } from "@/components/BlockedAccountScreen";
import { PullDebugOverlay } from "@/components/PullDebugOverlay";

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

    // TEMPORARY debug tracking — see pullDebugLog.ts.
    logPullDebug(`effect ATTACHED listeners to <main> (mainShouldExist=${mainShouldExist})`);
    let hasLoggedFirstMoveThisGesture = false;

    const onTouchStart = (e: TouchEvent) => {
      if (isRefreshingRef.current) {
        logPullDebug("touchstart REJECTED — isRefreshingRef is true");
        return;
      }
      if (!refreshHandlerRef.current) {
        logPullDebug("touchstart REJECTED — no handler registered");
        return;
      }
      // Only engage right at the top of the scroll area, same as the
      // native gesture — otherwise this would fight normal scrolling
      // anywhere else in a long list.
      //
      // Deliberately checks <main>'s (el's) own scrollTop directly,
      // NOT whatever nested scrollable element the touch happened to
      // start within. An earlier version of this file walked up from
      // the actual touch target to find its nearest genuinely-
      // scrollable ancestor, specifically to handle in-page overlays
      // (SearchPage/InvitesPage's ProfileDetailOverlay/
      // InviteDetailOverlay) whose own inner content scrolls
      // independently of <main>. That approach was reverted: even
      // after replacing an expensive getComputedStyle-based check with
      // a cheaper classList one, it still reintroduced the exact
      // "glitches on the first attempt" symptom this gesture system
      // was originally built to eliminate — this system has proven, in
      // earlier debugging this session, to be unusually sensitive to
      // ANY added work inside onTouchStart, not just the specific cost
      // of getComputedStyle. Rather than keep tuning that approach's
      // performance, the fix moved to where the actual ambiguity lives:
      // SearchPage/InvitesPage now explicitly disable their own
      // registered handler (via usePullToRefresh's new `enabled`
      // param) while their overlay is open, so refreshHandlerRef.current
      // is genuinely null during that time and this function never
      // engages at all — the same effective outcome as MatchDetailPage
      // being a separate route that unmounts MatchesPage. <main> being
      // the single thing checked here is correct for every other case,
      // including a long, genuinely scrollable list — <main> IS what
      // scrolls there, so this was never actually wrong for that case.
      if (el.scrollTop > 0) {
        logPullDebug(`touchstart REJECTED — el.scrollTop=${el.scrollTop}`);
        return;
      }
      touchStartYRef.current = e.touches[0].clientY;
      isPullingRef.current = true;
      hasLoggedFirstMoveThisGesture = false;
      logPullDebug(`touchstart CLAIMED — scrollTop=${el.scrollTop}, startY=${touchStartYRef.current}`);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!isPullingRef.current || touchStartYRef.current === null) return;
      const delta = e.touches[0].clientY - touchStartYRef.current;
      if (delta <= 0) {
        // Finger moved back up (or never moved down) — not a pull,
        // leave the browser's own scroll behavior alone.
        if (!hasLoggedFirstMoveThisGesture) {
          logPullDebug(`first touchmove — delta=${delta.toFixed(0)} (<=0, not a pull)`);
          hasLoggedFirstMoveThisGesture = true;
        }
        pullDistanceRef.current = 0;
        setPullDistance(0);
        return;
      }
      // Once genuinely pulling, stop the browser's own rubber-band
      // bounce from fighting this gesture.
      e.preventDefault();
      const damped = Math.min(delta * PULL_DAMPING, MAX_PULL_PX);
      if (!hasLoggedFirstMoveThisGesture) {
        logPullDebug(`first touchmove — delta=${delta.toFixed(0)}, damped=${damped.toFixed(0)}, preventDefault called`);
        hasLoggedFirstMoveThisGesture = true;
      }
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

      logPullDebug(
        `touchend — finalDistance=${finalDistance.toFixed(0)}, threshold=${PULL_THRESHOLD_PX}, willRefresh=${finalDistance >= PULL_THRESHOLD_PX && !!refreshHandlerRef.current}`,
      );

      if (finalDistance >= PULL_THRESHOLD_PX && refreshHandlerRef.current) {
        isRefreshingRef.current = true;
        setIsRefreshing(true);
        try {
          await refreshHandlerRef.current();
          logPullDebug("refresh handler resolved successfully");
        } catch (err) {
          logPullDebug(`refresh handler THREW: ${err instanceof Error ? err.message : String(err)}`);
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
      logPullDebug("effect CLEANUP — removing listeners from <main>");
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
      {/* TEMPORARY — see pullDebugLog.ts's file-level comment for why
          this is here and how to remove it once the investigation
          concludes. */}
      <PullDebugOverlay />
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
