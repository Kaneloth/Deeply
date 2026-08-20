import { useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";

/** Re-runs `refetch` whenever the app comes back to the foreground
 *  (native) or the tab/page becomes visible again (web) — not just on
 *  the page's initial mount.
 *
 *  This matters specifically because of how the stale-while-revalidate
 *  caching used across this app works: a page shows its cached content
 *  instantly, then fires one background refresh to replace it with
 *  fresh data. If that ONE background refresh happens to fail — a
 *  transient network blip, which is more likely right at app-open when
 *  several requests fire at once — there was previously no retry. The
 *  user would be stuck looking at stale content (e.g. missing new
 *  invites) with no indication anything went wrong, until they
 *  manually forced a reload. This gives every "app resumed" moment a
 *  fresh chance to catch up automatically.
 *
 *  `refetch` is read from a ref internally so callers can pass a fresh
 *  inline function on every render without needing to memoize it —
 *  that won't cause this effect to tear down and re-subscribe. */
export function useRefetchOnAppResume(refetch: () => void) {
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      const listenerPromise = CapacitorApp.addListener("resume", () => {
        refetchRef.current();
      });
      return () => {
        listenerPromise.then((handle) => handle.remove());
      };
    }

    // Web fallback — same intent (the app/tab becoming active again),
    // via the standard visibility API instead of a native app-lifecycle
    // event.
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refetchRef.current();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);
}
