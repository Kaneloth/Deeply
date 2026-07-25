import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { supabase } from "../lib/supabase";

const router: IRouter = Router();

const MATCH_SELECT = `
  *,
  user1:profiles!matches_user1_id_fkey(
    id, name, age, bio, city, photo_url,
    integrity_score, personality_tags, is_verified, created_at
  ),
  user2:profiles!matches_user2_id_fkey(
    id, name, age, bio, city, photo_url,
    integrity_score, personality_tags, is_verified, created_at
  )
`;

function formatMatch(m: Record<string, any>, viewerId: string) {
  const matchedUser = m.user1_id === viewerId ? m.user2 : m.user1;
  return {
    id: m.id,
    matched_user: matchedUser ?? null,
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

  res.json((matches ?? []).map((m) => formatMatch(m as Record<string, any>, userId)));
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

  res.json(formatMatch(match as Record<string, any>, userId));
});

export default router;