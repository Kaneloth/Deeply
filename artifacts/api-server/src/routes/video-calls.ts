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
): Promise<{ user1_id: string; user2_id: string; video_calls_enabled: boolean; video_call_payer_id: string | null } | null> {
  const { data: match } = await supabase
    .from("matches")
    .select("user1_id, user2_id, video_calls_enabled, video_call_payer_id")
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

// A ring genuinely stuck stale past this point (RPC/network failure
// preventing the requester's own 45s missed-timeout from ever
// registering, exactly what happened in the incident that motivated
// this) is treated as no longer blocking — this is a safety net, not
// the primary mechanism (the 45s client-side timeout + /missed
// endpoint is), so it's set generously longer than any real ring
// should ever last.
const STALE_RINGING_MINUTES = 5;

/** Checks whether a NEW request/call for this match should be blocked
 *  by something already pending/ringing/active. Deliberately ignores
 *  a stale ringing row past STALE_RINGING_MINUTES rather than letting
 *  it block new calls forever — see the incident this was added for:
 *  a failed /decline (itself caused by the same read-consistency
 *  issue this file's RPC calls now guard against) left a call
 *  permanently stuck as "ringing," and every subsequent call attempt
 *  correctly-but-uselessly kept getting blocked by it with no way out
 *  short of a manual database fix. pending_request and active are NOT
 *  given this same staleness exemption — a genuinely still-open
 *  request can sit unanswered for a long time completely normally
 *  (someone might not open the chat for hours), and an active call
 *  lasting a while is also entirely normal, so only "ringing"
 *  specifically — which by design should always resolve within
 *  seconds — gets this treatment. */
async function hasBlockingCall(matchId: string): Promise<boolean> {
  // This specific read is NOT RPC-bypassed like the action routes
  // above — deliberately. If this particular check has a rare,
  // momentary miss, the worst outcome is a second call row briefly
  // existing alongside the first, which resolves on its own (both
  // independently reach a terminal state) — a minor, self-healing
  // issue, unlike the permanently-stuck state a missed read caused in
  // the actual incident this file was fixed for. Not worth a third RPC
  // function for this specific lower-stakes case.
  const { data: candidates } = await supabase
    .from("video_calls")
    .select("id, status, requested_at")
    .eq("match_id", matchId)
    .in("status", ["pending_request", "ringing", "active"]);

  if (!candidates || candidates.length === 0) return false;

  const staleCutoff = Date.now() - STALE_RINGING_MINUTES * 60 * 1000;
  return candidates.some((c) => {
    if (c.status !== "ringing") return true; // pending_request/active always block
    return new Date(c.requested_at).getTime() > staleCutoff; // ringing only blocks if recent
  });
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

  if (await hasBlockingCall(matchId)) {
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
    logger.error({ matchId, userId, error }, "Failed to create video call request");
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
    // Whoever's video_call_payer_id matches the requesting user is the
    // one actually charged for this match's calls, regardless of who
    // initiates any individual one — the frontend uses this to only
    // show cost-related messaging to the person it's actually true for.
    is_payer: match.video_call_payer_id === userId,
  });
});

/** POST /api/video-calls/:id/accept — accepting the one-time request.
 *  Permanently enables the match for direct future calls, and this
 *  same call attempt goes active immediately — accepting IS joining. */
router.post("/video-calls/:id/accept", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { id } = req.params;

  const { data: call } = await supabase.rpc("get_video_call_by_id", { p_call_id: id });
  // See rpc_video_calls.sql — bypasses the same confirmed PostgREST
  // read-consistency issue that affected /status, applied here too
  // since every one of these action routes had the identical
  // vulnerable pattern. This specific gap is what let a failed
  // decline leave a call permanently stuck as "ringing."
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
  const acceptedAt = new Date().toISOString();
  await supabase
    .from("matches")
    .update({ video_calls_enabled: true, video_call_payer_id: userId })
    .eq("id", call.match_id);

  await supabase
    .from("video_calls")
    .update({ status: "active", accepted_at: acceptedAt, channel_name: channelName, used_free_call: useFreeCall })
    .eq("id", id);

  const token = generateAgoraToken(channelName, uidFromUserId(userId));
  res.json({ channel_name: channelName, agora_app_id: AGORA_APP_ID, token, uid: uidFromUserId(userId), used_free_call: useFreeCall, accepted_at: acceptedAt });
});

