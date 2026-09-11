import type { Config } from "@netlify/functions";

// Same dependency-free pattern as end-stale-video-calls.mts and
// backfill-referral-codes.mts, same reasoning: .mts functions in this
// project don't reliably bundle @supabase/supabase-js the way the main
// api.ts bundle does. All the actual logic lives in auth.ts's own
// /_internal/delete-stale-incomplete-accounts route instead, inside
// that already-proven-working main bundle — this function's only job
// is to call it on a schedule.
export default async () => {
  const baseUrl = process.env.APP_BASE_URL ?? "https://app.deeplydating.co.za";
  const secret = process.env.INTERNAL_CLEANUP_SECRET;

  if (!secret) {
    console.error("INTERNAL_CLEANUP_SECRET is not set — skipping stale incomplete account cleanup run.");
    return;
  }

  try {
    const res = await fetch(`${baseUrl}/api/auth/_internal/delete-stale-incomplete-accounts`, {
      method: "POST",
      headers: { "x-internal-cleanup-secret": secret },
    });
    const body = await res.json().catch(() => ({}));
    console.log("Stale incomplete account cleanup run:", res.status, body);
  } catch (err) {
    console.error("Failed to call stale incomplete account cleanup endpoint:", err);
  }
};

// Every 4 hours, not once a day — an account crossing the 24-hour
// threshold right after a daily run would otherwise sit for up to
// another full day before being caught, working against the actual
// goal of keeping accumulated volume down.
export const config: Config = { schedule: "0 */4 * * *" };
