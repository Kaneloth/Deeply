import { Router, type IRouter } from "express";
import { RtcTokenBuilder, RtcRole } from "agora-token";
import { requireAuth } from "../middlewares/auth";
import { supabase } from "../lib/supabase";
import { spendSparks } from "../lib/sparks-helper";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const AGORA_APP_ID = process.env.AGORA_APP_ID ?? "";
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE ?? "";

const FREE_CALL_SECONDS = 5 * 60; // 5 minutes
const SPARKS_PER_30_SECONDS = 1; // unified paid rate: 1 Spark per 30s = 10 Sparks per 5 min
const VIDEO_CALL_MONTHLY_ALLOWANCE = 2;
const TOKEN_EXPIRY_SECONDS = 60 * 60; // 1 hour — comfortably longer than any call should last

// ============================================================
// Gender-based request permission. Only "man" is excluded — everyone
// else (woman, non-binary, prefer not to say, or unexpectedly
// null/unset) can request. Confirmed directly against real data that
// the stored value is lowercase "man"/"woman", not the Title Case
// shown in the onboarding UI — this check is deliberately built
// against that confirmed real value, not the display label.
function canRequestCall(gender: string | null | undefined): boolean {
  return gender !== "man";
}

// Deterministic UUID -> 32-bit unsigned int, since Agora's most
// universally stable API surface (buildTokenWithUid, and every client
// SDK's own join() call) expects a numeric uid, not an arbitrary
// string account. Same input always produces the same output, so a
// given user always gets the same Agora uid across every call.
function uidFromUserId(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0; // >>> 0 keeps it a 32-bit unsigned int
  }
  return hash === 0 ? 1 : hash; // Agora uids must be >= 1
}

function generateAgoraToken(channelName: string, uid: number): string {
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const privilegeExpiredTs = currentTimestamp + TOKEN_EXPIRY_SECONDS;
  return RtcTokenBuilder.buildTokenWithUid(
    AGORA_APP_ID,
    AGORA_APP_CERTIFICATE,
    channelName,
    uid,
    RtcRole.PUBLISHER,
    privilegeExpiredTs,
  );
}

/** Mirrors sparks-helper.ts's checkAndApplyMonthlyGrant, but for the
 *  free video call allowance — a count of calls, not a currency
 *  amount, so it's tracked as its own pair of columns rather than
 *  folded into the Sparks balance. */
async function checkAndApplyVideoCallGrant(userId: string): Promise<number> {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("free_video_calls_remaining, next_video_call_grant_at")
    .eq("id", userId)
    .single();

  if (error || !profile) {
    logger.error({ userId, error }, "Failed to fetch profile for video call grant check");
    return 0;
  }

  const grantDue = new Date(profile.next_video_call_grant_at).getTime() <= Date.now();
  if (!grantDue) {
    return profile.free_video_calls_remaining;
  }

  const nextGrantAt = new Date();
  nextGrantAt.setMonth(nextGrantAt.getMonth() + 1);

  const { data: updated } = await supabase
    .from("profiles")
    .update({
      free_video_calls_remaining: VIDEO_CALL_MONTHLY_ALLOWANCE,
      next_video_call_grant_at: nextGrantAt.toISOString(),
    })
    .eq("id", userId)
    .select("free_video_calls_remaining")
    .single();

  return updated?.free_video_calls_remaining ?? VIDEO_CALL_MONTHLY_ALLOWANCE;
}

/** Fetches a match and confirms the requesting user is actually part
 *  of it, returning both participant ids so callers don't each
 *  duplicate this same lookup+check. */
async function getMatchParticipants(
  matchId: string,
  userId: string,
): Promise<{ user1_id: string; user2_id: string; video_calls_enabled: boolean } | null> {
  const { data: match } = await supabase
    .from("matches")
    .select("user1_id, user2_id, video_calls_enabled")
    .eq("id", matchId)
    .single();

  if (!match || (match.user1_id !== userId && match.user2_id !== userId)) {
    return null;
  }
  return match;
}

