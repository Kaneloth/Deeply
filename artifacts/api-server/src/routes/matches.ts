import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { supabase } from "../lib/supabase";
import { deductSparks } from "../lib/sparks-helper";

const router: IRouter = Router();

const MATCH_SELECT = `
  *,
  matched_user:profiles!matches_user2_id_fkey(
    id, name, age, bio, city, photo_url, sparks_balance,
    integrity_score, personality_tags, is_verified, created_at
  )
`;

function formatMatch(m: Record<string, unknown>) {
  return {
    id: m.id,
    matched_user: m.matched_user ?? null,
    status: m.status,
    photo_revealed: m.photo_revealed,
    chat_unlocked: m.chat_unlocked,
    message_count: m.message_count,
    message_limit: m.message_limit,
    expires_at: m.expires_at,
    matched_at: m.matched_at ?? null,
    created_at: m.created_at,
  };
}

/** GET /api/matches — list all active matches */
router.get("/matches", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const { data: matches } = await supabase
    .from("matches")
    .select(MATCH_SELECT)
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
    .in("status", ["pending", "matched"])
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });

  res.json((matches ?? []).map(formatMatch));
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

  res.json(formatMatch(match as Record<string, unknown>));
});

/** POST /api/matches/:matchId/accept — match blind */
router.post("/matches/:matchId/accept", requireAuth, async (req, res): Promise<void> => {
  const matchId = Array.isArray(req.params.matchId)
    ? req.params.matchId[0]
    : req.params.matchId;
  const userId = req.user!.id;

  const { data: match, error } = await supabase
    .from("matches")
    .update({ status: "matched", matched_at: new Date().toISOString() })
    .eq("id", matchId)
    .eq("user1_id", userId)
    .select(MATCH_SELECT)
    .single();

  if (error || !match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }

  res.json(formatMatch(match as Record<string, unknown>));
});

/** POST /api/matches/:matchId/reveal — reveal photo (2 Sparks) */
router.post("/matches/:matchId/reveal", requireAuth, async (req, res): Promise<void> => {
  const matchId = Array.isArray(req.params.matchId)
    ? req.params.matchId[0]
    : req.params.matchId;
  const userId = req.user!.id;

  const spark = await deductSparks(userId, 2, "Photo reveal");
  if (!spark.success) {
    res.status(402).json({ error: "Insufficient Sparks (need 2)" });
    return;
  }

  const { data: match, error } = await supabase
    .from("matches")
    .update({ photo_revealed: true })
    .eq("id", matchId)
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
    .select(MATCH_SELECT)
    .single();

  if (error || !match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }

  res.json(formatMatch(match as Record<string, unknown>));
});

/** POST /api/matches/:matchId/extend — add 2 hours (1 Spark) */
router.post("/matches/:matchId/extend", requireAuth, async (req, res): Promise<void> => {
  const matchId = Array.isArray(req.params.matchId)
    ? req.params.matchId[0]
    : req.params.matchId;
  const userId = req.user!.id;

  const spark = await deductSparks(userId, 1, "Timer extension");
  if (!spark.success) {
    res.status(402).json({ error: "Insufficient Sparks (need 1)" });
    return;
  }

  // Fetch current expiry and extend by 2 hours
  const { data: current } = await supabase
    .from("matches")
    .select("expires_at")
    .eq("id", matchId)
    .single();

  const currentExpiry = current?.expires_at
    ? new Date(current.expires_at)
    : new Date();
  const newExpiry = new Date(currentExpiry.getTime() + 2 * 60 * 60 * 1000);

  const { data: match, error } = await supabase
    .from("matches")
    .update({ expires_at: newExpiry.toISOString() })
    .eq("id", matchId)
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
    .select(MATCH_SELECT)
    .single();

  if (error || !match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }

  res.json(formatMatch(match as Record<string, unknown>));
});

/** POST /api/matches/:matchId/unlock-chat — 1 free key/day, else 5 Sparks */
router.post("/matches/:matchId/unlock-chat", requireAuth, async (req, res): Promise<void> => {
  const matchId = Array.isArray(req.params.matchId)
    ? req.params.matchId[0]
    : req.params.matchId;
  const userId = req.user!.id;

  // Check if free key is available today
  const today = new Date().toISOString().split("T")[0];
  const { data: usedKey } = await supabase
    .from("daily_earn_claims")
    .select("id")
    .eq("user_id", userId)
    .eq("claim_type", "chat_key_used")
    .eq("claimed_date", today)
    .single();

  if (!usedKey) {
    // Use free key
    await supabase.from("daily_earn_claims").insert({
      user_id: userId,
      claim_type: "chat_key_used",
      claimed_date: today,
    });
  } else {
    // Charge 5 Sparks
    const spark = await deductSparks(userId, 5, "Chat key");
    if (!spark.success) {
      res.status(402).json({ error: "Insufficient Sparks (need 5) and no free keys remaining" });
      return;
    }
  }

  const { data: match, error } = await supabase
    .from("matches")
    .update({ chat_unlocked: true })
    .eq("id", matchId)
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
    .select(MATCH_SELECT)
    .single();

  if (error || !match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }

  res.json(formatMatch(match as Record<string, unknown>));
});

/** POST /api/matches/:matchId/stretch — +10 messages (3 Sparks) */
router.post("/matches/:matchId/stretch", requireAuth, async (req, res): Promise<void> => {
  const matchId = Array.isArray(req.params.matchId)
    ? req.params.matchId[0]
    : req.params.matchId;
  const userId = req.user!.id;

  const spark = await deductSparks(userId, 3, "Message stretch +10");
  if (!spark.success) {
    res.status(402).json({ error: "Insufficient Sparks (need 3)" });
    return;
  }

  const { data: current } = await supabase
    .from("matches")
    .select("message_limit")
    .eq("id", matchId)
    .single();

  const newLimit = (current?.message_limit ?? 20) + 10;

  const { data: match, error } = await supabase
    .from("matches")
    .update({ message_limit: newLimit })
    .eq("id", matchId)
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
    .select(MATCH_SELECT)
    .single();

  if (error || !match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }

  res.json(formatMatch(match as Record<string, unknown>));
});

export default router;