/** POST /api/video-calls/:id/decline — branches by current status:
 *  refusing the one-time initial request (does NOT enable the match —
 *  the requester would need to send a fresh request later), or
 *  declining a direct call once already enabled (which needs no new
 *  request, ever, per the match already being permanently enabled). */
router.post("/video-calls/:id/decline", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { id } = req.params;

  const { data: call } = await supabase.rpc("get_video_call_by_id", { p_call_id: id });
  // See rpc_video_calls.sql — bypasses the same confirmed PostgREST
  // read-consistency issue that affected /status, applied here too
  // since every one of these action routes had the identical
  // vulnerable pattern.
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }

  // pending_request: only the acceptor can meaningfully refuse a
  // one-time permission ask — the requester withdrawing their own
  // request isn't a real product scenario here.
  //
  // ringing: EITHER party can end it — the requester cancelling their
  // own outgoing ring (previously rejected outright here, which is
  // the actual bug this fixes: the "Ringing..." banner shown to the
  // requester has its own cancel button hitting this same endpoint),
  // or the acceptor declining an incoming one.
  const isAuthorized =
    call.status === "pending_request" ? call.acceptor_id === userId : call.requester_id === userId || call.acceptor_id === userId;

  if (!isAuthorized) {
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

  // No gender check here, deliberately — that restriction only applies
  // to the one-time initial request (POST /video-calls/request above).
  // Once a match is enabled, either party can start a direct call; who
  // actually pays is decided by matches.video_call_payer_id (set once,
  // permanently, at the original accept), never by who happens to
  // initiate or answer any individual later call.
  const match = await getMatchParticipants(matchId, userId);
  if (!match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }
  if (!match.video_calls_enabled) {
    res.status(400).json({ error: "Video calls aren't enabled yet for this match — send a request first." });
    return;
  }

  if (await hasBlockingCall(matchId)) {
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
    logger.error({ matchId, userId, error }, "Failed to start direct video call");
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

  const { data: call } = await supabase.rpc("get_video_call_by_id", { p_call_id: id });
  // See rpc_video_calls.sql — bypasses the same confirmed PostgREST
  // read-consistency issue that affected /status, applied here too
  // since every one of these action routes had the identical
  // vulnerable pattern. This specific gap is what let a failed
  // decline leave a call permanently stuck as "ringing."
  if (!call || call.acceptor_id !== userId || call.status !== "ringing") {
    res.status(404).json({ error: "Call not found or no longer ringing" });
    return;
  }

  // Deliberately checks the match's permanent payer, not userId (the
  // person answering this specific call) — those are the same person
  // in the common case (woman calls, man answers), but diverge the
  // moment the payer himself initiates a call and the other party
  // answers it. The free-call allowance being consumed must always be
  // the payer's own, regardless of who technically picks up.
  const { data: matchRow } = await supabase.from("matches").select("video_call_payer_id").eq("id", call.match_id).single();
  const payerId = matchRow?.video_call_payer_id ?? userId; // fallback shouldn't happen in practice, but never leaves this unset

  const freeCallsRemaining = await checkAndApplyVideoCallGrant(payerId);
  const useFreeCall = freeCallsRemaining > 0;

  if (useFreeCall) {
    await supabase
      .from("profiles")
      .update({ free_video_calls_remaining: freeCallsRemaining - 1 })
      .eq("id", payerId);
  }

  const acceptedAt = new Date().toISOString();
  await supabase
    .from("video_calls")
    .update({ status: "active", accepted_at: acceptedAt, used_free_call: useFreeCall })
    .eq("id", id);

  const token = generateAgoraToken(call.channel_name, uidFromUserId(userId));
  res.json({ channel_name: call.channel_name, agora_app_id: AGORA_APP_ID, token, uid: uidFromUserId(userId), used_free_call: useFreeCall, accepted_at: acceptedAt });
});

/** POST /api/video-calls/:id/join — issues a fresh Agora token for an
 *  ALREADY-active call. This exists specifically for whichever party
 *  didn't directly call accept/answer/call themselves — they only
 *  learn the call is active via polling GET /video-calls/status, which
 *  deliberately never hands out a token itself (issuing one to someone
 *  before they've actually taken an action to join would be a real
 *  gap). Without this endpoint, that party would have no way to
 *  actually obtain their own token at all — accept/answer/call only
 *  ever return one to whoever called that specific endpoint, never to
 *  the other participant. */