function otherParticipant(match: { user1_id: string; user2_id: string }, userId: string): string {
  return match.user1_id === userId ? match.user2_id : match.user1_id;
}

/** POST /api/video-calls/request — the one-time, first-ever ask for a
 *  given match. Only reachable before video_calls_enabled; once
 *  enabled, the eligible party uses POST /video-calls/call instead. */
router.post("/video-calls/request", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { matchId } = req.body as { matchId?: string };

  if (!matchId) {
    res.status(400).json({ error: "matchId is required" });
    return;
  }

  const { data: profile } = await supabase.from("profiles").select("gender").eq("id", userId).single();
  if (!canRequestCall(profile?.gender)) {
    res.status(403).json({ error: "Only women can request a video call." });
    return;
  }

  const match = await getMatchParticipants(matchId, userId);
  if (!match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }
  if (match.video_calls_enabled) {
    res.status(400).json({ error: "Video calls are already enabled for this match — start a call directly instead." });
    return;
  }

  const { data: existing } = await supabase
    .from("video_calls")
    .select("id")
    .eq("match_id", matchId)
    .in("status", ["pending_request", "ringing", "active"])
    .maybeSingle();
  if (existing) {
    res.status(409).json({ error: "There's already a pending or active call for this match." });
    return;
  }

  const acceptorId = otherParticipant(match, userId);
  const { data: created, error } = await supabase
    .from("video_calls")
    .insert({ match_id: matchId, requester_id: userId, acceptor_id: acceptorId, status: "pending_request" })
    .select("id")
    .single();

  if (error || !created) {
    res.status(500).json({ error: "Failed to create video call request" });
    return;
  }

  res.status(201).json({ id: created.id });
});

/** GET /api/video-calls/status?matchId=X — polled by ChatPage.tsx in
 *  place of a push notification. Returns whatever's currently
 *  happening for this match (a pending request, a ringing call, or an
 *  active one) visible to either party, plus this user's own free
 *  call balance so the UI can show "this call would be free" upfront. */
router.get("/video-calls/status", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { matchId } = req.query as { matchId?: string };

  if (!matchId) {
    res.status(400).json({ error: "matchId is required" });
    return;
  }

  const match = await getMatchParticipants(matchId, userId);
  if (!match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }

  // RPC instead of .select() — confirmed via direct DB inspection that
  // a genuinely still-pending row can intermittently, persistently fail
  // to show up via PostgREST's normal query path here, exactly the same
  // symptom matches.ts hit before. See rpc_get_pending_video_call.sql.
  const { data: call } = await supabase.rpc("get_pending_video_call", {
    p_match_id: matchId,
    p_user_id: userId,
  });

  const freeCallsRemaining = await checkAndApplyVideoCallGrant(userId);

  res.json({
    video_calls_enabled: match.video_calls_enabled,
    call: call ?? null,
    free_video_calls_remaining: freeCallsRemaining,
  });
});

/** POST /api/video-calls/:id/accept — accepting the one-time request.
 *  Permanently enables the match for direct future calls, and this
 *  same call attempt goes active immediately — accepting IS joining. */
router.post("/video-calls/:id/accept", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { id } = req.params;

  const { data: call } = await supabase.from("video_calls").select("*").eq("id", id).single();
  if (!call || call.acceptor_id !== userId || call.status !== "pending_request") {
    res.status(404).json({ error: "Request not found or already handled" });
    return;
  }

  const freeCallsRemaining = await checkAndApplyVideoCallGrant(userId);
  const useFreeCall = freeCallsRemaining > 0;

  if (useFreeCall) {
    await supabase
      .from("profiles")
      .update({ free_video_calls_remaining: freeCallsRemaining - 1 })
      .eq("id", userId);
  }

  const channelName = `vcall_${call.id}`;
  await supabase
    .from("matches")
    .update({ video_calls_enabled: true })
    .eq("id", call.match_id);

  await supabase
    .from("video_calls")
    .update({ status: "active", accepted_at: new Date().toISOString(), channel_name: channelName, used_free_call: useFreeCall })
    .eq("id", id);

  const token = generateAgoraToken(channelName, uidFromUserId(userId));
  res.json({ channel_name: channelName, agora_app_id: AGORA_APP_ID, token, uid: uidFromUserId(userId), used_free_call: useFreeCall });
});

