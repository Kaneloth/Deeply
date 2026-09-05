import type { Config } from "@netlify/functions";

// Deliberately zero dependencies beyond the runtime's own built-in
// fetch — Netlify's own logs confirmed this file's .mts bundling
// doesn't pull in @supabase/supabase-js the way the main api.ts
// function's bundle does, even though both use the same relative
// cross-project import pattern. Rather than keep fighting that
// bundling behavior, all the actual logic (Supabase queries, billing)
// now lives in video-calls.ts's own /_internal/cleanup-stale-calls
// route instead, inside the already-proven-working main bundle — this
// function's only job is to call it.
export default async () => {
  const baseUrl = process.env.APP_BASE_URL ?? "https://app.deeplydating.co.za";
  const secret = process.env.INTERNAL_CLEANUP_SECRET;

  if (!secret) {
    console.error("INTERNAL_CLEANUP_SECRET is not set — skipping stale video call cleanup run.");
    return;
  }

  try {
    const res = await fetch(`${baseUrl}/api/video-calls/_internal/cleanup-stale-calls`, {
      method: "POST",
      headers: { "x-internal-cleanup-secret": secret },
    });
    const body = await res.json().catch(() => ({}));
    console.log("Stale video call cleanup run:", res.status, body);
  } catch (err) {
    console.error("Failed to call stale video call cleanup endpoint:", err);
  }
};

export const config: Config = { schedule: "*/2 * * * *" };
