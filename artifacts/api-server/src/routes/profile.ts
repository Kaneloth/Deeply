import { Router, type IRouter } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { requireAuth } from "../middlewares/auth";
import { supabase } from "../lib/supabase";
import { spendSparks } from "../lib/sparks-helper";
import { withComputedAge, withComputedAges } from "../lib/age";
import { isSuperAdmin, requireSuperAdmin, requireAdminScope, type AdminScope } from "../lib/admin-auth";

const router: IRouter = Router();

const BOOST_COST = 50;
const BOOST_DURATION_MS = 5 * 60 * 60 * 1000; // 5 hours
const BOOST_COOLDOWN_MS = 24 * 60 * 60 * 1000; // once per 24 hours

const MAX_FREE_PHOTOS = 8;
const MAX_GALLERY_ITEMS = 20; // hard safety ceiling regardless of Sparks spent
const EXTRA_PHOTO_COST = 10; // same as a message
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_VIDEO_SIZE = 6 * 1024 * 1024; // 6MB — ceiling, not a guarantee of 3MB
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
const ALLOWED_MIME_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VIDEO_SIZE },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(new Error("Only JPEG, PNG, WEBP images or MP4, WEBM, MOV video clips are allowed"));
      return;
    }
    cb(null, true);
  },
});

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
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
  res.json(withComputedAge(profile));
});

/** PUT /api/profile/me */
router.put("/profile/me", requireAuth, async (req, res): Promise<void> => {
  const {
    name, age, bio, city, photo_url, personality_tags,
    birthday, gender, looking_for_gender, distance_km,
    relationship_type, dating_intentions, onboarding_completed,
    num_kids, smoking_status, drinking_status, languages_spoken,
    languages_other, love_language, education, family_plans,
    notify_messages, notify_matches, notify_likes, notify_sparks,
    is_incognito,
  } = req.body as {
    name?: string;
    age?: number;
    bio?: string;
    city?: string;
    photo_url?: string;
    personality_tags?: string[];
    birthday?: string;
    gender?: string;
    looking_for_gender?: string;
    distance_km?: number;
    relationship_type?: string;
    dating_intentions?: string[];
    onboarding_completed?: boolean;
    num_kids?: string;
    smoking_status?: string;
    drinking_status?: string;
    languages_spoken?: string[];
    languages_other?: string;
    love_language?: string;
    education?: string;
    family_plans?: string;
    notify_messages?: boolean;
    notify_matches?: boolean;
    notify_likes?: boolean;
    notify_sparks?: boolean;
    is_incognito?: boolean;
  };
  if (birthday) {
    const dob = new Date(birthday);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const hasHadBirthdayThisYear =
      today.getMonth() > dob.getMonth() ||
      (today.getMonth() === dob.getMonth() && today.getDate() >= dob.getDate());
    if (!hasHadBirthdayThisYear) age -= 1;

    if (isNaN(dob.getTime()) || age < 18) {
      res.status(400).json({ error: "You must be at least 18 years old to use Deeply" });
      return;
    }
  }

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (age !== undefined) updates.age = age;
  if (bio !== undefined) updates.bio = bio;
  if (city !== undefined) updates.city = city;
  if (photo_url !== undefined) updates.photo_url = photo_url;
  if (personality_tags !== undefined) updates.personality_tags = personality_tags;
  // These columns have CHECK constraints (only specific values allowed)
  // or are DATE columns — an empty string from an unfilled/unselected
  // field is neither a valid enum value nor a valid date, and would make
  // Postgres reject the ENTIRE update. Treat "" as "not set" (null).
  if (birthday !== undefined) updates.birthday = birthday || null;
  if (gender !== undefined) updates.gender = gender || null;
  if (looking_for_gender !== undefined) updates.looking_for_gender = looking_for_gender || null;
  if (distance_km !== undefined) updates.distance_km = distance_km;
  if (relationship_type !== undefined) updates.relationship_type = relationship_type || null;
  if (dating_intentions !== undefined) updates.dating_intentions = dating_intentions;
  if (onboarding_completed !== undefined) updates.onboarding_completed = onboarding_completed;
  if (num_kids !== undefined) updates.num_kids = num_kids || null;
  if (smoking_status !== undefined) updates.smoking_status = smoking_status || null;
  if (drinking_status !== undefined) updates.drinking_status = drinking_status || null;
  if (languages_spoken !== undefined) updates.languages_spoken = languages_spoken;
  if (languages_other !== undefined) updates.languages_other = languages_other;
  if (love_language !== undefined) updates.love_language = love_language || null;
  if (education !== undefined) updates.education = education || null;
  if (family_plans !== undefined) updates.family_plans = family_plans || null;
  if (notify_messages !== undefined) updates.notify_messages = notify_messages;
  if (notify_matches !== undefined) updates.notify_matches = notify_matches;
  if (notify_likes !== undefined) updates.notify_likes = notify_likes;
  if (notify_sparks !== undefined) updates.notify_sparks = notify_sparks;
  if (is_incognito !== undefined) updates.is_incognito = is_incognito;
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
  res.json(withComputedAge(profile));
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
  res.json(withComputedAge(profile));
});

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB, ~30s of compressed audio
  fileFilter: (_req, file, cb) => {
    const allowed = ["audio/webm", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/wav"];
    if (!allowed.includes(file.mimetype)) {
      cb(new Error("Unsupported audio format"));
      return;
    }
    cb(null, true);
  },
});

