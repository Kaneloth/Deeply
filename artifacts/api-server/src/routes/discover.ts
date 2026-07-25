import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { supabase } from "../lib/supabase";

const router: IRouter = Router();

/** GET /api/discover/queue — return a batch of candidate profiles the user
 *  hasn't swiped on yet, ready to swipe through Tinder-style. */
router.get("/discover/queue", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  // Profiles this user has already swiped on (like, pass, or super_like)
  // should never be shown again.
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

  // Attach up to 2 audio prompts per candidate (optional bonus content —
  // shown immediately, no "blind" gating like the old model).
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
 *  back whether it created a mutual match. */
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

  // TODO (Phase 4): deduct Sparks here for `super_like` once the Sparks
  // economy is wired up, and reject with 402 if the balance is too low.

  const { error: insertError } = await supabase.from("swipes").insert({
    swiper_id: userId,
    target_id: targetId,
    direction,
  });

  if (insertError) {
    // Unique constraint violation = they already swiped on this profile.
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

  // The database trigger auto-creates a match row on mutual like. Check if
  // one now exists for this pair so we can tell the frontend to celebrate.
  const [lo, hi] = [userId, targetId].sort();
  const { data: match } = await supabase
    .from("matches")
    .select("id")
    .eq("user1_id", lo)
    .eq("user2_id", hi)
    .maybeSingle();

  res.json({ matched: !!match, matchId: match?.id ?? null });
});

export default router;