router.post("/video-calls/:id/join", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { id } = req.params;

  const { data: call } = await supabase.rpc("get_video_call_by_id", { p_call_id: id });
  if (!call || (call.requester_id !== userId && call.acceptor_id !== userId) || call.status !== "active" || !call.channel_name) {
    res.status(404).json({ error: "Call not found or not active" });
    return;
  }

  const token = generateAgoraToken(call.channel_name, uidFromUserId(userId));
  res.json({
    channel_name: call.channel_name,
    agora_app_id: AGORA_APP_ID,
    token,
    uid: uidFromUserId(userId),
    accepted_at: call.accepted_at,
    used_free_call: call.used_free_call,
  });
});

/** POST /api/video-calls/:id/missed — called by the CALLER when a
 *  ringing call goes unanswered past a client-side timeout. Doesn't
 *  need the acceptor to do anything, since by definition they never
 *  responded — matches never lose their enabled status over this. */
router.post("/video-calls/:id/missed", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { id } = req.params;

  const { data: call } = await supabase.rpc("get_video_call_by_id", { p_call_id: id });
  // See rpc_video_calls.sql — bypasses the same confirmed PostgREST
  // read-consistency issue that affected /status, applied here too
  // since every one of these action routes had the identical
  // vulnerable pattern. This specific gap is what let a failed
  // decline leave a call permanently stuck as "ringing."
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
/** Shared billing logic — used by both POST /:id/end (the normal path,
 *  triggered by a person tapping End Call) and the scheduled stale-call
 *  cleanup function (the safety net for exactly the incident that
 *  motivated it: a call whose participant force-closed the app,
 *  losing connectivity, or otherwise never sending the explicit end
 *  signal at all). Both paths must charge identically — this is the
 *  one place that logic lives, so they can't ever drift apart. */
export async function settleVideoCallBilling(
  call: { id: string; match_id: string; accepted_at: string; used_free_call: boolean; acceptor_id: string },
  endedAt: Date,
): Promise<{ elapsedSeconds: number; sparksCharged: number }> {
  const acceptedAt = new Date(call.accepted_at);
  const elapsedSeconds = Math.max(0, Math.floor((endedAt.getTime() - acceptedAt.getTime()) / 1000));

  const freeSeconds = call.used_free_call ? FREE_CALL_SECONDS : 0;
  const billableSeconds = Math.max(0, elapsedSeconds - freeSeconds);
  const sparksOwed = Math.ceil(billableSeconds / 30) * SPARKS_PER_30_SECONDS;

  // Deliberately the match's permanently-recorded payer, not
  // call.acceptor_id — those match in the common case (woman calls,
  // man answers), but diverge once the payer himself initiates a call
  // and the other party answers it. Billing must always follow the
  // one fixed payer for this match, never whoever technically
  // answered this one specific call attempt.
  const { data: matchRowForBilling } = await supabase.from("matches").select("video_call_payer_id").eq("id", call.match_id).single();
  const payerId = matchRowForBilling?.video_call_payer_id ?? call.acceptor_id; // fallback shouldn't happen in practice

  let sparksCharged = 0;
  if (sparksOwed > 0) {
    const result = await spendSparks(payerId, sparksOwed, `Video call charge (${Math.ceil(billableSeconds / 60)} min beyond free allowance)`);
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
      const partial = await spendSparks(payerId, result.balance, "Video call charge (partial — insufficient balance)");
      if (partial.success) sparksCharged = result.balance;
      logger.error({ callId: call.id, sparksOwed, actuallyCharged: sparksCharged }, "Video call ended with insufficient Sparks to cover full duration");
    }
  }

  await supabase
    .from("video_calls")
    .update({ status: "ended", ended_at: endedAt.toISOString(), sparks_charged: sparksCharged })
    .eq("id", call.id);

  return { elapsedSeconds, sparksCharged };
}

