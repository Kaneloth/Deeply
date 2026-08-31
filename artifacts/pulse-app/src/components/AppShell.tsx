import { ReactNode, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { BottomNav } from "@/components/BottomNav";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import { UpdateBanner } from "@/components/UpdateBanner";
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
      // anywhere else in a long list.
      //
      // Deliberately checks <main>'s (el's) own scrollTop directly,
      // NOT whatever nested scrollable element the touch happened to
      // start within. An earlier version of this file walked up from
      // the actual touch target to find its nearest genuinely-
      // scrollable ancestor, specifically to handle in-page overlays
      // (SearchPage/InvitesPage's ProfileDetailOverlay/
      // InviteDetailOverlay) whose own inner content scrolls
      // independently of <main>. That approach was reverted: it
      // reintroduced a "glitches on the first attempt" symptom this
      // gesture system was originally built to eliminate. The fix
      // moved to where the actual ambiguity lives: SearchPage/
      // InvitesPage now explicitly disable their own registered
      // handler (via usePullToRefresh's `enabled` param) while their
      // overlay is open, so refreshHandlerRef.current is genuinely null
      // during that time and this function never engages at all — the
      // same effective outcome as MatchDetailPage being a separate
      // route that unmounts MatchesPage. <main> being the single thing
      // checked here is correct for every other case, including a
      // long, genuinely scrollable list — <main> IS what scrolls there,
      // so this was never actually wrong for that case.
      if (el.scrollTop > 0) return;
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
      <UpdateBanner />
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
        {/* Always the SAME <div>, in the SAME position, every single
            render — only its style toggles between the two states
            below. This is deliberate and load-bearing: an earlier
            version of this conditionally rendered EITHER `children`
            directly OR `children` wrapped in a <div>, switching between
            the two based on indicatorHeight > 0. React treats that as a
            structural change (children moving to a different position
            in the tree), not a style update — the instant the first
            touchmove made indicatorHeight go from 0 to non-zero, React
            would unmount and remount the entire page underneath the
            user's actual finger. Debug logging confirmed the exact
            symptom this caused: the touchstart under the user's finger
            never received a matching touchend at all (the DOM node it
            targeted no longer existed to receive one), so that whole
            first gesture was silently abandoned — what felt like "the
            first pull glitches" was actually the user's continuous
            drag being split into two disconnected gestures internally,
            with only the second half (a fresh touchstart on the
            now-remounted content) ever completing.
            
            display: "contents" at rest means this div produces NO box
            at all — children render exactly as if they were direct
            children of <main>, with zero layout impact, so this can't
            affect anything's sticky positioning or content height the
            rest of the time (the specific regression that caused an
            earlier, different attempt at a permanent wrapper — using a
            permanently-applied h-full class instead of toggling display
            like this — to be reverted). Only while actively pulling/
            refreshing does it become a real, transform-able box
            (display: "contents" elements can't have transforms
            applied), sized to <main>'s visible height so the translateY
            push-down reads correctly. Discover never registers a pull-
            to-refresh handler at all (see PullToRefreshContext's
            comment on why) — indicatorHeight is always 0 there, so this
            div is permanently in its display:contents, zero-impact
            state for that page regardless. */}
        <div
          style={{
            display: indicatorHeight > 0 ? "block" : "contents",
            height: indicatorHeight > 0 ? "100%" : undefined,
            transform: indicatorHeight > 0 ? `translateY(${indicatorHeight}px)` : undefined,
            transition: isRefreshing ? "transform 0.2s ease-out" : undefined,
          }}
        >
          {children}
        </div>
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