/** POST /api/video-calls/:id/decline — branches by current status:
 *  refusing the one-time initial request (does NOT enable the match —
 *  the requester would need to send a fresh request later), or
 *  declining a direct call once already enabled (which needs no new
 *  request, ever, per the match already being permanently enabled). */
router.post("/video-calls/:id/decline", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { id } = req.params;

  const { data: call } = await supabase.from("video_calls").select("*").eq("id", id).single();
  if (!call || call.acceptor_id !== userId) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  if (call.status !== "pending_request" && call.status !== "ringing") {
    res.status(400).json({ error: "This call can no longer be declined" });
    return;
  }

  const nextStatus = call.status === "pending_request" ? "declined_request" : "declined_call";
  await supabase.from("video_calls").update({ status: nextStatus, ended_at: new Date().toISOString() }).eq("id", id);
  res.sendStatus(204);
});

/** POST /api/video-calls/call — direct call, only usable once
 *  video_calls_enabled is already true for this match. Skips the
 *  request/accept handshake entirely; the caller joins the channel
 *  immediately (ringing) while the other side is alerted via their own
 *  polling of GET /video-calls/status. */
router.post("/video-calls/call", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { matchId } = req.body as { matchId?: string };

  if (!matchId) {
    res.status(400).json({ error: "matchId is required" });
    return;
  }

  const { data: profile } = await supabase.from("profiles").select("gender").eq("id", userId).single();
  if (!canRequestCall(profile?.gender)) {
    res.status(403).json({ error: "Only women can start a video call." });
    return;
  }

  const match = await getMatchParticipants(matchId, userId);
  if (!match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }
  if (!match.video_calls_enabled) {
    res.status(400).json({ error: "Video calls aren't enabled yet for this match — send a request first." });
    return;
  }

  const { data: existing } = await supabase
    .from("video_calls")
    .select("id")
    .eq("match_id", matchId)
    .in("status", ["pending_request", "ringing", "active"])
    .maybeSingle();
  if (existing) {
    res.status(409).json({ error: "There's already a pending or active call for this match." });
    return;
  }

  const acceptorId = otherParticipant(match, userId);
  const { data: created, error } = await supabase
    .from("video_calls")
    .insert({ match_id: matchId, requester_id: userId, acceptor_id: acceptorId, status: "ringing" })
    .select("id")
    .single();

  if (error || !created) {
    res.status(500).json({ error: "Failed to start video call" });
    return;
  }

  const channelName = `vcall_${created.id}`;
  await supabase.from("video_calls").update({ channel_name: channelName }).eq("id", created.id);

  const token = generateAgoraToken(channelName, uidFromUserId(userId));
  res.status(201).json({ id: created.id, channel_name: channelName, agora_app_id: AGORA_APP_ID, token, uid: uidFromUserId(userId) });
});

/** POST /api/video-calls/:id/answer — answering a ringing direct call
 *  (post-enablement only; the one-time request uses /accept instead,
 *  since that one folds "consent to be called at all" and "answering
 *  this specific call" into a single action). */
router.post("/video-calls/:id/answer", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { id } = req.params;

  const { data: call } = await supabase.from("video_calls").select("*").eq("id", id).single();
  if (!call || call.acceptor_id !== userId || call.status !== "ringing") {
    res.status(404).json({ error: "Call not found or no longer ringing" });
    return;
  }

  const freeCallsRemaining = await checkAndApplyVideoCallGrant(userId);
  const useFreeCall = freeCallsRemaining > 0;

  if (useFreeCall) {
    await supabase
      .from("profiles")
      .update({ free_video_calls_remaining: freeCallsRemaining - 1 })
      .eq("id", userId);
  }

  await supabase
    .from("video_calls")
    .update({ status: "active", accepted_at: new Date().toISOString(), used_free_call: useFreeCall })
    .eq("id", id);

  const token = generateAgoraToken(call.channel_name, uidFromUserId(userId));
  res.json({ channel_name: call.channel_name, agora_app_id: AGORA_APP_ID, token, uid: uidFromUserId(userId), used_free_call: useFreeCall });
});