const AUDIO_EXT_BY_MIME: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
};

/** POST /api/prompts/audio-upload — uploads a recorded audio clip to
 *  storage and returns its public URL, ready to pass into POST /prompts
 *  as `audio_url`. */
router.post(
  "/prompts/audio-upload",
  requireAuth,
  (req, res, next) => {
    audioUpload.single("audio")(req, res, (err) => {
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
      res.status(400).json({ error: "No audio file provided" });
      return;
    }

    const ext = AUDIO_EXT_BY_MIME[req.file.mimetype] ?? "webm";
    const storagePath = `${userId}/${randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("audio-prompts")
      .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype });

    if (uploadError) {
      res.status(500).json({ error: `Storage upload failed: ${uploadError.message}` });
      return;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("audio-prompts").getPublicUrl(storagePath);

    res.status(201).json({ audio_url: publicUrl });
  },
);

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

/** DELETE /api/prompts/:promptId — remove one of my audio prompts */
router.delete("/prompts/:promptId", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const promptId = Array.isArray(req.params.promptId) ? req.params.promptId[0] : req.params.promptId;

  const { data: prompt } = await supabase
    .from("audio_prompts")
    .select("id")
    .eq("id", promptId)
    .eq("user_id", userId)
    .single();

  if (!prompt) {
    res.status(404).json({ error: "Prompt not found" });
    return;
  }

  const { error } = await supabase.from("audio_prompts").delete().eq("id", promptId);

  if (error) {
    res.status(500).json({ error: `Failed to delete prompt: ${error.message}` });
    return;
  }

  res.sendStatus(204);
});

/** GET /api/profile/me/photos — list own gallery, ordered */
router.get("/profile/me/photos", requireAuth, async (req, res): Promise<void> => {
  const { data: photos } = await supabase
    .from("profile_photos")
    .select("id, photo_url, media_type, position, created_at")
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
      res.status(400).json({ error: "No photo or video file provided" });
      return;
    }

    const isVideo = req.file.mimetype.startsWith("video/");
    const sizeLimit = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
    if (req.file.size > sizeLimit) {
      res.status(400).json({
        error: isVideo ? "Video clips must be under 6MB (~5 seconds)" : "Photos must be under 5MB",
      });
      return;
    }

    if (isVideo) {
      const { count: videoCount } = await supabase
        .from("profile_photos")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("media_type", "video");

      if ((videoCount ?? 0) >= 1) {
        res.status(400).json({ error: "You can only have 1 video clip. Delete your existing clip to upload a new one." });
        return;
      }
    }

    const { count } = await supabase
      .from("profile_photos")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    const currentCount = count ?? 0;

    if (currentCount >= MAX_GALLERY_ITEMS) {
      res.status(400).json({ error: `Maximum ${MAX_GALLERY_ITEMS} gallery items reached` });
      return;
    }

    let sparksCharged = 0;
    let balanceAfter: number | null = null;

    if (currentCount >= MAX_FREE_PHOTOS) {
      const spend = await spendSparks(userId, EXTRA_PHOTO_COST, "Extra gallery photo");
      if (!spend.success) {
        res.status(402).json({
          error: `You've used your ${MAX_FREE_PHOTOS} free photos. Adding more costs ${EXTRA_PHOTO_COST} Sparks (insufficient balance).`,
          balance: spend.balance,
        });
        return;
      }
      sparksCharged = EXTRA_PHOTO_COST;
      balanceAfter = spend.balance;
    }

    const ext = EXT_BY_MIME[req.file.mimetype] ?? (isVideo ? "mp4" : "jpg");
    const storagePath = `${userId}/${randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("profile-photos")
      .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype });

    if (uploadError) {
      res.status(500).json({ error: `Storage upload failed: ${uploadError.message}` });
      return;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("profile-photos").getPublicUrl(storagePath);

    const position = currentCount;
    const mediaType = isVideo ? "video" : "image";

    const { data: photo, error: insertError } = await supabase
      .from("profile_photos")
      .insert({ user_id: userId, photo_url: publicUrl, storage_path: storagePath, position, media_type: mediaType })
      .select("id, photo_url, media_type, position, created_at")
      .single();

    if (insertError || !photo) {
      res.status(500).json({ error: "Failed to save photo" });
      return;
    }

    // Keep the legacy single photo_url field pointed at the first item,
    // but only if it's an image (avatars elsewhere in the app expect a
    // static image, not a video).
    if (position === 0 && !isVideo) {
      await supabase.from("profiles").update({ photo_url: publicUrl }).eq("id", userId);
    }

    res.status(201).json({ ...photo, sparks_charged: sparksCharged, balance: balanceAfter });
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
    const { error: removeError } = await supabase.storage.from("profile-photos").remove([photo.storage_path]);
    if (removeError) {
      res.status(500).json({ error: `Failed to delete file from storage: ${removeError.message}` });
      return;
    }
  }

  const { error: deleteError } = await supabase.from("profile_photos").delete().eq("id", photoId);
  if (deleteError) {
    res.status(500).json({ error: `Failed to delete photo record: ${deleteError.message}` });
    return;
  }

  // Re-pack remaining positions to stay contiguous (0, 1, 2, ...).
  const { data: remaining } = await supabase
    .from("profile_photos")
    .select("id, photo_url, media_type, position")
    .eq("user_id", userId)
    .order("position", { ascending: true });

  for (let i = 0; i < (remaining?.length ?? 0); i++) {
    if (remaining![i].position !== i) {
      await supabase.from("profile_photos").update({ position: i }).eq("id", remaining![i].id);
    }
  }

  // If we deleted the first photo, keep profiles.photo_url in sync with
  // the new first IMAGE in the gallery (never a video), or null if none.
  if (photo.position === 0) {
    const newFirstImage = remaining?.find((p) => p.media_type === "image");
    await supabase.from("profiles").update({ photo_url: newFirstImage?.photo_url ?? null }).eq("id", userId);
  }

  res.sendStatus(204);
});

// ============================================================
// Blocking & Reporting
// ============================================================

const ALLOWED_SCREENSHOT_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SCREENSHOT_SIZE = 10 * 1024 * 1024; // 10MB

const screenshotUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SCREENSHOT_SIZE },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_SCREENSHOT_MIME_TYPES.includes(file.mimetype)) {
      cb(new Error("Only JPEG, PNG, or WEBP screenshots are allowed"));
      return;
    }
    cb(null, true);
  },
});

const SCREENSHOT_EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** POST /api/blocks — block another user. Upserts so re-blocking someone
 *  (e.g. after a "Remove" that keeps the block in effect) is a no-op. */
router.post("/blocks", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { blockedUserId } = req.body as { blockedUserId?: string };

  if (!blockedUserId) {
    res.status(400).json({ error: "blockedUserId is required" });
    return;
  }
  if (blockedUserId === userId) {
    res.status(400).json({ error: "Cannot block yourself" });
    return;
  }

  const { error } = await supabase
    .from("blocks")
    .upsert(
      { blocker_id: userId, blocked_id: blockedUserId, is_hidden: false },
      { onConflict: "blocker_id,blocked_id" },
    );

  if (error) {
    res.status(500).json({ error: `Failed to block: ${error.message}` });
    return;
  }

  res.status(201).json({ success: true });
});

/** GET /api/blocks — list currently blocked users (excluding ones
 *  "Removed" from the list, which stay blocked but shouldn't clutter the
 *  manageable list anymore). */
router.get("/blocks", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const { data: blocks } = await supabase
    .from("blocks")
    .select("id, blocked_id, created_at")
    .eq("blocker_id", userId)
    .eq("is_hidden", false)
    .order("created_at", { ascending: false });

  if (!blocks || blocks.length === 0) {
    res.json([]);
    return;
  }

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, name, photo_url")
    .in("id", blocks.map((b) => b.blocked_id));

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  const result = blocks.map((b) => ({
    id: b.id,
    blocked_user: profileById.get(b.blocked_id) ?? null,
    created_at: b.created_at,
  }));

  res.json(result);
});

/** DELETE /api/blocks/:blockedUserId — Unblock. Fully lifts the block; the
 *  other person can appear in Discover/Search again. */
router.delete("/blocks/:blockedUserId", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const blockedUserId = Array.isArray(req.params.blockedUserId)
    ? req.params.blockedUserId[0]
    : req.params.blockedUserId;

  const { error } = await supabase
    .from("blocks")
    .delete()
    .eq("blocker_id", userId)
    .eq("blocked_id", blockedUserId);

  if (error) {
    res.status(500).json({ error: `Failed to unblock: ${error.message}` });
    return;
  }

  res.sendStatus(204);
});

/** POST /api/blocks/:blockedUserId/remove — Remove from the blocked list.
 *  The block itself stays in effect (they remain hidden from each other
 *  permanently) — this only hides the entry from the manageable list, for
 *  when someone doesn't want to keep seeing a serious block in their
 *  settings but also doesn't want to risk accidentally reversing it. */
router.post("/blocks/:blockedUserId/remove", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const blockedUserId = Array.isArray(req.params.blockedUserId)
    ? req.params.blockedUserId[0]
    : req.params.blockedUserId;

  const { error } = await supabase
    .from("blocks")
    .update({ is_hidden: true })
    .eq("blocker_id", userId)
    .eq("blocked_id", blockedUserId);

  if (error) {
    res.status(500).json({ error: `Failed to remove: ${error.message}` });
    return;
  }

  res.sendStatus(204);
});

/** POST /api/reports — file a report against another user, optionally
 *  with up to 5 screenshots as evidence. Does not itself block the
 *  reported user — the client should call POST /blocks separately if the
 *  reporter also wants to block them. */
router.post(
  "/reports",
  requireAuth,
  (req, res, next) => {
    screenshotUpload.array("screenshots", 5)(req, res, (err) => {
      if (err) {
        res.status(400).json({ error: err.message });
        return;
      }
      next();
    });
  },
  async (req, res): Promise<void> => {
    const userId = req.user!.id;
    const { reportedUserId, context, matchId, reason, details } = req.body as {
      reportedUserId?: string;
      context?: "chat" | "profile";
      matchId?: string;
      reason?: string;
      details?: string;
    };

    if (!reportedUserId || !context || !reason) {
      res.status(400).json({ error: "reportedUserId, context, and reason are required" });
      return;
    }
    if (!["chat", "profile"].includes(context)) {
      res.status(400).json({ error: "context must be 'chat' or 'profile'" });
      return;
    }
    if (reportedUserId === userId) {
      res.status(400).json({ error: "Cannot report yourself" });
      return;
    }

    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const screenshotUrls: string[] = [];
    for (const file of files) {
      const ext = SCREENSHOT_EXT_BY_MIME[file.mimetype] ?? "jpg";
      const storagePath = `${userId}/${randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("report-screenshots")
        .upload(storagePath, file.buffer, { contentType: file.mimetype });

      if (uploadError) {
        res.status(500).json({ error: `Screenshot upload failed: ${uploadError.message}` });
        return;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("report-screenshots").getPublicUrl(storagePath);
      screenshotUrls.push(publicUrl);
    }

    const { data: report, error } = await supabase
      .from("reports")
      .insert({
        reporter_id: userId,
        reported_id: reportedUserId,
        context,
        match_id: matchId ?? null,
        reason,
        details: details ?? null,
        screenshot_urls: screenshotUrls,
      })
      .select("id")
      .single();

    if (error || !report) {
      res.status(500).json({ error: "Failed to submit report" });
      return;
    }

    res.status(201).json({ id: report.id, success: true });
  },
);

