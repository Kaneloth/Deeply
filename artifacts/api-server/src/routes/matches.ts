import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { supabase } from "../lib/supabase";
import { attachPhotoGalleries } from "../lib/photo-galleries";
import { getBlockedUserIds } from "../lib/blocks-helper";
import { withComputedAge } from "../lib/age";
import { rememberMatched, getStickyMatched, forgetMatched } from "../lib/discover-exclusions";
import { checkChatUnlockExpiry } from "../lib/chat-unlock-helper";

const router: IRouter = Router();

// Production logs on 2026-08-23 proved the `matches` table read is
// unreliable specifically from THIS file's own routes too, not just
// from getPendingInviterIds (already mitigated with a sticky cache —
// see discover-exclusions.ts). One account's own GET /discover/invites
// needed that cache to rescue a specific match on every single call
// across a 5-minute window — not occasional, persistent — and directly
// opening that same match via GET /matches/:matchId (a lookup by
// primary key, about as simple as a read gets) returned 404 despite the
// row demonstrably existing in the table. That's a stronger signal than
// simple eventual-consistency lag.
//
// Follow-up logs on 2026-08-24 escalated this further: a single 400ms
// retry (the original version of this fix) was observed firing
// repeatedly — same match, same "missing" result — across roughly 37
// SECONDS of consecutive polls, meaning the underlying inconsistency
// window can badly outlast one short retry. This isn't a full fix for
// that (a single HTTP request can't reasonably wait 37 seconds), but a
// short backoff schedule meaningfully improves the odds over a single
// fixed-delay retry, at a still-reasonable added latency. The more
// robust fix is proactive: discover.ts's createMatchWithAnyPendingMessages
// now seeds the sticky-matched cache the instant a match is created,
// rather than waiting for some later read to happen to succeed and
// remember it — see that function's comment. This backoff schedule is
// the remaining stopgap for whatever that doesn't already cover.
//
// Unlike getPendingInviterIds, these routes need the actual match ROW
// (photos, message count, etc.), not just a yes/no — so a boolean cache
// alone can't fix a genuinely missing read here the way it could there.
// rememberMatched/getStickyMatched (the same shared cache from
// discover-exclusions.ts) is used both as the signal for "this looks
// wrong" for the list endpoint, and is reinforced by every route here
// that gets a genuine successful read — so a match confirmed by ANY of
// these routes protects all of them, not just the one that happened to
// see it.
// Extended 2026-08-30, based on direct evidence from production logs: a
// single account (e4541cc0...) hit the exact same match failing on
// EVERY first attempt, 404 after exhausting the old 3-attempt schedule
// (400/800/1500ms, ~2.7s total) — but a fresh request just 2-12 seconds
// LATER consistently succeeded normally. The old schedule wasn't wrong,
// it just wasn't waiting long enough: the underlying inconsistency
// window is longer than 2.7s but reliably resolves within single-digit
// seconds afterward. This trades a longer wait on the very first tap
// (now up to ~10s worst case, with a loading state, not an error) for
// eliminating the "fails, disappears, tap again to actually open it"
// cycle entirely for most cases. Still a mitigation, not a fix — the
// underlying cause is still an open question with Supabase.
//
// Widened to a SHARED schedule (was single-match-lookup-only) after
// further evidence the same day: the LIST read (GET /matches) and
// indicator-status were still each only getting ONE 400ms retry, and
// production logs showed the list read missing SEVEN confirmed match
// partners simultaneously, three times in one session — a single
// account's entire matches list coming back nearly empty, not just one
// flaky row. That's a more severe symptom than anything the single-
// match lookup was hitting, yet it had the WEAKEST retry protection in
// this file. All four routes below now share this same schedule.
const MATCHES_RETRY_SCHEDULE_MS = [500, 1000, 2000, 3000, 3000];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Generic version of fetchMatchWithBackoff below, for the three routes
 *  that don't fit its {data, error} shape (the list and indicator-status
 *  routes check "is a sticky-confirmed partner missing from this
 *  result", DELETE checks "did we find a row at all"). Same shared
 *  schedule, same principle — keep retrying until the result looks
 *  right or the schedule runs out — just parameterized over what
 *  "looks right" means for each specific caller. */
