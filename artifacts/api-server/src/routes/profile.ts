import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { supabase } from "../lib/supabase";

const router: IRouter = Router();

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
