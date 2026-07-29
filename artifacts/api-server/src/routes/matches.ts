import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { supabase } from "../lib/supabase";
import { attachPhotoGalleries } from "../lib/photo-galleries";
import { attachAudioPrompts } from "../lib/audio-prompts-helper";
import { withComputedAge } from "../lib/age";

const router: IRouter = Router();

const MATCH_SELECT = `
  *,
  user1:profiles!matches_user1_id_fkey(
    id, name, age, birthday, bio, city, photo_url,
    integrity_score, personality_tags, is_verified, created_at,
    num_kids, family_plans, smoking_status, drinking_status
  ),
  user2:profiles!matches_user2_id_fkey(
    id, name, age, birthday, bio, city, photo_url,
    integrity_score, personality_tags, is_verified, created_at,
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

/** GET /api/matches — list all matches (chat is always open, no expiry) */
router.get("/matches", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const { data: matches } = await supabase
    .from("matches")
    .select(MATCH_SELECT)
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
    .order("created_at", { ascending: false });

  const matchIds = (matches ?? []).map((m) => m.id);
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

  const formatted = await Promise.all(
    (matches ?? []).map((m) => formatMatch(m as Record<string, any>, userId)),
  );

  res.json(formatted.map((m) => ({ ...m, has_unread: unreadMatchIds.has(m.id) })));
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