async function retryUntilSatisfied<T>(
  fetchOnce: () => Promise<T>,
  isSatisfied: (result: T) => boolean,
  logLabel: string,
): Promise<T> {
  let result = await fetchOnce();
  for (const delayMs of MATCHES_RETRY_SCHEDULE_MS) {
    if (isSatisfied(result)) break;
    console.error(`MATCHES DEBUG: ${logLabel} — retrying after ${delayMs}ms`);
    await delay(delayMs);
    result = await fetchOnce();
  }
  return result;
}

/** Retries `fetchOnce` against MATCHES_RETRY_SCHEDULE_MS until it
 *  returns a non-empty, error-free result or the schedule is exhausted.
 *  See the file-level comment above for why a single fixed retry proved
 *  insufficient.
 *
 *  Logs the ACTUAL underlying error object on every retry, not just a
 *  generic "empty/errored" — a genuinely EMPTY result (transient read-
 *  after-write lag, the thing this retry schedule was built for) and a
 *  genuinely ERRORED result (e.g. a real query/schema problem, which no
 *  amount of retrying fixes) look identical without this, and telling
 *  them apart is exactly what's needed to diagnose "every single match
 *  lookup fails, including ones confirmed to exist" rather than
 *  guessing blindly. */
async function fetchMatchWithBackoff<T>(
  fetchOnce: () => Promise<{ data: T | null; error: unknown }>,
  logLabel: string,
): Promise<{ data: T | null; error: unknown }> {
  let result = await fetchOnce();
  for (const delayMs of MATCHES_RETRY_SCHEDULE_MS) {
    if (!result.error && result.data) break;
    if (result.error) {
      console.error(`MATCHES DEBUG: ${logLabel} — GENUINE ERROR (not just empty): ${JSON.stringify(result.error)} — retrying after ${delayMs}ms`);
    } else {
      console.error(`MATCHES DEBUG: ${logLabel} came back empty (no error) — retrying after ${delayMs}ms`);
    }
    await delay(delayMs);
    result = await fetchOnce();
  }
  if (result.error) {
    console.error(`MATCHES DEBUG: ${logLabel} — FINAL GENUINE ERROR after all retries exhausted: ${JSON.stringify(result.error)}`);
  }
  return result;
}

const MATCH_SELECT = `
  *,
  user1:profiles!matches_user1_id_fkey(
    id, name, age, birthday, bio, city, photo_url,
    integrity_score, personality_tags, is_verified, photo_verified, is_founder, created_at,
    num_kids, family_plans, smoking_status, drinking_status, vaping_status, has_tattoos, pets,
    activity_level, nightlife_frequency, height_cm, education, languages_spoken, languages_other,
    love_language, dating_intentions, relationship_type
  ),
  user2:profiles!matches_user2_id_fkey(
    id, name, age, birthday, bio, city, photo_url,
    integrity_score, personality_tags, is_verified, photo_verified, is_founder, created_at,
    num_kids, family_plans, smoking_status, drinking_status, vaping_status, has_tattoos, pets,
    activity_level, nightlife_frequency, height_cm, education, languages_spoken, languages_other,
    love_language, dating_intentions, relationship_type
  )
`;

// ProfileCardData only recognizes `looking_for`, not the raw
// relationship_type column name — same rename applied consistently
// across discover.ts's endpoints. Without this, Match Detail's card
// would have the right data fetched but under a field name it never
// reads, so "Looking For" would silently show nothing.
function renameLookingFor<T extends Record<string, any>>(profile: T): Omit<T, "relationship_type"> & { looking_for: string | null } {
  const { relationship_type, ...rest } = profile;
  return { ...rest, looking_for: relationship_type ?? null };
}

async function formatMatch(m: Record<string, any>, viewerId: string) {
  const matchedUser = m.user1_id === viewerId ? m.user2 : m.user1;
  const [withPhotos] = matchedUser ? await attachPhotoGalleries([matchedUser]) : [null];
  return {
    id: m.id,
    matched_user: withPhotos ? renameLookingFor(withComputedAge(withPhotos)) : null,
    message_count: m.message_count,
    created_at: m.created_at,
    // See chat-unlock-helper.ts for the full state machine. initiator_id
    // is included so the frontend can tell "am I the one waiting, or the
    // one who owes a reply" apart — each needs different copy/countdown
    // framing even though they're looking at the exact same status.
    // initiated_at is what the countdown itself is computed from
    // client-side (initiated_at + 48h), rather than sending an
    // already-computed "time remaining" that would immediately start
    // drifting stale the moment this response is more than a second old.
    chat_unlock_status: m.chat_unlock_status,
    chat_unlock_initiator_id: m.chat_unlock_initiator_id,
    chat_unlock_initiated_at: m.chat_unlock_initiated_at,
  };
}

