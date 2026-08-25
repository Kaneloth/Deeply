import { ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
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
import { pullDebugLog, getPullDebugLines, subscribePullDebugLog, clearPullDebugLog } from "@/lib/pullDebugLog";

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

// TEMPORARY — on-screen panel showing pullDebugLog's live output, so
// the gesture can be diagnosed on a real device with no USB debugging
// set up. Safe to delete (along with pullDebugLog.ts and the log calls
// in this file and PullToRefreshContext.tsx) once resolved. Collapsed
// to a small tab by default so it doesn't get in the way of actually
// testing the gesture; tap to expand.
function PullDebugOverlay() {
  const [expanded, setExpanded] = useState(false);
  const lines = useSyncExternalStore(subscribePullDebugLog, getPullDebugLines);

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="fixed bottom-24 right-2 z-[200] bg-black/80 text-white text-[10px] px-2 py-1 rounded-md font-mono"
      >
        pull log ({lines.length})
      </button>
    );
  }

  return (
    <div className="fixed inset-x-2 bottom-24 z-[200] max-h-[50vh] bg-black/90 text-white rounded-lg p-2 flex flex-col">
      <div className="flex items-center justify-between mb-1 shrink-0">
        <span className="text-[10px] font-mono opacity-70">pull-to-refresh debug log</span>
        <div className="flex gap-2">
          <button onClick={() => clearPullDebugLog()} className="text-[10px] font-mono underline">
            clear
          </button>
          <button onClick={() => setExpanded(false)} className="text-[10px] font-mono underline">
            close
          </button>
        </div>
      </div>
      <div className="overflow-y-auto flex-1 text-[10px] font-mono leading-tight space-y-0.5">
        {lines.length === 0 ? (
          <p className="opacity-50">No events yet — try navigating or pulling.</p>
        ) : (
          lines.map((line, i) => <div key={i}>{line}</div>)
        )}
      </div>
    </div>
  );
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

  // TEMPORARY — logs every render of this component along with which
  // route it's for, so the debug log can show gesture-listener
  // attachment/detachment relative to actual navigations, not just
  // relative to handler registration.
  pullDebugLog(`AppShellInner render (location=${location})`);

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
    if (!el) {
      pullDebugLog("gesture-attach effect ran but mainRef.current is null — listeners NOT attached");
      return;
    }
    pullDebugLog("gesture-attach effect ran — listeners attached to <main>");

    const onTouchStart = (e: TouchEvent) => {
      if (isRefreshingRef.current) {
        pullDebugLog("touchstart: bailed — a refresh is already in progress");
        return;
      }
      if (!refreshHandlerRef.current) {
        pullDebugLog(`touchstart: bailed — refreshHandlerRef.current is NULL (path=${window.location.pathname})`);
        return;
      }
      // Only engage right at the top of the scroll area, same as the
      // native gesture — otherwise this would fight normal scrolling
      // anywhere else in a long list.
      if (el.scrollTop > 0) {
        pullDebugLog(`touchstart: bailed — scrollTop=${el.scrollTop} (not at top)`);
        return;
      }
      pullDebugLog(`touchstart: OK, gesture engaged (path=${window.location.pathname})`);
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

      pullDebugLog(
        `touchend: finalDistance=${finalDistance.toFixed(0)}px threshold=${PULL_THRESHOLD_PX}px hasHandler=${!!refreshHandlerRef.current}`,
      );

      if (finalDistance >= PULL_THRESHOLD_PX && refreshHandlerRef.current) {
        pullDebugLog("touchend: triggering refresh handler");
        isRefreshingRef.current = true;
        setIsRefreshing(true);
        try {
          await refreshHandlerRef.current();
          pullDebugLog("touchend: refresh handler resolved successfully");
        } catch (err) {
          pullDebugLog(`touchend: refresh handler THREW: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          isRefreshingRef.current = false;
          setIsRefreshing(false);
        }
      } else {
        pullDebugLog("touchend: below threshold or no handler — no refresh triggered");
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);

    return () => {
      pullDebugLog("gesture-attach effect cleanup — listeners removed from <main>");
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
        {/* Always the SAME div, every render — only its className/style
            toggle based on indicatorHeight, never whether the div
            itself exists. This is the fix for the actual root cause of
            "needs two pulls": the previous version switched between
            {children} being a direct child of <main> and {children}
            being wrapped in a div, depending on indicatorHeight. React
            reconciles by element type at each position in the tree —
            switching between "no wrapper" and "div wrapper" at the same
            position meant the div itself was a genuinely different
            element type appearing where {children} used to be directly,
            which made React unmount the entire previous subtree
            (including the whole page component, all its state, and its
            own usePullToRefresh registration) and mount a fresh one —
            confirmed directly via debug logs showing the page's pull
            handler unregister+reregister firing the instant the first
            touchmove made indicatorHeight go from 0 to positive, on
            every single page tested. The DOM node the finger was
            physically touching was being destroyed mid-gesture.

            display: contents at rest, not just "no className" — an
            UNSTYLED div still generates a real box, defaulting to
            height: auto (collapses to content height) rather than
            inheriting <main>'s own flex-computed height. That broke
            Discover specifically: its card stack positions cards
            absolute relative to a height-bearing ancestor, which used
            to be <main> itself when children were direct children of
            it — wrapped in even a plain div, that ancestor's height
            collapsed to zero, blanking the card and collapsing
            everything below it (the decision buttons) up to just under
            the header. display: contents makes the div itself produce
            NO box at all and disappear from layout entirely — its
            children render exactly as if they were direct children of
            <main>, identical to the original no-wrapper behavior —
            while the div still fully exists as a real, permanent DOM/
            React node throughout, which is what actually prevents the
            remount. Switched to a real, transformable box (h-full +
            translateY) only while actively pulling, exactly matching
            the original temporary-wrapper behavior during a pull —
            transforms don't apply to display:contents elements, so it
            has to become a real box for that brief window regardless. */}
        <div
          className={indicatorHeight > 0 ? "h-full" : undefined}
          style={
            indicatorHeight > 0
              ? { transform: `translateY(${indicatorHeight}px)`, transition: isRefreshing ? "transform 0.2s ease-out" : undefined }
              : { display: "contents" }
          }
        >
          {children}
        </div>
      </main>

      <BottomNav />
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
