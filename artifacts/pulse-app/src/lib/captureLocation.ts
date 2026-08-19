import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { debugLog, timeIt } from "@/lib/debugLog";

async function sendLocation(token: string | null, latitude: number, longitude: number) {
  try {
    await timeIt("captureLocation: PUT /api/profile/me (save lat/lng)", () =>
      fetch("/api/profile/me", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ latitude, longitude }),
      }),
    );
  } catch {
    // Non-fatal — distance_km just stays null until this succeeds on a
    // future visit to Discover or Search.
  }
}

// Best-effort, silent location capture so distance_km can be computed on
// profile cards app-wide. Native and web genuinely need different code
// paths here: navigator.geolocation works fine in a real browser, but
// Capacitor's native Android WebView doesn't reliably turn it into an OS
// permission prompt at all — by default the call just fails silently,
// which is exactly why accounts created/onboarded on native never got a
// latitude/longitude on file. @capacitor/geolocation requests the actual
// runtime permission and reads the position via platform APIs instead.
//
// `source` is purely diagnostic — labels each call in the on-screen
// debug log so it's clear which page (Discover, Search) triggered it.
// Safe to remove once the native slowness investigation is done.
export function captureUserLocation(token: string | null, source = "unknown") {
  if (!token) return;

  if (Capacitor.isNativePlatform()) {
    (async () => {
      const overallStart = performance.now();
      debugLog(`captureLocation[${source}]: starting (native)`);
      try {
        const current = await timeIt(`captureLocation[${source}]: checkPermissions`, () =>
          Geolocation.checkPermissions(),
        );
        let status = current.location;
        if (status !== "granted") {
          const requested = await timeIt(`captureLocation[${source}]: requestPermissions`, () =>
            Geolocation.requestPermissions(),
          );
          status = requested.location;
        }
        if (status !== "granted") {
          debugLog(`captureLocation[${source}]: permission not granted (${status}), stopping`);
          return;
        }

        const position = await timeIt(`captureLocation[${source}]: getCurrentPosition`, () =>
          Geolocation.getCurrentPosition({
            timeout: 10000,
            maximumAge: 10 * 60 * 1000,
          }),
        );
        await sendLocation(token, position.coords.latitude, position.coords.longitude);
      } catch (err) {
        debugLog(`captureLocation[${source}]: threw — ${err instanceof Error ? err.message : String(err)}`, {
          level: "error",
        });
        // Permission denied, location services off, or timed out —
        // non-fatal, same as the web path below.
      } finally {
        debugLog(`captureLocation[${source}]: TOTAL`, {
          durationMs: Math.round(performance.now() - overallStart),
        });
      }
    })();
    return;
  }

  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (position) => {
      void sendLocation(token, position.coords.latitude, position.coords.longitude);
    },
    () => {
      // Permission denied, unavailable, or timed out — non-fatal.
    },
    { maximumAge: 10 * 60 * 1000, timeout: 10000 },
  );
}