// ============================================================
// Admin — foundation (status check + grant/revoke). Reports/users/
// Sparks management endpoints come once the dashboard UI is designed.
// ============================================================

/** GET /api/admin/me — tells the frontend whether the current user has
 *  any admin access, and which scopes, so it knows whether to show admin
 *  navigation at all and which sections to reveal. */
router.get("/admin/me", requireAuth, async (req, res): Promise<void> => {
  if (isSuperAdmin(req.user!.email)) {
    res.json({ isAdmin: true, isSuperAdmin: true, scopes: ["manage_reports", "manage_users", "manage_sparks", "view_analytics"] });
    return;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, admin_scopes")
    .eq("id", req.user!.id)
    .single();

  res.json({
    isAdmin: !!profile?.is_admin,
    isSuperAdmin: false,
    scopes: profile?.admin_scopes ?? [],
  });
});

/** POST /api/admin/grant — super-admin only. Grants (or replaces) the set
 *  of scopes for a user, identified by email. Passing an empty scopes
 *  array effectively revokes admin access (is_admin becomes false). */
router.post("/admin/grant", requireAuth, requireSuperAdmin, async (req, res): Promise<void> => {
  const granterId = req.user!.id;
  const { email, scopes } = req.body as { email?: string; scopes?: AdminScope[] };

  if (!email) {
    res.status(400).json({ error: "email is required" });
    return;
  }

  const validScopes: AdminScope[] = ["manage_reports", "manage_users", "manage_sparks", "view_analytics"];
  const requestedScopes = (scopes ?? []).filter((s): s is AdminScope => validScopes.includes(s as AdminScope));

  const { data: authUser, error: lookupError } = await supabase.auth.admin.listUsers();
  if (lookupError) {
    res.status(500).json({ error: "Could not look up user" });
    return;
  }
  const targetUser = authUser.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!targetUser) {
    res.status(404).json({ error: "No account found with that email" });
    return;
  }
  if (isSuperAdmin(targetUser.email)) {
    res.status(400).json({ error: "The super-admin's access can't be modified" });
    return;
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ is_admin: requestedScopes.length > 0, admin_scopes: requestedScopes })
    .eq("id", targetUser.id);

  if (updateError) {
    res.status(500).json({ error: `Failed to update admin access: ${updateError.message}` });
    return;
  }

  if (requestedScopes.length > 0) {
    await supabase.from("admin_grants").insert({
      granted_to: targetUser.id,
      granted_by: granterId,
      scopes: requestedScopes,
    });
  }

  res.json({ success: true, isAdmin: requestedScopes.length > 0, scopes: requestedScopes });
});

