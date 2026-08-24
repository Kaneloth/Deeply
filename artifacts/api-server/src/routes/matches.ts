import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { supabase } from "../lib/supabase";
import { attachPhotoGalleries } from "../lib/photo-galleries";
import { attachAudioPrompts } from "../lib/audio-prompts-helper";
import { getBlockedUserIds } from "../lib/blocks-helper";
import { withComputedAge } from "../lib/age";
import { rememberMatched, getStickyMatched, forgetMatched } from "../lib/discover-exclusions";

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
const MATCHES_RETRY_DELAY_MS = 400; // kept for the list/indicator retries below, unchanged
const MATCH_LOOKUP_RETRY_SCHEDULE_MS = [400, 800, 1500]; // single-match lookup gets more chances specifically

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retries `fetchOnce` against MATCH_LOOKUP_RETRY_SCHEDULE_MS until it
 *  returns a non-empty, error-free result or the schedule is exhausted.
 *  See the file-level comment above for why a single fixed retry proved
 *  insufficient. */
async function fetchMatchWithBackoff<T>(
  fetchOnce: () => Promise<{ data: T | null; error: unknown }>,
  logLabel: string,
): Promise<{ data: T | null; error: unknown }> {
  let result = await fetchOnce();
  for (const delayMs of MATCH_LOOKUP_RETRY_SCHEDULE_MS) {
    if (!result.error && result.data) break;
    console.error(`MATCHES DEBUG: ${logLabel} came back empty/errored — retrying after ${delayMs}ms`);
    await delay(delayMs);
    result = await fetchOnce();
  }
  return result;
}

const MATCH_SELECT = `
  *,
  user1:profiles!matches_user1_id_fkey(
    id, name, age, birthday, bio, city, photo_url,
    integrity_score, personality_tags, is_verified, photo_verified, created_at,
    num_kids, family_plans, smoking_status, drinking_status
  ),
  user2:profiles!matches_user2_id_fkey(
    id, name, age, birthday, bio, city, photo_url,
    integrity_score, personality_tags, is_verified, photo_verified, created_at,
    num_kids, family_plans, smoking_status, drinking_status
  )
`;

async function formatMatch(m: Record<string, any>, viewerId: string) {
  const matchedUser = m.user1_id === viewerId ? m.user2 : m.user1;
  const [withPhotos] = matchedUser ? await attachPhotoGalleries([matchedUser]) : [null];
  const [withAudio] = withPhotos ? await attachAudioPrompts([withPhotos]) : [null];
  return {
    id: m.id,
    matched_user: withAudio ? withComputedAge(withAudio) : null,
    message_count: m.message_count,
    created_at: m.created_at,
  };
}

/** Same output shape as formatMatch, but for a whole list at once. The
 *  list endpoint used to call formatMatch once per match via
 *  Promise.all — that parallelizes the round trips instead of doing them
 *  one at a time, but for N matches it's still 2N separate outbound
 *  requests to Supabase (attachPhotoGalleries + attachAudioPrompts,
 *  each called individually per match) instead of 2 total. Both of those
 *  helpers already accept a whole array and batch internally in a single
 *  query — the fix is simply calling them ONCE across every matched user
 *  at once, the way they were designed to be used, instead of once per
 *  match. */
async function formatMatchesBatch(rawMatches: Record<string, any>[], viewerId: string) {
  const matchedUsers = rawMatches
    .map((m) => (m.user1_id === viewerId ? m.user2 : m.user1))
    .filter((u): u is Record<string, any> => !!u);

  const withPhotos = await attachPhotoGalleries(matchedUsers);
  const withAudio = await attachAudioPrompts(withPhotos);
  const hydratedById = new Map(withAudio.map((u) => [u.id, u]));

  return rawMatches.map((m) => {
    const matchedUser = m.user1_id === viewerId ? m.user2 : m.user1;
    const hydrated = matchedUser ? hydratedById.get(matchedUser.id) : undefined;
    return {
      id: m.id,
      matched_user: hydrated ? withComputedAge(hydrated) : null,
      message_count: m.message_count,
      created_at: m.created_at,
    };
  });
}

/** GET /api/matches — list all matches (chat is always open, no expiry).
 *  Also computes which matches are "new" (created since this viewer last
 *  loaded this page), then immediately updates their last-viewed
 *  timestamp — so the very next load won't show the same matches as new
 *  again, but this response correctly reflects what was new *before*
 *  this view. */
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

  const fetchRawMatches = () =>
    supabase
      .from("matches")
      .select(MATCH_SELECT)
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .order("created_at", { ascending: false });

  let { data: rawMatches } = await fetchRawMatches();

  // Cross-check against the shared sticky-matched cache — if a partner
  // this cache confirms should be matched isn't in this read's results,
  // that's a strong signal this particular read came back wrong (see
  // the comment above MATCHES_RETRY_DELAY_MS), so retry once rather
  // than trusting it immediately.
  const partnerIdOf = (m: Record<string, any>) => (m.user1_id === userId ? m.user2_id : m.user1_id);
  const presentPartnerIds = new Set((rawMatches ?? []).map(partnerIdOf));
  const stickyMatched = await getStickyMatched(userId);
  const missingFromSticky = [...stickyMatched].filter((id) => !presentPartnerIds.has(id));

  if (missingFromSticky.length > 0) {
    console.error(
      `MATCHES DEBUG: userId=${userId} list read missing sticky-confirmed partner(s) [${missingFromSticky.join(",")}] — retrying after ${MATCHES_RETRY_DELAY_MS}ms`,
    );
    await delay(MATCHES_RETRY_DELAY_MS);
    ({ data: rawMatches } = await fetchRawMatches());
  }

  // Reinforce the shared cache with whatever this read genuinely found
  // — same cache getPendingInviterIds reads from, so a match confirmed
  // here also protects the Invites page from showing this person as a
  // spurious pending invite.
  await rememberMatched(userId, (rawMatches ?? []).map(partnerIdOf));

  const blockedIds = new Set(await getBlockedUserIds(userId));
  const matches = (rawMatches ?? []).filter((m) => {
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

  const [{ data: viewerProfile }, { data: firstMatches }] = await Promise.all([
    supabase.from("profiles").select("matches_last_viewed_at").eq("id", userId).single(),
    fetchMyMatches(),
  ]);

  let myMatches = firstMatches;
  const partnerIdOf = (m: Record<string, any>) => (m.user1_id === userId ? m.user2_id : m.user1_id);
  const presentPartnerIds = new Set((myMatches ?? []).map(partnerIdOf));
  const stickyMatched = await getStickyMatched(userId);
  const missingFromSticky = [...stickyMatched].filter((id) => !presentPartnerIds.has(id));

  if (missingFromSticky.length > 0) {
    await delay(MATCHES_RETRY_DELAY_MS);
    ({ data: myMatches } = await fetchMyMatches());
  }

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

  const fetchMatch = () =>
    supabase
      .from("matches")
      .select(MATCH_SELECT)
      .eq("id", matchId)
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .single();

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

  res.json(await formatMatch(match as Record<string, any>, userId));
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

  let { data: match } = await fetchMatchId();

  // Same retry as the GET routes above — a false "not found" here would
  // wrongly block someone from unmatching a match that genuinely exists.
  if (!match) {
    await delay(MATCHES_RETRY_DELAY_MS);
    ({ data: match } = await fetchMatchId());
  }

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
