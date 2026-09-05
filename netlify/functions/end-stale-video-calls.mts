import type { Config } from "@netlify/functions";
import { supabase } from "../../artifacts/api-server/src/lib/supabase";
import { settleVideoCallBilling } from "../../artifacts/api-server/src/routes/video-calls";
import { logger } from "../../artifacts/api-server/src/lib/logger";

// Must be meaningfully longer than VideoCallScreen.tsx's own 20s
// heartbeat interval to avoid false positives from an ordinary,
// momentary network hiccup — 90s gives roughly 4 missed heartbeats'
// worth of margin before treating a call as genuinely dead.
const STALE_THRESHOLD_SECONDS = 90;

/** Runs every 2 minutes. Finds any video_calls row still marked
 *  "active" whose heartbeat has gone stale — the actual fix for the
 *  incident that motivated this: a call where one participant's app
 *  was force-closed (or lost connectivity, or genuinely anything else
 *  that prevents VideoCallScreen.tsx from either sending its regular
 *  heartbeat or cleanly unmounting) ran, and billed, for 37+ minutes
 *  with no way for either side to actually stop it. Relying purely on
 *  a client-initiated "end" signal is fundamentally unreliable for
 *  something billing-critical — this is the server-side backstop that
 *  makes it not matter whether that signal ever arrives. */
export default async (req: Request) => {
  const { next_run } = await req.json();

  const staleCutoff = new Date(Date.now() - STALE_THRESHOLD_SECONDS * 1000).toISOString();

  // Two separate conditions, not one combined filter — PostgREST's
  // .or() with hand-built strings has already been a source of bugs
  // elsewhere in this project (see profile.ts's isUuidLike fix and
  // sparks-helper.ts's getAbuseDelayUntil comment), so two simple
  // queries are used here instead, same reasoning.
  const { data: staleWithHeartbeat } = await supabase
    .from("video_calls")
    .select("id, match_id, accepted_at, used_free_call, acceptor_id, last_heartbeat_at")
    .eq("status", "active")
    .not("last_heartbeat_at", "is", null)
    .lt("last_heartbeat_at", staleCutoff);

  // Covers the call that went active but never received even its
  // first heartbeat at all (e.g. immediate connection failure right
  // after accept/answer, before VideoCallScreen.tsx's own heartbeat
  // effect ever got a chance to fire) — accepted_at is the only
  // "last known alive" timestamp available in that case.
  const { data: staleNeverHeartbeat } = await supabase
    .from("video_calls")
    .select("id, match_id, accepted_at, used_free_call, acceptor_id, last_heartbeat_at")
    .eq("status", "active")
    .is("last_heartbeat_at", null)
    .lt("accepted_at", staleCutoff);

  const staleCalls = [...(staleWithHeartbeat ?? []), ...(staleNeverHeartbeat ?? [])];

  for (const call of staleCalls) {
    try {
      // Bills up through the last point the call was actually known to
      // be alive, not "now" (when this cleanup happens to run) — fairer
      // to the payer, since the real call very likely ended around the
      // last heartbeat, not whenever this job next executed.
      const lastKnownAliveAt = new Date(call.last_heartbeat_at ?? call.accepted_at);
      await settleVideoCallBilling(call, lastKnownAliveAt);
      logger.info({ callId: call.id }, "Ended stale video call via scheduled cleanup");
    } catch (err) {
      logger.error({ callId: call.id, err }, "Failed to end stale video call");
    }
  }

  logger.info({ staleCallCount: staleCalls.length, next_run }, "Stale video call cleanup run complete");
};

export const config: Config = { schedule: "*/2 * * * *" };