// ============================================================
// Admin Dashboard — Overview, Reports, Users, Sparks, Announcements.
// Announcements is gated under manage_users, since it wasn't one of the
// four originally-named scopes and broadcasting to users is closely
// related to user management.
// ============================================================

const MODERATION_REASONS_NOTE = "reason is required";

/** GET /api/admin/overview */
router.get("/admin/overview", requireAuth, requireAdminScope("view_analytics"), async (req, res): Promise<void> => {
  const [
    { count: totalUsers },
    { count: bannedUsers },
    { count: suspendedUsers },
    { count: pendingReports },
    { count: totalMatches },
    { count: totalMessages },
    { data: sparksRows },
  ] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("banned", true),
    supabase.from("profiles").select("id", { count: "exact", head: true }).gt("suspended_until", new Date().toISOString()),
    supabase.from("reports").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("matches").select("id", { count: "exact", head: true }),
    supabase.from("messages").select("id", { count: "exact", head: true }),
    supabase.from("sparks_transactions").select("amount, type").limit(5000),
  ]);

  const purchased = (sparksRows ?? [])
    .filter((r) => r.type === "purchase" || r.type === "monthly_grant")
    .reduce((sum, r) => sum + Math.max(0, r.amount ?? 0), 0);
  const consumed = (sparksRows ?? [])
    .filter((r) => (r.amount ?? 0) < 0)
    .reduce((sum, r) => sum + Math.abs(r.amount ?? 0), 0);

  res.json({
    totalUsers: totalUsers ?? 0,
    bannedUsers: bannedUsers ?? 0,
    suspendedUsers: suspendedUsers ?? 0,
    pendingReports: pendingReports ?? 0,
    totalMatches: totalMatches ?? 0,
    totalMessages: totalMessages ?? 0,
    sparksGranted: purchased,
    sparksConsumed: consumed,
  });
});