/** Same output shape as formatMatch, but for a whole list at once. The
 *  list endpoint used to call formatMatch once per match via
 *  Promise.all — that parallelizes the round trips instead of doing them
 *  one at a time, but for N matches it's still N separate outbound
 *  requests to Supabase (attachPhotoGalleries called individually per
 *  match) instead of 1. That helper already accepts a whole array and
 *  batches internally in a single query — the fix is simply calling it
 *  ONCE across every matched user at once, the way it was designed to
 *  be used, instead of once per match. */
async function formatMatchesBatch(rawMatches: Record<string, any>[], viewerId: string) {
  const matchedUsers = rawMatches
    .map((m) => (m.user1_id === viewerId ? m.user2 : m.user1))
    .filter((u): u is Record<string, any> => !!u);

  const withPhotos = await attachPhotoGalleries(matchedUsers);
  const hydratedById = new Map(withPhotos.map((u) => [u.id, u]));

  return rawMatches.map((m) => {
    const matchedUser = m.user1_id === viewerId ? m.user2 : m.user1;
    const hydrated = matchedUser ? hydratedById.get(matchedUser.id) : undefined;
    return {
      id: m.id,
      matched_user: hydrated ? renameLookingFor(withComputedAge(hydrated)) : null,
      message_count: m.message_count,
      created_at: m.created_at,
      chat_unlock_status: m.chat_unlock_status,
      chat_unlock_initiator_id: m.chat_unlock_initiator_id,
      chat_unlock_initiated_at: m.chat_unlock_initiated_at,
    };
  });
}

/** GET /api/matches — list all matches (chat itself never expires, but
 *  a still-locked/awaiting-reply one's underlying unlock attempt can —
 *  see chat-unlock-helper.ts). Also computes which matches are "new"
 *  (created since this viewer last loaded this page), then immediately
 *  updates their last-viewed timestamp — so the very next load won't
 *  show the same matches as new again, but this response correctly
 *  reflects what was new *before* this view. */
