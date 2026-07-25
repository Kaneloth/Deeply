import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { supabase } from "../lib/supabase";
import { spendSparks } from "../lib/sparks-helper";

const router: IRouter = Router();

const SUPER_LIKE_COST = 20;
const UNDO_COST = 10;
const REVEAL_LIKES_COST = 30;

/** GET /api/discover/queue — return a batch of candidate profiles the user
 *  hasn't swiped on yet, ready to swipe through Tinder-style. */
router.get("/discover/queue", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const { data: alreadySwiped } = await supabase
    .from("swipes")
    .select("target_id")
    .eq("swiper_id", userId);

  const excludedIds = [userId, ...(alreadySwiped?.map((s) => s.target_id) ?? [])];

  const { data: candidates, error } = await supabase
    .from("profiles")
    .select("id, name, age, bio, city, photo_url, personality_tags, integrity_score")
    .not("id", "in", `(${excludedIds.join(",")})`)
    .limit(20);

  if (error) {
    res.status(500).json({ error: "Failed to load discover queue" });
    return;
  }

  if (!candidates || candidates.length === 0) {
    res.json({ candidates: [] });
    return;
  }

  const candidateIds = candidates.map((c) => c.id);
  const { data: prompts } = await supabase
    .from("audio_prompts")
    .select("*")
    .in("user_id", candidateIds);

  const promptsByUser = new Map<string, typeof prompts>();
  for (const prompt of prompts ?? []) {
    const list = promptsByUser.get(prompt.user_id) ?? [];
    if (list.length < 2) {
      list.push(prompt);
      promptsByUser.set(prompt.user_id, list);
    }
  }

  const enriched = candidates.map((c) => ({
    ...c,
    audio_prompts: promptsByUser.get(c.id) ?? [],
  }));

  res.json({ candidates: enriched });
});

/** POST /api/discover/swipe — record a like / pass / super_like and report
 *  back whether it created a mutual match. Super Like costs Sparks. */
router.post("/discover/swipe", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { targetId, direction } = req.body as {
    targetId?: string;
    direction?: "like" | "pass" | "super_like";
  };

  if (!targetId || !direction || !["like", "pass", "super_like"].includes(direction)) {
    res.status(400).json({ error: "targetId and a valid direction are required" });
    return;
  }

  if (targetId === userId) {
    res.status(400).json({ error: "Cannot swipe on your own profile" });
    return;
  }

  if (direction === "super_like") {
    const spend = await spendSparks(userId, SUPER_LIKE_COST, "Super Like");
    if (!spend.success) {
      res.status(402).json({ error: `Insufficient Sparks (need ${SUPER_LIKE_COST})`, balance: spend.balance });
      return;
    }
  }

  const { error: insertError } = await supabase.from("swipes").insert({
    swiper_id: userId,
    target_id: targetId,
    direction,
  });

  if (insertError) {
    if (insertError.code === "23505") {
      res.status(409).json({ error: "You've already swiped on this profile" });
      return;
    }
    res.status(500).json({ error: "Failed to record swipe" });
    return;
  }

  if (direction === "pass") {
    res.json({ matched: false });
    return;
  }

  const [lo, hi] = [userId, targetId].sort();
  const { data: match } = await supabase
    .from("matches")
    .select("id")
    .eq("user1_id", lo)
    .eq("user2_id", hi)
    .maybeSingle();

  res.json({ matched: !!match, matchId: match?.id ?? null });
});

/** POST /api/discover/undo — undo the user's most recent swipe (10 Sparks).
 *  Blocked if that swipe already resulted in a match. */
router.post("/discover/undo", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const { data: lastSwipe } = await supabase
    .from("swipes")
    .select("*")
    .eq("swiper_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lastSwipe) {
    res.status(400).json({ error: "No swipe to undo" });
    return;
  }

  const [lo, hi] = [userId, lastSwipe.target_id].sort();
  const { data: existingMatch } = await supabase
    .from("matches")
    .select("id")
    .eq("user1_id", lo)
    .eq("user2_id", hi)
    .maybeSingle();

  if (existingMatch) {
    res.status(400).json({ error: "Can't undo a swipe that already resulted in a match" });
    return;
  }

  const spend = await spendSparks(userId, UNDO_COST, "Undo swipe");
  if (!spend.success) {
    res.status(402).json({ error: `Insufficient Sparks (need ${UNDO_COST})`, balance: spend.balance });
    return;
  }

  await supabase.from("swipes").delete().eq("id", lastSwipe.id);

  const { data: restoredProfile } = await supabase
    .from("profiles")
    .select("id, name, age, bio, city, photo_url, personality_tags, integrity_score")
    .eq("id", lastSwipe.target_id)
    .single();

  res.json({ restoredProfile: restoredProfile ?? null, balance: spend.balance });
});

/** GET /api/discover/likes/count — FREE. Just the number of people who
 *  like this user but haven't matched yet, to create curiosity without
 *  a paywall on the number itself. */
router.get("/discover/likes/count", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const { data: incomingLikes } = await supabase
    .from("swipes")
    .select("swiper_id")
    .eq("target_id", userId)
    .in("direction", ["like", "super_like"]);

  const likerIds = incomingLikes?.map((l) => l.swiper_id) ?? [];

  if (likerIds.length === 0) {
    res.json({ count: 0 });
    return;
  }

  // Exclude anyone already matched — no need to "reveal" someone you're
  // already talking to.
  const { data: existingMatches } = await supabase
    .from("matches")
    .select("user1_id, user2_id")
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`);

  const matchedIds = new Set(
    (existingMatches ?? []).map((m) => (m.user1_id === userId ? m.user2_id : m.user1_id)),
  );

  const pendingCount = likerIds.filter((id) => !matchedIds.has(id)).length;

  res.json({ count: pendingCount });
});

/** POST /api/discover/likes/reveal — PAID (30 Sparks). Returns the full
 *  profiles of everyone who likes this user and hasn't matched yet. */
router.post("/discover/likes/reveal", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const spend = await spendSparks(userId, REVEAL_LIKES_COST, "See who liked you");
  if (!spend.success) {
    res.status(402).json({ error: `Insufficient Sparks (need ${REVEAL_LIKES_COST})`, balance: spend.balance });
    return;
  }

  const { data: incomingLikes } = await supabase
    .from("swipes")
    .select("swiper_id, direction")
    .eq("target_id", userId)
    .in("direction", ["like", "super_like"]);

  const likerIds = incomingLikes?.map((l) => l.swiper_id) ?? [];

  if (likerIds.length === 0) {
    res.json({ likers: [], balance: spend.balance });
    return;
  }

  const { data: existingMatches } = await supabase
    .from("matches")
    .select("user1_id, user2_id")
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`);

  const matchedIds = new Set(
    (existingMatches ?? []).map((m) => (m.user1_id === userId ? m.user2_id : m.user1_id)),
  );

  const pendingLikerIds = likerIds.filter((id) => !matchedIds.has(id));

  if (pendingLikerIds.length === 0) {
    res.json({ likers: [], balance: spend.balance });
    return;
  }

  const { data: likers } = await supabase
    .from("profiles")
    .select("id, name, age, bio, city, photo_url, personality_tags, integrity_score")
    .in("id", pendingLikerIds);

  // Flag super-likers so the frontend can show a star badge.
  const superLikerIds = new Set(
    (incomingLikes ?? []).filter((l) => l.direction === "super_like").map((l) => l.swiper_id),
  );

  const enriched = (likers ?? []).map((l) => ({ ...l, super_liked: superLikerIds.has(l.id) }));

  res.json({ likers: enriched, balance: spend.balance });
});

export default router;