/** GET /api/admin/reports — pending reports with reporter/reported info */
router.get("/admin/reports", requireAuth, requireAdminScope("manage_reports"), async (req, res): Promise<void> => {
  const { data: rows } = await supabase
    .from("reports")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  const userIds = [...new Set((rows ?? []).flatMap((r) => [r.reporter_id, r.reported_id]))];
  const { data: profiles } = userIds.length
    ? await supabase.from("profiles").select("id, name, photo_url").in("id", userIds)
    : { data: [] };
  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  const merged = (rows ?? []).map((r) => ({
    ...r,
    reporter: profileMap.get(r.reporter_id) ?? null,
    reported: profileMap.get(r.reported_id) ?? null,
  }));

  res.json(merged);
});

/** POST /api/admin/reports/:reportId/resolve */
router.post("/admin/reports/:reportId/resolve", requireAuth, requireAdminScope("manage_reports"), async (req, res): Promise<void> => {
  const reportId = Array.isArray(req.params.reportId) ? req.params.reportId[0] : req.params.reportId;
  const { notes } = req.body as { notes?: string };
  const { error } = await supabase
    .from("reports")
    .update({ status: "actioned", admin_notes: notes ?? null })
    .eq("id", reportId);
  if (error) {
    res.status(500).json({ error: "Failed to resolve report" });
    return;
  }
  res.sendStatus(204);
});

