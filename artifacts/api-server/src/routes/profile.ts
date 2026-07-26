import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { supabase } from "../lib/supabase";
import { spendSparks } from "../lib/sparks-helper";

const router: IRouter = Router();

const BOOST_COST = 50;
const BOOST_DURATION_MS = 5 * 60 * 60 * 1000; // 5 hours
const BOOST_COOLDOWN_MS = 24 * 60 * 60 * 1000; // once per 24 hours

/** GET /api/profile/me */
router.get("/profile/me", requireAuth, async (req, res): Promise<void> => {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", req.user!.id)
    .single();
  if (error || !profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  res.json(profile);
});

/** PUT /api/profile/me */
router.put("/profile/me", requireAuth, async (req, res): Promise<void> => {
  const { name, age, bio, city, photo_url, personality_tags } = req.body as {
    name?: string;
    age?: number;
    bio?: string;
    city?: string;
    photo_url?: string;
    personality_tags?: string[];
  };
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (age !== undefined) updates.age = age;
  if (bio !== undefined) updates.bio = bio;
  if (city !== undefined) updates.city = city;
  if (photo_url !== undefined) updates.photo_url = photo_url;
  if (personality_tags !== undefined) updates.personality_tags = personality_tags;
  const { data: profile, error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", req.user!.id)
    .select("*")
    .single();
  if (error || !profile) {
    res.status(400).json({ error: error?.message ?? "Update failed" });
    return;
  }
  res.json(profile);
});

/** GET /api/profile/boost/status — is a boost currently active, and when
 *  can the user next activate one. */
router.get("/profile/boost/status", requireAuth, async (req, res): Promise<void> => {
  const { data: profile } = await supabase
    .from("profiles")
    .select("boosted_until, last_boost_at")
    .eq("id", req.user!.id)
    .single();

  const now = Date.now();
  const boostedUntil = profile?.boosted_until ? new Date(profile.boosted_until).getTime() : null;
  const isActive = boostedUntil !== null && boostedUntil > now;

  const lastBoostAt = profile?.last_boost_at ? new Date(profile.last_boost_at).getTime() : null;
  const nextEligibleAt = lastBoostAt !== null ? lastBoostAt + BOOST_COOLDOWN_MS : null;
  const canBoost = nextEligibleAt === null || nextEligibleAt <= now;

  res.json({
    is_active: isActive,
    boosted_until: isActive ? profile?.boosted_until : null,
    can_boost: canBoost,
    next_eligible_at: canBoost ? null : new Date(nextEligibleAt!).toISOString(),
  });
});

/** POST /api/profile/boost — 50 Sparks, 1 hour of priority placement in
 *  other users' Discover queues, once per 24 hours. */
router.post("/profile/boost", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const { data: profile } = await supabase
    .from("profiles")
    .select("last_boost_at")
    .eq("id", userId)
    .single();

  const lastBoostAt = profile?.last_boost_at ? new Date(profile.last_boost_at).getTime() : null;
  if (lastBoostAt !== null && Date.now() - lastBoostAt < BOOST_COOLDOWN_MS) {
    const nextEligibleAt = new Date(lastBoostAt + BOOST_COOLDOWN_MS).toISOString();
    res.status(429).json({ error: "You can only boost once every 24 hours", next_eligible_at: nextEligibleAt });
    return;
  }

  const spend = await spendSparks(userId, BOOST_COST, "Profile Boost");
  if (!spend.success) {
    res.status(402).json({ error: `Insufficient Sparks (need ${BOOST_COST})`, balance: spend.balance });
    return;
  }

  const now = new Date();
  const boostedUntil = new Date(now.getTime() + BOOST_DURATION_MS);

  await supabase
    .from("profiles")
    .update({ boosted_until: boostedUntil.toISOString(), last_boost_at: now.toISOString() })
    .eq("id", userId);

  res.json({ boosted_until: boostedUntil.toISOString(), balance: spend.balance });
});

/** GET /api/profile/:userId */
router.get("/profile/:userId", requireAuth, async (req, res): Promise<void> => {
  const userId = Array.isArray(req.params.userId)
    ? req.params.userId[0]
    : req.params.userId;
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  if (error || !profile) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(profile);
});

/** GET /api/prompts — get my audio prompts */
router.get("/prompts", requireAuth, async (req, res): Promise<void> => {
  const { data: prompts } = await supabase
    .from("audio_prompts")
    .select("*")
    .eq("user_id", req.user!.id)
    .order("created_at", { ascending: false });
  res.json(prompts ?? []);
});

/** POST /api/prompts — add audio prompt */
router.post("/prompts", requireAuth, async (req, res): Promise<void> => {
  const { prompt_question, audio_url, duration_seconds } = req.body as {
    prompt_question?: string;
    audio_url?: string;
    duration_seconds?: number;
  };
  if (!prompt_question || !audio_url) {
    res.status(400).json({ error: "prompt_question and audio_url are required" });
    return;
  }
  const { data: prompt, error } = await supabase
    .from("audio_prompts")
    .insert({
      user_id: req.user!.id,
      prompt_question,
      audio_url,
      duration_seconds,
    })
    .select("*")
    .single();
  if (error || !prompt) {
    res.status(400).json({ error: error?.message ?? "Failed to create prompt" });
    return;
  }
  res.status(201).json(prompt);
});

export default router;
