import type { Config } from "@netlify/functions";

// Same pattern as end-stale-video-calls.mts, same reasoning: kept to a
// single dependency-free fetch() call rather than importing
// @supabase/supabase-js directly here, after that file's own bundling
// investigation confirmed .mts functions in this project don't reliably
// pull in that dependency the way the main api.ts bundle does. All the
// actual logic lives in auth.ts's own /_internal/backfill-referral-codes
// route instead, inside that already-proven-working main bundle — this
// function's only job is to call it, once a day.
export default async () => {
  const baseUrl = process.env.APP_BASE_URL ?? "https://app.deeplydating.co.za";
  const secret = process.env.INTERNAL_CLEANUP_SECRET;

  if (!secret) {
    console.error("INTERNAL_CLEANUP_SECRET is not set — skipping referral code backfill run.");
    return;
  }

  try {
    const res = await fetch(`${baseUrl}/api/auth/_internal/backfill-referral-codes`, {
      method: "POST",
      headers: { "x-internal-cleanup-secret": secret },
    });
    const body = await res.json().catch(() => ({}));
    console.log("Referral code backfill run:", res.status, body);
  } catch (err) {
    console.error("Failed to call referral code backfill endpoint:", err);
  }
};

// Once a day at 03:00 UTC — a low-traffic time. Unlike the stale-call
// cleanup (needs to run every couple of minutes so billing settles
// promptly), a missing referral code is not time-sensitive: at most a
// 24-hour delay before it self-heals is an acceptable safety-net
// cadence, not a live operational issue.
export const config: Config = { schedule: "0 3 * * *" };