/** POST /api/admin/reports/:reportId/dismiss */
router.post("/admin/reports/:reportId/dismiss", requireAuth, requireAdminScope("manage_reports"), async (req, res): Promise<void> => {
  const reportId = Array.isArray(req.params.reportId) ? req.params.reportId[0] : req.params.reportId;
  const { notes } = req.body as { notes?: string };
  const { error } = await supabase
    .from("reports")
    .update({ status: "dismissed", admin_notes: notes ?? null })
    .eq("id", reportId);
  if (error) {
    res.status(500).json({ error: "Failed to dismiss report" });
    return;
  }
  res.sendStatus(204);
});

/** GET /api/admin/users — search + paginate */
router.get("/admin/users", requireAuth, requireAdminScope("manage_users"), async (req, res): Promise<void> => {
  const { search, filter, page = "1" } = req.query as { search?: string; filter?: string; page?: string };
  const PAGE_SIZE = 25;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);

  let query = supabase
    .from("profiles")
    .select(
      "id, name, age, birthday, city, photo_url, is_admin, admin_scopes, banned, ban_reason, suspended_until, suspension_reason, is_verified, free_sparks_balance, paid_sparks_balance, created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false });

  if (search?.trim()) {
    query = query.ilike("name", `%${search.trim()}%`);
  }
  if (filter === "banned") query = query.eq("banned", true);
  else if (filter === "suspended") query = query.gt("suspended_until", new Date().toISOString());
  else if (filter === "verified") query = query.eq("is_verified", true);
  else if (filter === "admins") query = query.eq("is_admin", true);

  const from = (pageNum - 1) * PAGE_SIZE;
  const { data, count, error } = await query.range(from, from + PAGE_SIZE - 1);

  if (error) {
    res.status(500).json({ error: `Failed to load users: ${error.message}` });
    return;
  }

  res.json({ users: withComputedAges(data ?? []), total: count ?? 0, page: pageNum, pageSize: PAGE_SIZE });
});

