import { supabase } from "./supabase";
import { logger } from "./logger";

// Lazy singleton — firebase-admin's initializeApp() throws if called
// more than once per process, and this file gets imported by multiple
// route modules. Deliberately NOT initialized at module load time:
// importing this file must never crash the whole server just because
// the credential isn't configured yet — every function below fails
// open exactly like checkImageSafety in content-moderation.ts does when
// its own API key is missing.
//
// The credential itself lives in the app_secrets table, NOT an
// environment variable — see app_secrets_migration.sql for why: Netlify
// functions in Lambda-compatibility mode enforce AWS Lambda's hard 4KB
// TOTAL environment variable limit, and this credential plus the
// pre-existing GOOGLE_PLAY_SERVICE_ACCOUNT_JSON env var together exceed
// it even after trimming both to their minimum required fields. Reading
// it from this app's own Supabase connection instead sidesteps that
// platform limit entirely — it's not an environment variable, so it was
// never subject to it.
let messaging: import("firebase-admin/messaging").Messaging | null = null;
let initAttempted = false;

async function getMessaging(): Promise<import("firebase-admin/messaging").Messaging | null> {
  if (initAttempted) return messaging;
  initAttempted = true;

  const { data, error } = await supabase.from("app_secrets").select("value").eq("key", "firebase_service_account_json").maybeSingle();
  if (error || !data?.value) {
    logger.warn("firebase_service_account_json is not set in app_secrets — push notifications are disabled");
    return null;
  }

  try {
    const serviceAccount = JSON.parse(data.value);

    // Deferred require rather than a top-level import — keeps
    // firebase-admin's own startup cost (and any of its own env/network
    // probing) out of the path of every server boot, even one that
    // never ends up sending a single push.
    const { initializeApp, cert, getApps } = require("firebase-admin/app");
    const { getMessaging: getMessagingSdk } = require("firebase-admin/messaging");

    const app = getApps().length > 0 ? getApps()[0] : initializeApp({ credential: cert(serviceAccount) });
    messaging = getMessagingSdk(app);
    return messaging;
  } catch (err) {
    logger.error({ err }, "Failed to initialize firebase-admin — push notifications are disabled");
    return null;
  }
}

/** Removes tokens FCM has told us are permanently dead — the device
 *  uninstalled the app, the token expired, or the app data was cleared.
 *  Without this, a long-departed device's token sits in push_tokens
 *  forever, and every future send to that user wastes a call retrying
 *  a token that will never work again. */
async function pruneDeadTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  try {
    await supabase.from("push_tokens").delete().in("token", tokens);
  } catch (err) {
    logger.error({ err }, "Failed to prune dead push tokens");
  }
}

/** Sends a push notification to every device registered for this user.
 *  Best-effort and fully non-blocking in spirit — every caller in
 *  notifications-helper.ts fires this without awaiting its result, the
 *  same "non-fatal, log and move on" pattern already used for
 *  createNotificationForUsers. A user with zero registered devices (push
 *  permission never granted, or web-only usage) is the common case, not
 *  an error — it's a silent no-op.
 *
 *  `data` values are stringified — FCM's data payload only accepts
 *  string values, unlike this app's own `notifications` table which
 *  stores `data` as JSONB. Keep this small: it's delivered inside the
 *  push payload itself, not fetched separately by the device. */
export async function sendPushToUser(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  const fcm = await getMessaging();
  if (!fcm) return;

  const { data: rows } = await supabase.from("push_tokens").select("token").eq("user_id", userId);
  const tokens = (rows ?? []).map((r) => r.token);
  if (tokens.length === 0) return;

  const stringData: Record<string, string> = {};
  for (const [key, value] of Object.entries(data ?? {})) {
    stringData[key] = typeof value === "string" ? value : JSON.stringify(value);
  }

  try {
    const response = await fcm.sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: stringData,
      android: {
        // High priority so time-sensitive ones (video call invite) wake
        // the device promptly rather than being coalesced by Doze/App
        // Standby — matches the tone of a service message the user
        // explicitly needs to see in a timely way.
        priority: "high",
      },
    });

    const deadTokens: string[] = [];
    response.responses.forEach((result, i) => {
      if (result.success) return;
      const code = result.error?.code;
      // messaging/registration-token-not-registered = uninstalled or
      // token otherwise permanently invalid. messaging/invalid-argument
      // here almost always means a malformed/stale token too. Anything
      // else (rate limits, transient network errors) is left alone —
      // those tokens are still potentially good and shouldn't be purged
      // over a temporary hiccup.
      if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-argument") {
        deadTokens.push(tokens[i]);
      }
    });
    await pruneDeadTokens(deadTokens);
  } catch (err) {
    logger.error({ userId, err }, "sendPushToUser failed — continuing without push");
  }
}