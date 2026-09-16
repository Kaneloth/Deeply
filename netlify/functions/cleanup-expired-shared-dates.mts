import type { Config } from "@netlify/functions";

// Same dependency-free pattern as the other scheduled functions in this
// project — logic lives in matches.ts's own /_internal/ route, inside
// the already-proven-working main bundle.
export default async () => {
  const baseUrl = process.env.APP_BASE_URL ?? "https://app.deeplydating.co.za";
  const secret = process.env.INTERNAL_CLEANUP_SECRET;

  if (!secret) {
    console.error("INTERNAL_CLEANUP_SECRET is not set — skipping expired shared-dates cleanup.");
    return;
  }

  try {
    const res = await fetch(`${baseUrl}/api/matches/_internal/cleanup-expired-shared-dates`, {
      method: "POST",
      headers: { "x-internal-cleanup-secret": secret },
    });
    const body = await res.json().catch(() => ({}));
    console.log("Expired shared-dates cleanup run:", res.status, body);
  } catch (err) {
    console.error("Failed to call expired shared-dates cleanup endpoint:", err);
  }
};

export const config: Config = { schedule: "0 3 * * *" };