/** POST /api/admin/users/:userId/ban */
router.post("/admin/users/:userId/ban", requireAuth, requireAdminScope("manage_users"), async (req, res): Promise<void> => {
  const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  const { reason } = req.body as { reason?: string };
  if (!reason) {
    res.status(400).json({ error: MODERATION_REASONS_NOTE });
    return;
  }
  await supabase.from("profiles").update({ banned: true, ban_reason: reason }).eq("id", userId);
  res.sendStatus(204);
});

/** POST /api/admin/users/:userId/unban */
router.post("/admin/users/:userId/unban", requireAuth, requireAdminScope("manage_users"), async (req, res): Promise<void> => {
  const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  await supabase.from("profiles").update({ banned: false, ban_reason: null }).eq("id", userId);
  res.sendStatus(204);
});

/** POST /api/admin/users/:userId/suspend */
router.post("/admin/users/:userId/suspend", requireAuth, requireAdminScope("manage_users"), async (req, res): Promise<void> => {
  const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  const { days, reason } = req.body as { days?: number; reason?: string };
  if (!reason || !days || days < 1) {
    res.status(400).json({ error: "days and reason are required" });
    return;
  }
  const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  await supabase.from("profiles").update({ suspended_until: until, suspension_reason: reason }).eq("id", userId);
  res.json({ suspended_until: until });
});

/** POST /api/admin/users/:userId/unsuspend */
router.post("/admin/users/:userId/unsuspend", requireAuth, requireAdminScope("manage_users"), async (req, res): Promise<void> => {
  const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  await supabase.from("profiles").update({ suspended_until: null, suspension_reason: null }).eq("id", userId);
  res.sendStatus(204);
});

/** POST /api/admin/users/:userId/sparks — adjust balance (positive or
 *  negative). Applied directly to free_sparks_balance and logged as an
 *  admin_adjustment transaction, clamped so balance can't go negative. */
router.post("/admin/users/:userId/sparks", requireAuth, requireAdminScope("manage_sparks"), async (req, res): Promise<void> => {
  const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  const { amount, description } = req.body as { amount?: number; description?: string };
  if (!amount || amount === 0) {
    res.status(400).json({ error: "A non-zero amount is required" });
    return;
  }

  const { data: profile } = await supabase.from("profiles").select("free_sparks_balance").eq("id", userId).single();
  if (!profile) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const newBalance = Math.max(0, (profile.free_sparks_balance ?? 0) + amount);
  await supabase.from("profiles").update({ free_sparks_balance: newBalance }).eq("id", userId);
  await supabase.from("sparks_transactions").insert({
    user_id: userId,
    amount,
    type: "admin_adjustment",
    description: description || (amount > 0 ? "Admin credit" : "Admin deduction"),
  });

  res.json({ balance: newBalance });
});

/** GET /api/admin/sparks/transactions — recent ledger, optionally filtered
 *  by user. */
router.get("/admin/sparks/transactions", requireAuth, requireAdminScope("manage_sparks"), async (req, res): Promise<void> => {
  const { userId } = req.query as { userId?: string };
  let query = supabase.from("sparks_transactions").select("*").order("created_at", { ascending: false }).limit(200);
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query;
  if (error) {
    res.status(500).json({ error: `Failed to load transactions: ${error.message}` });
    return;
  }
  res.json(data ?? []);
});

