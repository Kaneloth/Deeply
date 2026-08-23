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

function AppShellInner({ children }: AppShellProps) {
  const [location] = useLocation();
  const { blockInfo, clearBlockInfo } = useAuth();
  const refreshHandlerRef = usePullToRefreshRef();

  const mainRef = useRef<HTMLDivElement>(null);
  const touchStartYRef = useRef<number | null>(null);
  const isPullingRef = useRef(false);
  const pullDistanceRef = useRef(0);
  const isRefreshingRef = useRef(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Attached once (empty deps) and reads everything through refs, so a
  // pull in progress never causes this effect to tear down and
  // re-subscribe mid-gesture. Only active at all when the current page
  // has registered a handler via usePullToRefresh — pages that haven't
  // (Discover, Preferences, Settings, Admin, etc.) leave
  // refreshHandlerRef.current null, so onTouchStart bails immediately
  // and the gesture is fully inert there, no route-checking needed.
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      if (isRefreshingRef.current || !refreshHandlerRef.current) return;
      // Only engage right at the top of the scroll area, same as the
      // native gesture — otherwise this would fight normal scrolling
      // anywhere else in a long list.
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
  }, []);

  // A ban/suspension can be detected mid-session, on any route — this
  // takes over the entire screen regardless of what would otherwise
  // render, since continuing to show the underlying page while a "you've
  // been banned" state exists would be confusing.
  if (blockInfo) {
    return <BlockedAccountScreen blockInfo={blockInfo} onBack={clearBlockInfo} />;
  }

  // Hide nav and top bar on auth and onboarding routes
  const hideChrome = location === "/" || location === "/onboarding" || location === "/reset-password";
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
    <div className="w-full max-w-[430px] mx-auto h-[100dvh] bg-background relative flex flex-col overflow-hidden">
      <TopBar />
      <AnnouncementBanner />

      <main ref={mainRef} className="flex-1 overflow-y-auto pb-20 no-scrollbar relative">
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
        <div
          className="h-full"
          style={
            indicatorHeight > 0
              ? { transform: `translateY(${indicatorHeight}px)`, transition: isRefreshing ? "transform 0.2s ease-out" : undefined }
              : undefined
          }
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
