import { Capacitor } from "@capacitor/core";
import { PushNotifications, type Token, type PushNotificationSchema, type ActionPerformed } from "@capacitor/push-notifications";

// Same key AuthContext.tsx uses for the JWT — duplicated here rather
// than imported, since AuthContext.tsx keeps its token keys module-
// private (not exported) and this file needs to read the CURRENT token
// at the moment an async registration callback fires, which can be well
// after whatever token this module was last called with.
const ACCESS_TOKEN_KEY = "deeply_access_token";

// Caches the device's own FCM registration token so: (1) logout() can
// unregister it synchronously without waiting on a fresh native
// `register()` round-trip, and (2) re-running initPushNotifications()
// later in the same install (e.g. after a token refresh) can resend a
// token we already have instead of waiting on a new "registration"
// event, which the plugin does NOT reliably re-fire just because
// register() was called again with an unchanged token.
const FCM_TOKEN_KEY = "deeply_fcm_token";

let listenersRegistered = false;

function getCachedFcmToken(): string | null {
  try {
    return localStorage.getItem(FCM_TOKEN_KEY);
  } catch {
    return null;
  }
}

// Deliberately NOT using wouter's useLocation/navigate — this fires from
// a Capacitor plugin listener registered once at app startup, well
// outside any component's render tree, so there's no hook to call. This
// is the standard trick for driving wouter's default (History-API-based)
// location from outside React: push the new URL, then fire the same
// "popstate" event wouter's browser location hook already listens for,
// so it picks up the change exactly as if the user had used browser
// back/forward.
function navigateTo(path: string): void {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

async function sendTokenToBackend(authToken: string, fcmToken: string): Promise<void> {
  try {
    await fetch("/api/push/register-token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ token: fcmToken, platform: Capacitor.getPlatform() }),
    });
  } catch {
    // Best-effort — a failed registration just means this device won't
    // receive push until the next successful call (next app open, next
    // login). Never worth interrupting anything else over.
  }
}

/** Navigates to the right screen for a tapped notification's payload —
 *  every push this app sends carries a `data` object built by
 *  notifications-helper.ts / the trigger sites in discover.ts,
 *  messages.ts, video-calls.ts and matches.ts. Falls back to the
 *  Notifications page for anything without a recognized shape (e.g.
 *  verification_requested/completed/declined, which aren't chat-scoped). */
function handleNotificationTap(notification: PushNotificationSchema): void {
  const data = (notification.data ?? {}) as Record<string, string>;
  if (data.match_id) {
    navigateTo(`/matches/${data.match_id}/chat`);
    return;
  }
  navigateTo("/notifications");
}

/** Requests notification permission (prompting the Android 13+
 *  POST_NOTIFICATIONS runtime permission where applicable), registers
 *  this device with FCM, and sends the resulting token to the backend.
 *  Safe to call every time the app becomes authenticated (login, app
 *  resume with an existing session) — it's a no-op past the first call
 *  in terms of listener setup, and re-registering an unchanged token
 *  with the backend is a harmless upsert either way.
 *
 *  No-op on web — @capacitor/push-notifications' web implementation
 *  needs its own separate VAPID/web-push setup this app doesn't have,
 *  and web sessions realistically stay open in a browser tab rather
 *  than needing to be woken up by a push in the first place. */
export async function initPushNotifications(authToken: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  if (!listenersRegistered) {
    listenersRegistered = true;

    PushNotifications.addListener("registration", (token: Token) => {
      try {
        localStorage.setItem(FCM_TOKEN_KEY, token.value);
      } catch {
        // Ignore — worst case we just re-send on next initPushNotifications call.
      }
      // Read the CURRENT auth token rather than closing over the one
      // this whole function was called with — registration is
      // asynchronous and can resolve after a token refresh has already
      // rotated the access token this call started with.
      const currentAuthToken = (() => {
        try {
          return localStorage.getItem(ACCESS_TOKEN_KEY);
        } catch {
          return null;
        }
      })();
      if (currentAuthToken) void sendTokenToBackend(currentAuthToken, token.value);
    });

    PushNotifications.addListener("registrationError", (err) => {
      console.error("Push notification registration failed:", err);
    });

    // Tapped while the app was backgrounded/closed. A tap while the app
    // is in the FOREGROUND is deliberately NOT shown as a system
    // notification at all by this app (no `pushNotificationReceived`
    // listener) — for a chat app, a push about a chat you already have
    // open would just be a redundant, slightly odd-feeling banner over
    // content you're already looking at.
    PushNotifications.addListener("pushNotificationActionPerformed", (action: ActionPerformed) => {
      handleNotificationTap(action.notification);
    });
  }

  const currentStatus = await PushNotifications.checkPermissions();
  let granted = currentStatus.receive === "granted";
  if (!granted && currentStatus.receive !== "denied") {
    const requested = await PushNotifications.requestPermissions();
    granted = requested.receive === "granted";
  }
  if (!granted) return;

  await PushNotifications.register();

  // Covers the case where this runs again later in the same install
  // (e.g. logging out and into a different account on the same device)
  // without the plugin re-firing "registration" for an unchanged token
  // — re-send what we already have so the backend re-homes it to
  // whichever account is now calling this.
  const cached = getCachedFcmToken();
  if (cached) void sendTokenToBackend(authToken, cached);
}

/** Called from AuthContext.tsx's logout() BEFORE the JWT is cleared —
 *  this needs a still-valid bearer token to authenticate the call, and
 *  it needs to run synchronously with logout so a shared/reissued
 *  device doesn't keep receiving this account's pushes after signing
 *  out. Best-effort: if this fails, the row is simply re-homed to
 *  whoever registers next on this device, which is a stale-but-bounded
 *  outcome, not a security hole (that device would need this account's
 *  own JWT to have read anything sensitive anyway). */
export async function unregisterPushToken(authToken: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const cached = getCachedFcmToken();
  if (!cached) return;
  try {
    await fetch("/api/push/unregister-token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ token: cached }),
    });
  } catch {
    // Best-effort — see doc comment above.
  }
}