router.get("/matches", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const { data: viewerProfile } = await supabase
    .from("profiles")
    .select("matches_last_viewed_at")
    .eq("id", userId)
    .single();
  const lastViewedAt = viewerProfile?.matches_last_viewed_at
    ? new Date(viewerProfile.matches_last_viewed_at)
    : new Date(0);

  // RPC instead of .select() — see rpc_get_matches_for_user.sql for the
  // full reasoning (a second, independent test of the same PostgREST-
  // bypass hypothesis, from the list-endpoint angle rather than the
  // single-match one). Same array-of-rows shape as before, so the
  // sticky-cache cross-check below needs zero changes — only what it's
  // checking changed.
  const fetchRawMatches = () => supabase.rpc("get_matches_for_user", { p_user_id: userId });

  // Cross-check against the shared sticky-matched cache — if a partner
  // this cache confirms should be matched isn't in this read's results,
  // that's a strong signal this particular read came back wrong (see
  // the comment above MATCHES_RETRY_SCHEDULE_MS), so keep retrying
  // rather than trusting it immediately. Was a single 400ms retry;
  // widened to the same multi-attempt schedule as the single-match
  // lookup after logs showed this exact check failing for SEVEN
  // confirmed partners simultaneously — one retry was nowhere near
  // enough for a failure that severe.
  const partnerIdOf = (m: Record<string, any>) => (m.user1_id === userId ? m.user2_id : m.user1_id);
  const stickyMatched = await getStickyMatched(userId);

  const { data: rawMatches } = await retryUntilSatisfied(
    fetchRawMatches,
    (result) => {
      const present = new Set((result.data ?? []).map(partnerIdOf));
      const missing = [...stickyMatched].filter((id) => !present.has(id));
      if (missing.length > 0) {
        console.error(
          `MATCHES DEBUG: userId=${userId} list read missing sticky-confirmed partner(s) [${missing.join(",")}]`,
        );
        return false;
      }
      return true;
    },
    `userId=${userId} list read`,
  );

  // Reinforce the shared cache with whatever this read genuinely found
  // — same cache getPendingInviterIds reads from, so a match confirmed
  // here also protects the Invites page from showing this person as a
  // spurious pending invite.
  await rememberMatched(userId, (rawMatches ?? []).map(partnerIdOf));

  const blockedIds = new Set(await getBlockedUserIds(userId));
  let matches = (rawMatches ?? []).filter((m) => {
    const partnerId = m.user1_id === userId ? m.user2_id : m.user1_id;
    return !blockedIds.has(partnerId);
  });

  const matchIds = matches.map((m) => m.id);
  let unreadMatchIds = new Set<string>();
  if (matchIds.length > 0) {
    const { data: unreadRows } = await supabase
      .from("messages")
      .select("match_id")
      .in("match_id", matchIds)
      .eq("is_read", false)
      .neq("sender_id", userId);
    unreadMatchIds = new Set((unreadRows ?? []).map((r) => r.match_id));
  }

  // Lazily catches any 48h-expired unlock attempts across the WHOLE
  // list, not just whichever single match someone happens to open — a
  // match sitting in 'awaiting_reply' past its window gets caught (and
  // its refund/notifications processed) the moment either party so much
  // as loads their matches list, not only when they open that specific
  // chat. See chat-unlock-helper.ts for why this is lazy rather than a
  // scheduled sweep.
  //
  // Filtered to ONLY matches actually in 'awaiting_reply' before calling
  // checkChatUnlockExpiry at all — that function already early-returns
  // as a no-op for every other status, so behavior here is identical
  // either way, but for a list of, say, 20 matches where at most one or
  // two are ever actually 'awaiting_reply', this avoids 18-19
  // essentially-pointless function calls (each still real Promise/async
  // overhead) on EVERY single list fetch, which this page polls
  // frequently. This app has already proven, repeatedly this session,
  // to be sensitive to exactly this kind of added concurrent load
  // worsening Supabase's own read-consistency timing on OTHER, unrelated
  // queries — keeping this list-endpoint work to the minimum actually
  // necessary matters more here than it would look like in isolation.
  const awaitingReplyMatches = matches.filter((m) => (m as Record<string, any>).chat_unlock_status === "awaiting_reply");
  if (awaitingReplyMatches.length > 0) {
    const expiryResults = await Promise.all(awaitingReplyMatches.map((m) => checkChatUnlockExpiry(m as Record<string, any>)));
    const expiryResultById = new Map(expiryResults.map((m) => [m.id, m]));
    matches = matches.map((m) => expiryResultById.get(m.id) ?? m) as typeof matches;
  }

  const formatted = await formatMatchesBatch(matches as Record<string, any>[], userId);

  const result = formatted.map((m) => ({
    ...m,
    has_unread: unreadMatchIds.has(m.id),
    is_new: new Date(m.created_at) > lastViewedAt,
  }));

  // Now that we've computed which were new relative to the OLD
  // timestamp, advance it — best-effort, doesn't block the response.
  supabase
    .from("profiles")
    .update({ matches_last_viewed_at: new Date().toISOString() })
    .eq("id", userId)
    .then(() => {});

  res.json(result);
});

/** GET /api/matches/indicator-status — lightweight check for the bottom
 *  nav dot: is there anything new or unread at all? Deliberately avoids
 *  the full match/photo/audio hydration that GET /matches does, since
 *  this gets polled frequently just to decide whether to show a dot. */
