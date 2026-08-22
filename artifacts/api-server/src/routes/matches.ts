import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { supabase } from "../lib/supabase";
import { attachPhotoGalleries } from "../lib/photo-galleries";
import { attachAudioPrompts } from "../lib/audio-prompts-helper";
import { getBlockedUserIds } from "../lib/blocks-helper";
import { withComputedAge } from "../lib/age";

const router: IRouter = Router();

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

  const { data: viewerProfile, error: viewerError } = await supabase
    .from("profiles")
    .select("matches_last_viewed_at")
    .eq("id", userId)
    .single();
  if (viewerError) {
    res.status(500).json({ error: "Failed to load matches view state" });
    return;
  }
  const lastViewedAt = viewerProfile?.matches_last_viewed_at
    ? new Date(viewerProfile.matches_last_viewed_at)
    : new Date(0);

  const { data: rawMatches, error: matchesError } = await supabase
    .from("matches")
    .select(MATCH_SELECT)
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
    .order("created_at", { ascending: false });
  if (matchesError) {
    res.status(500).json({ error: "Failed to load matches" });
    return;
  }

  const blockedIds = new Set(await getBlockedUserIds(userId));
  const matches = (rawMatches ?? []).filter((m) => {
    const partnerId = m.user1_id === userId ? m.user2_id : m.user1_id;
    return !blockedIds.has(partnerId);
  });

  const matchIds = matches.map((m) => m.id);
  let unreadMatchIds = new Set<string>();
  if (matchIds.length > 0) {
    const { data: unreadRows, error: unreadError } = await supabase
      .from("messages")
      .select("match_id")
      .in("match_id", matchIds)
      .eq("is_read", false)
      .neq("sender_id", userId);
    if (unreadError) {
      res.status(500).json({ error: "Failed to load unread match messages" });
      return;
    }
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
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  const userId = req.user!.id;

  const [{ data: viewerProfile }, { data: myMatches }] = await Promise.all([
    supabase.from("profiles").select("matches_last_viewed_at").eq("id", userId).single(),
    supabase
      .from("matches")
      .select("id, created_at")
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`),
  ]);

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

  const { data: match, error } = await supabase
    .from("matches")
    .select(MATCH_SELECT)
    .eq("id", matchId)
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
    .single();

  if (error || !match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }

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

  const { data: match } = await supabase
    .from("matches")
    .select("id")
    .eq("id", matchId)
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
    .single();

  if (!match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }

  const { error } = await supabase.from("matches").delete().eq("id", matchId);

  if (error) {
    res.status(500).json({ error: `Failed to unmatch: ${error.message}` });
    return;
  }

  res.sendStatus(204);
});

export default router;