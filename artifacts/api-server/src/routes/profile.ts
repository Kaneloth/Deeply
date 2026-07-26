import { Router, type IRouter } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { requireAuth } from "../middlewares/auth";
import { supabase } from "../lib/supabase";
import { spendSparks } from "../lib/sparks-helper";

const router: IRouter = Router();

const BOOST_COST = 50;
const BOOST_DURATION_MS = 5 * 60 * 60 * 1000; // 5 hours
const BOOST_COOLDOWN_MS = 24 * 60 * 60 * 1000; // once per 24 hours

const MAX_PHOTOS = 6;
const MAX_PHOTO_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_SIZE },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(new Error("Only JPEG, PNG, and WEBP images are allowed"));
      return;
    }
    cb(null, true);
  },
});

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

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

/** GET /api/profile/me/photos — list own gallery, ordered */
router.get("/profile/me/photos", requireAuth, async (req, res): Promise<void> => {
  const { data: photos } = await supabase
    .from("profile_photos")
    .select("id, photo_url, position, created_at")
    .eq("user_id", req.user!.id)
    .order("position", { ascending: true });

  res.json(photos ?? []);
});

/** POST /api/profile/me/photos — upload a new gallery photo (multipart,
 *  field name "photo"). Keeps profiles.photo_url in sync as the first
 *  photo in the gallery, so every other page that reads that single
 *  field keeps working unchanged. */
router.post(
  "/profile/me/photos",
  requireAuth,
  (req, res, next) => {
    upload.single("photo")(req, res, (err) => {
      if (err) {
        res.status(400).json({ error: err.message ?? "Upload failed" });
        return;
      }
      next();
    });
  },
  async (req, res): Promise<void> => {
    const userId = req.user!.id;

    if (!req.file) {
      res.status(400).json({ error: "No photo file provided" });
      return;
    }

    const { count } = await supabase
      .from("profile_photos")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    if ((count ?? 0) >= MAX_PHOTOS) {
      res.status(400).json({ error: `Maximum ${MAX_PHOTOS} photos allowed` });
      return;
    }

    const ext = EXT_BY_MIME[req.file.mimetype] ?? "jpg";
    const storagePath = `${userId}/${randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("profile-photos")
      .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype });

    if (uploadError) {
      res.status(500).json({ error: "Failed to upload photo" });
      return;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("profile-photos").getPublicUrl(storagePath);

    const position = count ?? 0;

    const { data: photo, error: insertError } = await supabase
      .from("profile_photos")
      .insert({ user_id: userId, photo_url: publicUrl, storage_path: storagePath, position })
      .select("id, photo_url, position, created_at")
      .single();

    if (insertError || !photo) {
      res.status(500).json({ error: "Failed to save photo" });
      return;
    }

    // Keep the legacy single photo_url field pointed at the first photo.
    if (position === 0) {
      await supabase.from("profiles").update({ photo_url: publicUrl }).eq("id", userId);
    }

    res.status(201).json(photo);
  },
);

/** DELETE /api/profile/me/photos/:photoId */
router.delete("/profile/me/photos/:photoId", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const photoId = Array.isArray(req.params.photoId) ? req.params.photoId[0] : req.params.photoId;

  const { data: photo } = await supabase
    .from("profile_photos")
    .select("id, storage_path, position")
    .eq("id", photoId)
    .eq("user_id", userId)
    .single();

  if (!photo) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }

  if (photo.storage_path) {
    await supabase.storage.from("profile-photos").remove([photo.storage_path]);
  }

  await supabase.from("profile_photos").delete().eq("id", photoId);

  // Re-pack remaining positions to stay contiguous (0, 1, 2, ...).
  const { data: remaining } = await supabase
    .from("profile_photos")
    .select("id, photo_url, position")
    .eq("user_id", userId)
    .order("position", { ascending: true });

  for (let i = 0; i < (remaining?.length ?? 0); i++) {
    if (remaining![i].position !== i) {
      await supabase.from("profile_photos").update({ position: i }).eq("id", remaining![i].id);
    }
  }

  // If we deleted the first photo, keep profiles.photo_url in sync with
  // whatever is now first (or null if the gallery is empty).
  if (photo.position === 0) {
    const newFirstUrl = remaining && remaining.length > 0 ? remaining[0].photo_url : null;
    await supabase.from("profiles").update({ photo_url: newFirstUrl }).eq("id", userId);
  }

  res.sendStatus(204);
});

export default router;