/** GET /api/admin/announcements — full list for admin management */
router.get("/admin/announcements", requireAuth, requireAdminScope("manage_users"), async (req, res): Promise<void> => {
  const { data } = await supabase.from("announcements").select("*").order("created_at", { ascending: false });
  res.json(data ?? []);
});

/** POST /api/admin/announcements */
router.post("/admin/announcements", requireAuth, requireAdminScope("manage_users"), async (req, res): Promise<void> => {
  const adminId = req.user!.id;
  const { title, body, severity, targetType, recipientIds } = req.body as {
    title?: string;
    body?: string;
    severity?: "info" | "warning" | "success";
    targetType?: "all" | "specific";
    recipientIds?: string[];
  };

  if (!title?.trim() || !body?.trim()) {
    res.status(400).json({ error: "title and body are required" });
    return;
  }
  if (targetType === "specific" && (!recipientIds || recipientIds.length === 0)) {
    res.status(400).json({ error: "Pick at least one recipient, or target all users" });
    return;
  }

  const { data: announcement, error } = await supabase
    .from("announcements")
    .insert({
      title: title.trim(),
      body: body.trim(),
      severity: severity ?? "info",
      target_type: targetType ?? "all",
      created_by: adminId,
    })
    .select("id")
    .single();

  if (error || !announcement) {
    res.status(500).json({ error: "Failed to create announcement" });
    return;
  }

  if (targetType === "specific" && recipientIds) {
    await supabase
      .from("announcement_recipients")
      .insert(recipientIds.map((userId) => ({ announcement_id: announcement.id, user_id: userId })));
  }

  res.status(201).json({ id: announcement.id });
});

/** PUT /api/admin/announcements/:id — toggle active */
router.put("/admin/announcements/:announcementId", requireAuth, requireAdminScope("manage_users"), async (req, res): Promise<void> => {
  const announcementId = Array.isArray(req.params.announcementId) ? req.params.announcementId[0] : req.params.announcementId;
  const { isActive } = req.body as { isActive?: boolean };
  await supabase.from("announcements").update({ is_active: !!isActive }).eq("id", announcementId);
  res.sendStatus(204);
});

/** DELETE /api/admin/announcements/:id */
router.delete("/admin/announcements/:announcementId", requireAuth, requireAdminScope("manage_users"), async (req, res): Promise<void> => {
  const announcementId = Array.isArray(req.params.announcementId) ? req.params.announcementId[0] : req.params.announcementId;
  await supabase.from("announcements").delete().eq("id", announcementId);
  res.sendStatus(204);
});

// ============================================================
// Announcements — regular-user-facing endpoints
// ============================================================

/** GET /api/announcements — active announcements targeted at me that I
 *  haven't dismissed yet. */
router.get("/announcements", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const { data: dismissed } = await supabase
    .from("announcement_dismissals")
    .select("announcement_id")
    .eq("user_id", userId);
  const dismissedIds = new Set((dismissed ?? []).map((d) => d.announcement_id));

  const { data: targeted } = await supabase
    .from("announcement_recipients")
    .select("announcement_id")
    .eq("user_id", userId);
  const targetedIds = new Set((targeted ?? []).map((t) => t.announcement_id));

  const { data: active } = await supabase.from("announcements").select("*").eq("is_active", true);

  const visible = (active ?? []).filter((a) => {
    if (dismissedIds.has(a.id)) return false;
    if (a.target_type === "specific") return targetedIds.has(a.id);
    return true;
  });

  res.json(visible);
});

/** POST /api/announcements/:id/dismiss */
router.post("/announcements/:announcementId/dismiss", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const announcementId = Array.isArray(req.params.announcementId) ? req.params.announcementId[0] : req.params.announcementId;
  await supabase.from("announcement_dismissals").upsert(
    { announcement_id: announcementId, user_id: userId },
    { onConflict: "announcement_id,user_id" },
  );
  res.sendStatus(204);
});

export default router;