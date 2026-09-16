import type { Config } from "@netlify/functions";

// Same dependency-free pattern as the other scheduled functions in this
// project (end-stale-video-calls.mts, backfill-referral-codes.mts,
// delete-stale-incomplete-accounts.mts) — the actual logic lives in
// profile.ts's own /_internal/snooze-reminder-check route, inside the
// already-proven-working main API bundle. This function's only job is
// to call it on a schedule.
export default async () => {
  const baseUrl = process.env.APP_BASE_URL ?? "https://app.deeplydating.co.za";
  const secret = process.env.INTERNAL_CLEANUP_SECRET;

  if (!secret) {
    console.error("INTERNAL_CLEANUP_SECRET is not set — skipping snooze reminder check.");
    return;
  }

  try {
    const res = await fetch(`${baseUrl}/api/profile/_internal/snooze-reminder-check`, {
      method: "POST",
      headers: { "x-internal-cleanup-secret": secret },
    });
    const body = await res.json().catch(() => ({}));
    console.log("Snooze reminder check run:", res.status, body);
  } catch (err) {
    console.error("Failed to call snooze reminder check endpoint:", err);
  }
};

// Once a day is sufficient here — unlike the 24-hour stale-account
// cleanup, there's no meaningful downside to a reminder firing a few
// hours later than the exact 30-day mark.
export const config: Config = { schedule: "0 9 * * *" };