router.post("/video-calls/:id/end", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { id } = req.params;

  const { data: call } = await supabase.rpc("get_video_call_by_id", { p_call_id: id });
  // See rpc_video_calls.sql — bypasses the same confirmed PostgREST
  // read-consistency issue that affected /status, applied here too
  // since every one of these action routes had the identical
  // vulnerable pattern. This specific gap is what let a failed
  // decline leave a call permanently stuck as "ringing."
  if (!call || (call.requester_id !== userId && call.acceptor_id !== userId) || call.status !== "active") {
    res.status(404).json({ error: "Call not found or not active" });
    return;
  }

  const { elapsedSeconds, sparksCharged } = await settleVideoCallBilling(call, new Date());
  res.json({ elapsed_seconds: elapsedSeconds, sparks_charged: sparksCharged });
});

/** POST /api/video-calls/:id/heartbeat — called by either party every
 *  ~20s while a call is active. This is what the scheduled stale-call
 *  cleanup function checks against: if a call's heartbeat goes silent
 *  (app force-closed, connectivity lost, or genuinely anything else
 *  that prevents a proper End Call signal from ever arriving), the
 *  cleanup treats it as over rather than letting it run — and bill —
 *  indefinitely. */
router.post("/video-calls/:id/heartbeat", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { id } = req.params;

  const { data: call } = await supabase.rpc("get_video_call_by_id", { p_call_id: id });
  if (!call || (call.requester_id !== userId && call.acceptor_id !== userId) || call.status !== "active") {
    res.status(404).json({ error: "Call not found or not active" });
    return;
  }

  await supabase.from("video_calls").update({ last_heartbeat_at: new Date().toISOString() }).eq("id", id);
  res.sendStatus(204);
});

// Must be meaningfully longer than VideoCallScreen.tsx's own 20s
// heartbeat interval to avoid false positives from an ordinary,
// momentary network hiccup — 90s gives roughly 4 missed heartbeats'
// worth of margin before treating a call as genuinely dead.
const STALE_THRESHOLD_SECONDS = 90;

/** POST /api/video-calls/_internal/cleanup-stale-calls — called only by
 *  the netlify/functions/end-stale-video-calls.mts scheduled function,
 *  every 2 minutes. All the actual logic lives here (inside the main
 *  Express bundle, already proven to correctly include all its
 *  dependencies) rather than in the scheduled function itself — that
 *  function is deliberately kept to a single dependency-free fetch()
 *  call, after Netlify's own logs confirmed its .mts bundling doesn't
 *  pull in @supabase/supabase-js the way this main bundle does.
 *
 *  Protected by a shared secret (not requireAuth) since the caller is
 *  a scheduled function, not a logged-in user with a JWT. */
router.post("/video-calls/_internal/cleanup-stale-calls", async (req, res): Promise<void> => {
  const providedSecret = req.headers["x-internal-cleanup-secret"];
  if (!process.env.INTERNAL_CLEANUP_SECRET || providedSecret !== process.env.INTERNAL_CLEANUP_SECRET) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const staleCutoff = new Date(Date.now() - STALE_THRESHOLD_SECONDS * 1000).toISOString();

  // Two separate queries rather than one combined .or() filter — this
  // codebase has already hit bugs from hand-built PostgREST .or()
  // strings before (see profile.ts's isUuidLike fix, and
  // sparks-helper.ts's getAbuseDelayUntil), so two simple queries are
  // used here instead, same reasoning.
  const { data: staleWithHeartbeat } = await supabase
    .from("video_calls")
    .select("id, match_id, accepted_at, used_free_call, acceptor_id, last_heartbeat_at")
    .eq("status", "active")
    .not("last_heartbeat_at", "is", null)
    .lt("last_heartbeat_at", staleCutoff);

  // Covers a call that went active but never received even its first
  // heartbeat at all (e.g. immediate connection failure right after
  // accept/answer, before VideoCallScreen.tsx's own heartbeat effect
  // ever got a chance to fire) — accepted_at is the only "last known
  // alive" timestamp available in that case.
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
      // be alive, not "now" (when this cleanup happens to run) —
      // fairer to the payer, since the real call very likely ended
      // around the last heartbeat, not whenever this endpoint next
      // got called.
      const lastKnownAliveAt = new Date(call.last_heartbeat_at ?? call.accepted_at);
      await settleVideoCallBilling(call, lastKnownAliveAt);
      logger.info({ callId: call.id }, "Ended stale video call via scheduled cleanup");
    } catch (err) {
      logger.error({ callId: call.id, err }, "Failed to end stale video call");
    }
  }

  res.json({ ended_count: staleCalls.length });
});

export default router;