/** POST /api/video-calls/:id/missed — called by the CALLER when a
 *  ringing call goes unanswered past a client-side timeout. Doesn't
 *  need the acceptor to do anything, since by definition they never
 *  responded — matches never lose their enabled status over this. */
router.post("/video-calls/:id/missed", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { id } = req.params;

  const { data: call } = await supabase.from("video_calls").select("*").eq("id", id).single();
  if (!call || call.requester_id !== userId || call.status !== "ringing") {
    res.status(404).json({ error: "Call not found or no longer ringing" });
    return;
  }

  await supabase.from("video_calls").update({ status: "missed", ended_at: new Date().toISOString() }).eq("id", id);
  res.sendStatus(204);
});

/** POST /api/video-calls/:id/end — ends an active call and settles
 *  billing. Elapsed time is computed server-side from accepted_at
 *  against the server's own clock at this exact moment — never
 *  anything the client reports about duration, which is what actually
 *  makes this tamper-proof despite there being no continuous metering
 *  during the call itself. The client is expected to auto-end well
 *  before this by tracking its own affordable-time budget (see
 *  GET /api/sparks for the balance it budgets against), so hitting the
 *  insufficient-balance fallback below should be rare in practice —
 *  it exists as a backstop, not the primary enforcement mechanism. */
router.post("/video-calls/:id/end", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { id } = req.params;

  const { data: call } = await supabase.from("video_calls").select("*").eq("id", id).single();
  if (!call || (call.requester_id !== userId && call.acceptor_id !== userId) || call.status !== "active") {
    res.status(404).json({ error: "Call not found or not active" });
    return;
  }

  const endedAt = new Date();
  const acceptedAt = new Date(call.accepted_at);
  const elapsedSeconds = Math.max(0, Math.floor((endedAt.getTime() - acceptedAt.getTime()) / 1000));

  const freeSeconds = call.used_free_call ? FREE_CALL_SECONDS : 0;
  const billableSeconds = Math.max(0, elapsedSeconds - freeSeconds);
  const sparksOwed = Math.ceil(billableSeconds / 30) * SPARKS_PER_30_SECONDS;

  let sparksCharged = 0;
  if (sparksOwed > 0) {
    // The acceptor always pays, per the actual product rule — always a
    // man in a hetero match (since only non-men can ever be the
    // requester), or whichever woman accepted in a same-sex match.
    const result = await spendSparks(call.acceptor_id, sparksOwed, `Video call charge (${Math.ceil(billableSeconds / 60)} min beyond free allowance)`);
    if (result.success) {
      sparksCharged = sparksOwed;
    } else {
      // Backstop only — the client's own budget-tracking should have
      // ended the call before this could ever happen. Charging
      // whatever's actually available rather than failing the entire
      // end-call operation outright: the call already happened and
      // can't be un-happened, so recording it as ended with a partial
      // charge is more honest than blocking on a payment that can't
      // fully go through anyway.
      const partial = await spendSparks(call.acceptor_id, result.balance, "Video call charge (partial — insufficient balance)");
      if (partial.success) sparksCharged = result.balance;
      logger.error({ callId: id, sparksOwed, actuallyCharged: sparksCharged }, "Video call ended with insufficient Sparks to cover full duration");
    }
  }

  await supabase
    .from("video_calls")
    .update({ status: "ended", ended_at: endedAt.toISOString(), sparks_charged: sparksCharged })
    .eq("id", id);

  res.json({ elapsed_seconds: elapsedSeconds, sparks_charged: sparksCharged });
});

export default router;