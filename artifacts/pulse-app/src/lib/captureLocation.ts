import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";

async function sendLocation(token: string | null, latitude: number, longitude: number) {
  try {
    await fetch("/api/profile/me", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ latitude, longitude }),
    });
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
export function captureUserLocation(token: string | null) {
  if (!token) return;

  if (Capacitor.isNativePlatform()) {
    (async () => {
      try {
        const current = await Geolocation.checkPermissions();
        let status = current.location;
        if (status !== "granted") {
          const requested = await Geolocation.requestPermissions();
          status = requested.location;
        }
        if (status !== "granted") return;

        const position = await Geolocation.getCurrentPosition({
          timeout: 10000,
          maximumAge: 10 * 60 * 1000,
        });
        await sendLocation(token, position.coords.latitude, position.coords.longitude);
      } catch {
        // Permission denied, location services off, or timed out —
        // non-fatal, same as the web path below.
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