router.get("/matches/indicator-status", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const fetchMyMatches = () =>
    supabase
      .from("matches")
      .select("id, created_at, user1_id, user2_id")
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`);

  const partnerIdOf = (m: Record<string, any>) => (m.user1_id === userId ? m.user2_id : m.user1_id);
  const stickyMatched = await getStickyMatched(userId);

  // Same widened retry as the list route above (see its comment) — this
  // drives the bottom-nav "new match" dot, so a false negative here
  // means someone doesn't even realize they have a new match to check.
  const [{ data: viewerProfile }, matchesResult] = await Promise.all([
    supabase.from("profiles").select("matches_last_viewed_at").eq("id", userId).single(),
    retryUntilSatisfied(
      fetchMyMatches,
      (result) => {
        const present = new Set((result.data ?? []).map(partnerIdOf));
        return [...stickyMatched].every((id) => present.has(id));
      },
      `userId=${userId} indicator-status`,
    ),
  ]);
  const myMatches = matchesResult.data;

  const lastViewedAt = viewerProfile?.matches_last_viewed_at
    ? new Date(viewerProfile.matches_last_viewed_at)
    : new Date(0);
  const hasNewMatch = (myMatches ?? []).some((m) => new Date(m.created_at) > lastViewedAt);

  const matchIds = (myMatches ?? []).map((m) => m.id);
  let hasUnreadMessage = false;
  if (matchIds.length > 0) {
    const { count } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .in("match_id", matchIds)
      .eq("is_read", false)
      .neq("sender_id", userId);
    hasUnreadMessage = (count ?? 0) > 0;
  }

  res.json({ indicator: hasNewMatch || hasUnreadMessage });
});

/** GET /api/matches/:matchId */
router.get("/matches/:matchId", requireAuth, async (req, res): Promise<void> => {
  const matchId = Array.isArray(req.params.matchId)
    ? req.params.matchId[0]
    : req.params.matchId;
  const userId = req.user!.id;

  // RPC instead of .select() — bypasses PostgREST's normal query path
  // entirely (see rpc_get_match_by_id.sql for the full reasoning). Same
  // {data, error} shape as before, so fetchMatchWithBackoff's retry
  // logic below needs zero changes — only what it's retrying changed.
  const fetchMatch = () => supabase.rpc("get_match_by_id", { p_match_id: matchId, p_user_id: userId });

  const { data: match, error } = await fetchMatchWithBackoff(fetchMatch, `userId=${userId} matchId=${matchId} lookup`);

  if (error || !match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }

  // A genuine hit here is exactly the kind of confirmation the shared
  // sticky-matched cache is meant to remember, protecting the Invites
  // page and the matches list from the same read issue.
  const partnerId = (match as Record<string, any>).user1_id === userId
    ? (match as Record<string, any>).user2_id
    : (match as Record<string, any>).user1_id;
  await rememberMatched(userId, [partnerId]);

  // Same lazy expiry check as the list endpoint — opening this specific
  // chat is itself one of the moments a 48h-expired unlock attempt needs
  // to be caught, in case the list endpoint hasn't already (e.g. this
  // was reached via a push notification or direct link, bypassing the
  // list view entirely).
  const currentMatch = await checkChatUnlockExpiry(match as Record<string, any>);

  res.json(await formatMatch(currentMatch, userId));
});

/** DELETE /api/matches/:matchId — unmatch. Removes the match (and, via
 *  cascade, its messages). The underlying swipe records are left in
 *  place, which already keeps this person from reappearing in either
 *  side's Discover/Invites queues. */
router.delete("/matches/:matchId", requireAuth, async (req, res): Promise<void> => {
  const matchId = Array.isArray(req.params.matchId)
    ? req.params.matchId[0]
    : req.params.matchId;
  const userId = req.user!.id;

  const fetchMatchId = () =>
    supabase
      .from("matches")
      .select("id, user1_id, user2_id")
      .eq("id", matchId)
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .single();

  const { data: match } = await fetchMatchWithBackoff(fetchMatchId, `userId=${userId} matchId=${matchId} delete-lookup`);

  if (!match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }

  const { error } = await supabase.from("matches").delete().eq("id", matchId);

  if (error) {
    res.status(500).json({ error: `Failed to unmatch: ${error.message}` });
    return;
  }

  // Proactively clear the shared sticky-matched cache for this pair —
  // see the comment above forgetMatched in discover-exclusions.ts for
  // why this is what lets that cache's TTL be long rather than short.
  const matchRow = match as Record<string, any>;
  const partnerId = matchRow.user1_id === userId ? matchRow.user2_id : matchRow.user1_id;
  await forgetMatched(userId, partnerId);

  res.sendStatus(204);
});

export default router;
