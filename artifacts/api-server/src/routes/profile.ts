import { Router, type IRouter } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { requireAuth } from "../middlewares/auth";
import { supabase } from "../lib/supabase";
import { spendSparks } from "../lib/sparks-helper";
import { withComputedAge, withComputedAges } from "../lib/age";
import { isSuperAdmin, requireSuperAdmin, requireAdminScope, type AdminScope } from "../lib/admin-auth";
import { createNotification, createNotificationForUsers, recordProfileView, scheduleProfileViewNotificationClear } from "../lib/notifications-helper";
import { attachPhotoGalleries } from "../lib/photo-galleries";
import { attachAudioPrompts } from "../lib/audio-prompts-helper";
import { checkImageSafety } from "../lib/content-moderation";
import { getEconomyConfig, invalidateEconomyConfigCache } from "../lib/economy-config";
import { verifyAndConsumeGooglePurchase } from "../lib/google-play-helper";
import { buildPayfastCheckout } from "../lib/payfast-helper";

const router: IRouter = Router();

const BOOST_DURATION_MS = 5 * 60 * 60 * 1000; // 5 hours
const BOOST_COOLDOWN_MS = 24 * 60 * 60 * 1000; // once per 24 hours

const MAX_FREE_PHOTOS = 8;
const MAX_GALLERY_ITEMS = 20; // hard safety ceiling regardless of Sparks spent
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
    notify_sparks, notify_profile_views,
    is_incognito,
    has_tattoos, vaping_status, pets, height_cm, activity_level, nightlife_frequency,
    latitude, longitude,
    pref_num_kids, pref_family_plans, pref_smoking_status, pref_drinking_status,
    pref_vaping_status, pref_has_tattoos, pref_pets, pref_activity_level,
    pref_height_min_cm, pref_height_max_cm, pref_nightlife_frequency, dealbreakers,
    pref_age_min, pref_age_max,
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
    notify_sparks?: boolean;
    notify_profile_views?: boolean;
    is_incognito?: boolean;
    has_tattoos?: string;
    vaping_status?: string;
    pets?: string;
    height_cm?: number;
    activity_level?: string;
    nightlife_frequency?: string;
    latitude?: number;
    longitude?: number;
    pref_num_kids?: string;
    pref_family_plans?: string;
    pref_smoking_status?: string;
    pref_drinking_status?: string;
    pref_vaping_status?: string;
    pref_has_tattoos?: string;
    pref_pets?: string;
    pref_activity_level?: string;
    pref_height_min_cm?: number;
    pref_height_max_cm?: number;
    pref_nightlife_frequency?: string;
    dealbreakers?: string[];
    pref_age_min?: number;
    pref_age_max?: number;
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
  if (has_tattoos !== undefined) updates.has_tattoos = has_tattoos || null;
  if (vaping_status !== undefined) updates.vaping_status = vaping_status || null;
  if (pets !== undefined) updates.pets = pets || null;
  if (height_cm !== undefined) updates.height_cm = height_cm;
  if (activity_level !== undefined) updates.activity_level = activity_level || null;
  if (nightlife_frequency !== undefined) updates.nightlife_frequency = nightlife_frequency || null;
  if (latitude !== undefined) updates.latitude = latitude;
  if (longitude !== undefined) updates.longitude = longitude;
  if (pref_num_kids !== undefined) updates.pref_num_kids = pref_num_kids || null;
  if (pref_family_plans !== undefined) updates.pref_family_plans = pref_family_plans || null;
  if (pref_smoking_status !== undefined) updates.pref_smoking_status = pref_smoking_status || null;
  if (pref_drinking_status !== undefined) updates.pref_drinking_status = pref_drinking_status || null;
  if (pref_vaping_status !== undefined) updates.pref_vaping_status = pref_vaping_status || null;
  if (pref_has_tattoos !== undefined) updates.pref_has_tattoos = pref_has_tattoos || null;
  if (pref_pets !== undefined) updates.pref_pets = pref_pets || null;
  if (pref_activity_level !== undefined) updates.pref_activity_level = pref_activity_level || null;
  if (pref_height_min_cm !== undefined) updates.pref_height_min_cm = pref_height_min_cm;
  if (pref_height_max_cm !== undefined) updates.pref_height_max_cm = pref_height_max_cm;
  if (pref_nightlife_frequency !== undefined) updates.pref_nightlife_frequency = pref_nightlife_frequency || null;
  if (pref_age_min !== undefined || pref_age_max !== undefined) {
    const min = pref_age_min ?? 18;
    const max = pref_age_max ?? 99;
    if (min < 18 || max < min) {
      res.status(400).json({ error: "Invalid age range — minimum must be 18 or older, and maximum can't be below minimum." });
      return;
    }
    if (pref_age_min !== undefined) updates.pref_age_min = min;
    if (pref_age_max !== undefined) updates.pref_age_max = max;
  }
  if (dealbreakers !== undefined) {
    if (dealbreakers.length > 0) {
      const { data: setting } = await supabase.from("app_settings").select("value").eq("key", "dealbreakers_enabled").single();
      if (setting?.value !== true) {
        res.status(403).json({ error: "Dealbreakers are not currently available." });
        return;
      }
    }
    updates.dealbreakers = dealbreakers;
  }
  if (notify_sparks !== undefined) updates.notify_sparks = notify_sparks;
  if (notify_profile_views !== undefined) updates.notify_profile_views = notify_profile_views;
  if (is_incognito !== undefined) {
    if (is_incognito) {
      const { data: setting } = await supabase.from("app_settings").select("value").eq("key", "incognito_enabled").single();
      if (setting?.value !== true) {
        res.status(403).json({ error: "Incognito mode is not currently available." });
        return;
      }

      // cost_incognito_per_day had a label and an admin-editable value
      // (used in the frontend's "What uses Sparks?" list) but was never
      // actually charged anywhere — turning Incognito on has always
      // been free, silently, since this route was written. Charge only
      // on the real off→on transition (same "before vs after" check as
      // the Founders-program block below) — an idempotent "still true"
      // update, e.g. re-saving the same preferences form, must never
      // double-charge for a day already paid for.
      const { data: currentProfile } = await supabase
        .from("profiles")
        .select("is_incognito")
        .eq("id", req.user!.id)
        .single();

      if (!currentProfile?.is_incognito) {
        const { cost_incognito_per_day } = await getEconomyConfig();
        const spend = await spendSparks(req.user!.id, cost_incognito_per_day, "Incognito Mode (1 day)");
        if (!spend.success) {
          res.status(402).json({ error: `Insufficient Sparks (need ${cost_incognito_per_day})`, balance: spend.balance });
          return;
        }
      }
    }
    updates.is_incognito = is_incognito;
  }
  // Founders program: award the badge + free verification at the exact
  // moment onboarding_completed transitions from not-true to true — not
  // just because this request happened to include that field (a
  // resubmission of an already-completed profile must never re-claim a
  // slot). The claim itself is a single atomic UPDATE server-side (see
  // claim_founder_slot), so two users finishing onboarding within the
  // same instant can't both claim the same slot — the 112 cutoff is
  // exact, not a race.
  if (onboarding_completed === true) {
    const { data: currentProfile } = await supabase
      .from("profiles")
      .select("onboarding_completed")
      .eq("id", req.user!.id)
      .single();

    if (currentProfile && !currentProfile.onboarding_completed) {
      const { data: rank, error: founderClaimError } = await supabase.rpc("claim_founder_slot", { cap: 112 });
      if (founderClaimError) {
        // Previously silently swallowed — this destructured only
        // `data`, so a failing RPC call (e.g. a permissions/RLS issue)
        // was indistinguishable from "all 112 slots are genuinely
        // taken": both just left `rank` null and skipped awarding
        // anything, with zero visibility into which one actually
        // happened. Logging this doesn't fix the underlying cause on
        // its own, but means a real failure now shows up instead of
        // silently looking like the founders program just ran out.
        console.error(
          `FOUNDER CLAIM DEBUG: claim_founder_slot RPC failed for userId=${req.user!.id}: ${founderClaimError.message}`,
        );
      }
      if (typeof rank === "number") {
        updates.is_founder = true;
        updates.founder_rank = rank;
        updates.free_verification = true;
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No profile changes supplied" });
    return;
  }

  // Keep the write separate from the read-back. Chaining `.select().single()`
  // onto UPDATE makes PostgREST coerce the UPDATE representation into exactly
  // one JSON object. In production that representation can occasionally be
  // empty even though the UPDATE itself succeeded, producing the misleading
  // "Cannot coerce the result to a single JSON object" 400. This was
  // especially easy to reproduce from the profile/preferences pages because
  // they submit the full form snapshot even when only one field changed.
  const { error: updateError } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", req.user!.id);

  if (updateError) {
    console.error("PUT /profile/me UPDATE FAILED:", JSON.stringify(updateError, null, 2));
    console.error("PUT /profile/me FAILED — updates object was:", JSON.stringify(updates, null, 2));
    console.error("PUT /profile/me FAILED — user id was:", req.user!.id);
    res.status(400).json({ error: updateError.message ?? "Update failed" });
    return;
  }

  // Retries the read-back specifically for the same Supabase read-after-
  // write consistency lag traced repeatedly elsewhere in this app: the
  // UPDATE above can succeed while THIS separate, subsequent read
  // transiently doesn't see it yet. Without this retry, that lag meant
  // the endpoint returned a 500 to the client even when the update
  // (including, critically, the founders-program fields set above)
  // genuinely succeeded — the client would see an error and never learn
  // it actually worked. Since claim_founder_slot is a one-time atomic
  // claim, a user hitting this on their onboarding-completion request
  // would have a permanently correct is_founder=true in the database
  // with no way to ever see confirmation of it, even on retry (the
  // founders check only fires on the false->true transition, which
  // their retry would no longer see).
  let profile: Record<string, unknown> | null = null;
  let readBackError: { message?: string } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await supabase.from("profiles").select("*").eq("id", req.user!.id).maybeSingle();
    if (result.data) {
      profile = result.data;
      readBackError = null;
      break;
    }
    readBackError = result.error;
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  if (readBackError || !profile) {
    console.error("PUT /profile/me READ-BACK FAILED:", JSON.stringify(readBackError, null, 2));
    console.error("PUT /profile/me — user id was:", req.user!.id);
    res.status(500).json({ error: "Profile was updated, but could not be read back." });
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

  const { cost_boost } = await getEconomyConfig();
  const spend = await spendSparks(userId, cost_boost, "Profile Boost");
  if (!spend.success) {
    res.status(402).json({ error: `Insufficient Sparks (need ${cost_boost})`, balance: spend.balance });
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
    // audio/aac (and, on some Android versions, audio/3gpp) added for
    // capacitor-voice-recorder's native recordings — the web recorder
    // produces audio/webm, but the native path records via Android's own
    // MediaRecorder, which doesn't produce webm at all. Without these,
    // every native voice-prompt upload was rejected right here with
    // "Unsupported audio format", regardless of what filename/extension
    // the client sent.
    const allowed = ["audio/webm", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/wav", "audio/aac", "audio/3gpp"];
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
  "audio/aac": "aac",
  "audio/3gpp": "3gp",
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

    // Content moderation — images only (see doc comment in
    // content-moderation.ts for why video isn't covered here).
    if (!isVideo) {
      const safety = await checkImageSafety(req.file.buffer);
      if (!safety.safe) {
        res.status(400).json({ error: safety.reason ?? "This photo can't be uploaded." });
        return;
      }
    }

    let sparksCharged = 0;
    let balanceAfter: number | null = null;

    if (currentCount >= MAX_FREE_PHOTOS) {
      const { cost_extra_photo } = await getEconomyConfig();
      const spend = await spendSparks(userId, cost_extra_photo, "Extra gallery photo");
      if (!spend.success) {
        res.status(402).json({
          error: `You've used your ${MAX_FREE_PHOTOS} free photos. Adding more costs ${cost_extra_photo} Sparks (insufficient balance).`,
          balance: spend.balance,
        });
        return;
      }
      sparksCharged = cost_extra_photo;
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
      res.status(500).json({ error: `Failed to save photo: ${insertError?.message ?? "unknown error"}` });
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

/** PUT /api/profile/me/photos/:photoId/set-main — reorders the gallery
 *  so the chosen photo becomes position 0, and keeps profiles.photo_url
 *  (used everywhere else in the app — Discover cards, headers) in sync
 *  with whatever's actually first. Videos can't be set as main, same
 *  restriction the existing position-0 sync logic already enforces
 *  elsewhere in this file. */
router.put("/profile/me/photos/:photoId/set-main", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const photoId = Array.isArray(req.params.photoId) ? req.params.photoId[0] : req.params.photoId;

  const { data: target } = await supabase
    .from("profile_photos")
    .select("id, photo_url, media_type, position")
    .eq("id", photoId)
    .eq("user_id", userId)
    .single();

  if (!target) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }
  if (target.media_type !== "image") {
    res.status(400).json({ error: "Video clips can't be set as your main photo" });
    return;
  }
  if (target.position === 0) {
    res.json({ success: true }); // already main — nothing to do
    return;
  }

  const { data: all } = await supabase
    .from("profile_photos")
    .select("id, position")
    .eq("user_id", userId)
    .order("position", { ascending: true });

  if (!all) {
    res.status(500).json({ error: "Failed to load gallery" });
    return;
  }

  // Move the chosen photo to the front, keep everyone else's relative
  // order unchanged, then re-assign contiguous positions 0..n-1 — same
  // re-packing approach the DELETE handler above already uses.
  const reordered = [target, ...all.filter((p) => p.id !== photoId)];
  for (let i = 0; i < reordered.length; i++) {
    if (reordered[i].position !== i) {
      await supabase.from("profile_photos").update({ position: i }).eq("id", reordered[i].id);
    }
  }

  await supabase.from("profiles").update({ photo_url: target.photo_url }).eq("id", userId);

  res.json({ success: true });
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

/** GET /api/app-settings — platform-wide feature flags any authenticated
 *  user can read, so the frontend knows what to show (e.g. whether
 *  Incognito is currently enabled at all). */
router.get("/app-settings", requireAuth, async (req, res): Promise<void> => {
  const { data } = await supabase.from("app_settings").select("key, value");
  const settings = Object.fromEntries((data ?? []).map((row) => [row.key, row.value]));
  res.json(settings);
});

/** PUT /api/admin/settings — update a platform-wide feature flag.
 *  Gated under manage_users, since there's no dedicated "platform
 *  settings" scope yet and this is closest in spirit to user-facing
 *  feature control. */
router.put("/admin/settings", requireAuth, requireAdminScope("manage_users"), async (req, res): Promise<void> => {
  const { key, value } = req.body as { key?: string; value?: unknown };
  if (!key || value === undefined) {
    res.status(400).json({ error: "key and value are required" });
    return;
  }

  const { error } = await supabase
    .from("app_settings")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });

  if (error) {
    res.status(500).json({ error: `Failed to update setting: ${error.message}` });
    return;
  }

  res.json({ key, value });
});

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

/** Extracts the storage path from a Supabase public URL, e.g.
 *  "https://xxx.supabase.co/storage/v1/object/public/report-screenshots/abc/123.jpg"
 *  -> "abc/123.jpg" */
function extractStoragePath(publicUrl: string, bucket: string): string | null {
  const marker = `/${bucket}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return null;
  return publicUrl.slice(idx + marker.length);
}

/** Deletes a report's screenshot files from storage. Best-effort — a
 *  storage cleanup failure shouldn't block the resolve/dismiss action
 *  itself, since the report status change is what actually matters. */
async function cleanupReportScreenshots(urls: string[] | null | undefined): Promise<void> {
  if (!urls || urls.length === 0) return;
  const paths = urls
    .map((url) => extractStoragePath(url, "report-screenshots"))
    .filter((p): p is string => !!p);
  if (paths.length === 0) return;
  try {
    await supabase.storage.from("report-screenshots").remove(paths);
  } catch {
    // Non-fatal — see doc comment above.
  }
}

/** POST /api/admin/reports/:reportId/resolve */
router.post("/admin/reports/:reportId/resolve", requireAuth, requireAdminScope("manage_reports"), async (req, res): Promise<void> => {
  const reportId = Array.isArray(req.params.reportId) ? req.params.reportId[0] : req.params.reportId;
  const { notes } = req.body as { notes?: string };
  const { data: updated, error } = await supabase
    .from("reports")
    .update({ status: "actioned", admin_notes: notes ?? null })
    .eq("id", reportId)
    .select("screenshot_urls")
    .single();
  if (error) {
    res.status(500).json({ error: `Failed to resolve report: ${error.message}` });
    return;
  }
  await cleanupReportScreenshots(updated?.screenshot_urls);
  res.sendStatus(204);
});

/** POST /api/admin/reports/:reportId/dismiss */
router.post("/admin/reports/:reportId/dismiss", requireAuth, requireAdminScope("manage_reports"), async (req, res): Promise<void> => {
  const reportId = Array.isArray(req.params.reportId) ? req.params.reportId[0] : req.params.reportId;
  const { notes } = req.body as { notes?: string };
  const { data: updated, error } = await supabase
    .from("reports")
    .update({ status: "dismissed", admin_notes: notes ?? null })
    .eq("id", reportId)
    .select("screenshot_urls")
    .single();
  if (error) {
    res.status(500).json({ error: `Failed to dismiss report: ${error.message}` });
    return;
  }
  await cleanupReportScreenshots(updated?.screenshot_urls);
  res.sendStatus(204);
});

/** GET /api/admin/users — search + paginate */
router.get("/admin/users", requireAuth, requireAdminScope("manage_users"), async (req, res): Promise<void> => {
  const adminUserId = req.user!.id;
  const { search, filter, page = "1" } = req.query as { search?: string; filter?: string; page?: string };
  const PAGE_SIZE = 25;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);

  let query = supabase
    .from("profiles")
    .select(
      "id, name, age, birthday, city, photo_url, is_admin, admin_scopes, banned, ban_reason, suspended_until, suspension_reason, is_verified, free_sparks_balance, paid_sparks_balance, created_at",
      { count: "exact" },
    )
    // Never show the requesting admin their own account here — avoids
    // the risk of an admin accidentally banning/suspending themselves,
    // which (given bans/suspensions now take effect immediately) could
    // lock them out of their own account.
    .neq("id", adminUserId)
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
  if (userId === req.user!.id) {
    res.status(400).json({ error: "You can't ban your own account" });
    return;
  }
  const { reason } = req.body as { reason?: string };
  if (!reason) {
    res.status(400).json({ error: MODERATION_REASONS_NOTE });
    return;
  }
  const { error } = await supabase.from("profiles").update({ banned: true, ban_reason: reason }).eq("id", userId);
  if (error) {
    res.status(500).json({ error: `Failed to ban user: ${error.message}` });
    return;
  }
  res.sendStatus(204);
});

/** PUT /api/admin/users/:userId/profile — lets an admin edit a user's
 *  profile on their behalf (e.g. when the user reports being unable to
 *  save changes themselves). Deliberately kept as its own self-contained
 *  handler rather than sharing code with PUT /profile/me — that endpoint
 *  already has the founders-program side effect interleaved into it,
 *  which must never fire from an admin edit, and keeping these fully
 *  separate avoids any risk of that logic leaking across concerns. */
router.put("/admin/users/:userId/profile", requireAuth, requireAdminScope("manage_users"), async (req, res): Promise<void> => {
  const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;

  const {
    name, bio, city, personality_tags,
    birthday, gender, looking_for_gender, distance_km,
    relationship_type, dating_intentions,
    num_kids, smoking_status, drinking_status, languages_spoken,
    languages_other, love_language, education, family_plans,
    has_tattoos, vaping_status, pets, height_cm, activity_level, nightlife_frequency,
    pref_num_kids, pref_family_plans, pref_smoking_status, pref_drinking_status,
    pref_vaping_status, pref_has_tattoos, pref_pets, pref_activity_level,
    pref_height_min_cm, pref_height_max_cm, pref_nightlife_frequency, dealbreakers,
    pref_age_min, pref_age_max,
  } = req.body as {
    name?: string;
    bio?: string;
    city?: string;
    personality_tags?: string[];
    birthday?: string;
    gender?: string;
    looking_for_gender?: string;
    distance_km?: number;
    relationship_type?: string;
    dating_intentions?: string[];
    num_kids?: string;
    smoking_status?: string;
    drinking_status?: string;
    languages_spoken?: string[];
    languages_other?: string;
    love_language?: string;
    education?: string;
    family_plans?: string;
    has_tattoos?: string;
    vaping_status?: string;
    pets?: string;
    height_cm?: number;
    activity_level?: string;
    nightlife_frequency?: string;
    pref_num_kids?: string;
    pref_family_plans?: string;
    pref_smoking_status?: string;
    pref_drinking_status?: string;
    pref_vaping_status?: string;
    pref_has_tattoos?: string;
    pref_pets?: string;
    pref_activity_level?: string;
    pref_height_min_cm?: number;
    pref_height_max_cm?: number;
    pref_nightlife_frequency?: string;
    dealbreakers?: string[];
    pref_age_min?: number;
    pref_age_max?: number;
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
      res.status(400).json({ error: "This user must be at least 18 years old" });
      return;
    }
  }

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (bio !== undefined) updates.bio = bio;
  if (city !== undefined) updates.city = city;
  if (personality_tags !== undefined) updates.personality_tags = personality_tags;
  if (birthday !== undefined) updates.birthday = birthday || null;
  if (gender !== undefined) updates.gender = gender || null;
  if (looking_for_gender !== undefined) updates.looking_for_gender = looking_for_gender || null;
  if (distance_km !== undefined) updates.distance_km = distance_km;
  if (relationship_type !== undefined) updates.relationship_type = relationship_type || null;
  if (dating_intentions !== undefined) updates.dating_intentions = dating_intentions;
  if (num_kids !== undefined) updates.num_kids = num_kids || null;
  if (smoking_status !== undefined) updates.smoking_status = smoking_status || null;
  if (drinking_status !== undefined) updates.drinking_status = drinking_status || null;
  if (languages_spoken !== undefined) updates.languages_spoken = languages_spoken;
  if (languages_other !== undefined) updates.languages_other = languages_other;
  if (love_language !== undefined) updates.love_language = love_language || null;
  if (education !== undefined) updates.education = education || null;
  if (family_plans !== undefined) updates.family_plans = family_plans || null;
  if (has_tattoos !== undefined) updates.has_tattoos = has_tattoos || null;
  if (vaping_status !== undefined) updates.vaping_status = vaping_status || null;
  if (pets !== undefined) updates.pets = pets || null;
  if (height_cm !== undefined) updates.height_cm = height_cm;
  if (activity_level !== undefined) updates.activity_level = activity_level || null;
  if (nightlife_frequency !== undefined) updates.nightlife_frequency = nightlife_frequency || null;
  if (pref_num_kids !== undefined) updates.pref_num_kids = pref_num_kids || null;
  if (pref_family_plans !== undefined) updates.pref_family_plans = pref_family_plans || null;
  if (pref_smoking_status !== undefined) updates.pref_smoking_status = pref_smoking_status || null;
  if (pref_drinking_status !== undefined) updates.pref_drinking_status = pref_drinking_status || null;
  if (pref_vaping_status !== undefined) updates.pref_vaping_status = pref_vaping_status || null;
  if (pref_has_tattoos !== undefined) updates.pref_has_tattoos = pref_has_tattoos || null;
  if (pref_pets !== undefined) updates.pref_pets = pref_pets || null;
  if (pref_activity_level !== undefined) updates.pref_activity_level = pref_activity_level || null;
  if (pref_height_min_cm !== undefined) updates.pref_height_min_cm = pref_height_min_cm;
  if (pref_height_max_cm !== undefined) updates.pref_height_max_cm = pref_height_max_cm;
  if (pref_nightlife_frequency !== undefined) updates.pref_nightlife_frequency = pref_nightlife_frequency || null;
  if (pref_age_min !== undefined || pref_age_max !== undefined) {
    const min = pref_age_min ?? 18;
    const max = pref_age_max ?? 99;
    if (min < 18 || max < min) {
      res.status(400).json({ error: "Invalid age range — minimum must be 18 or older, and maximum can't be below minimum." });
      return;
    }
    if (pref_age_min !== undefined) updates.pref_age_min = min;
    if (pref_age_max !== undefined) updates.pref_age_max = max;
  }
  if (dealbreakers !== undefined) {
    if (dealbreakers.length > 0) {
      const { data: setting } = await supabase.from("app_settings").select("value").eq("key", "dealbreakers_enabled").single();
      if (setting?.value !== true) {
        res.status(403).json({ error: "Dealbreakers are not currently available." });
        return;
      }
    }
    updates.dealbreakers = dealbreakers;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", userId)
    .select("*")
    .single();
  if (error || !profile) {
    console.error("PUT /admin/users/:userId/profile FAILED:", error, "updates:", updates, "userId:", userId);
    res.status(400).json({ error: error?.message ?? "Update failed" });
    return;
  }
  res.json(withComputedAge(profile));
});


router.post("/admin/users/:userId/unban", requireAuth, requireAdminScope("manage_users"), async (req, res): Promise<void> => {
  const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  const { error } = await supabase.from("profiles").update({ banned: false, ban_reason: null }).eq("id", userId);
  if (error) {
    res.status(500).json({ error: `Failed to unban user: ${error.message}` });
    return;
  }
  res.sendStatus(204);
});

/** POST /api/admin/users/:userId/suspend */
router.post("/admin/users/:userId/suspend", requireAuth, requireAdminScope("manage_users"), async (req, res): Promise<void> => {
  const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  if (userId === req.user!.id) {
    res.status(400).json({ error: "You can't suspend your own account" });
    return;
  }
  const { days, reason } = req.body as { days?: number; reason?: string };
  if (!reason || !days || days < 1) {
    res.status(400).json({ error: "days and reason are required" });
    return;
  }
  const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from("profiles")
    .update({ suspended_until: until, suspension_reason: reason })
    .eq("id", userId);
  if (error) {
    res.status(500).json({ error: `Failed to suspend user: ${error.message}` });
    return;
  }
  res.json({ suspended_until: until });
});

/** POST /api/admin/users/:userId/unsuspend */
router.post("/admin/users/:userId/unsuspend", requireAuth, requireAdminScope("manage_users"), async (req, res): Promise<void> => {
  const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  const { error } = await supabase
    .from("profiles")
    .update({ suspended_until: null, suspension_reason: null })
    .eq("id", userId);
  if (error) {
    res.status(500).json({ error: `Failed to lift suspension: ${error.message}` });
    return;
  }
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
  const { error: updateError } = await supabase
    .from("profiles")
    .update({ free_sparks_balance: newBalance })
    .eq("id", userId);
  if (updateError) {
    res.status(500).json({ error: `Failed to update balance: ${updateError.message}` });
    return;
  }

  const { error: insertError } = await supabase.from("sparks_transactions").insert({
    user_id: userId,
    amount,
    type: "admin_adjustment",
    description: description || (amount > 0 ? "Admin credit" : "Admin deduction"),
  });
  if (insertError) {
    // The balance update already succeeded — don't fail the whole request
    // over the ledger entry, but do surface it so it's not silently lost.
    res.json({ balance: newBalance, warning: `Balance updated but not logged to ledger: ${insertError.message}` });
    return;
  }

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

  // Fan out into the notifications feed too, not just the dismissible
  // banner — best-effort, doesn't block the announcement itself.
  if (targetType === "specific" && recipientIds) {
    createNotificationForUsers(recipientIds, "announcement", title.trim(), body.trim(), {
      announcement_id: announcement.id,
    }).catch(() => {});
  } else {
    const { data: allUsers } = await supabase.from("profiles").select("id");
    if (allUsers) {
      createNotificationForUsers(
        allUsers.map((u) => u.id),
        "announcement",
        title.trim(),
        body.trim(),
        { announcement_id: announcement.id },
      ).catch(() => {});
    }
  }

  res.status(201).json({ id: announcement.id });
});

/** PUT /api/admin/announcements/:id — toggle active */
router.put("/admin/announcements/:announcementId", requireAuth, requireAdminScope("manage_users"), async (req, res): Promise<void> => {
  const announcementId = Array.isArray(req.params.announcementId) ? req.params.announcementId[0] : req.params.announcementId;
  const { isActive } = req.body as { isActive?: boolean };
  const { error } = await supabase.from("announcements").update({ is_active: !!isActive }).eq("id", announcementId);
  if (error) {
    res.status(500).json({ error: `Failed to update announcement: ${error.message}` });
    return;
  }
  res.sendStatus(204);
});

/** DELETE /api/admin/announcements/:id */
router.delete("/admin/announcements/:announcementId", requireAuth, requireAdminScope("manage_users"), async (req, res): Promise<void> => {
  const announcementId = Array.isArray(req.params.announcementId) ? req.params.announcementId[0] : req.params.announcementId;
  const { error } = await supabase.from("announcements").delete().eq("id", announcementId);
  if (error) {
    res.status(500).json({ error: `Failed to delete announcement: ${error.message}` });
    return;
  }
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

// ============================================================
// Notifications & Profile Views
// ============================================================

/** GET /api/notifications — cursor-paginated, newest first, 10 per page
 *  by default. Pass ?before=<ISO timestamp from the last item's
 *  created_at> to fetch the next page. Cursor-based rather than
 *  offset-based deliberately — with a live, frequently-changing feed,
 *  offset pagination can skip or duplicate items if something new
 *  arrives between page loads; a cursor on created_at doesn't have that
 *  problem. Excludes any notification whose clear_at has passed (used
 *  by profile_views notifications, which auto-clear 24h after being
 *  revealed).
 *
 *  Also lazily deletes anything older than 90 days for this user —
 *  piggybacked on the FIRST page's request only (not every "load more"
 *  tap), same pattern as checkAndApplyMonthlyGrant in sparks-helper.ts:
 *  triggered by normal usage rather than a separate cron job, so it
 *  only ever does work for users who are actually active, and keeps
 *  this table from growing without bound per user. */
router.get("/notifications", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const nowIso = new Date().toISOString();
  const { before, limit: limitParam } = req.query as { before?: string; limit?: string };

  // Never trust a client-supplied limit blindly — bound it defensively.
  const limit = Math.min(Math.max(Number(limitParam) || 10, 1), 50);

  if (!before) {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from("notifications").delete().eq("user_id", userId).lt("created_at", ninetyDaysAgo);
  }

  let query = supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .or(`clear_at.is.null,clear_at.gt.${nowIso}`)
    .order("created_at", { ascending: false })
    .limit(limit + 1); // one extra, to detect hasMore without a second query

  if (before) {
    query = query.lt("created_at", before);
  }

  const { data, error } = await query;

  if (error) {
    res.status(500).json({ error: `Failed to load notifications: ${error.message}` });
    return;
  }

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  res.json({
    notifications: page,
    hasMore,
    nextCursor: hasMore ? page[page.length - 1].created_at : null,
  });
});

/** GET /api/notifications/unread-count */
router.get("/notifications/unread-count", requireAuth, async (req, res): Promise<void> => {
  const nowIso = new Date().toISOString();
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", req.user!.id)
    .eq("is_read", false)
    .or(`clear_at.is.null,clear_at.gt.${nowIso}`);

  if (error) {
    res.status(500).json({ error: `Failed to load unread count: ${error.message}` });
    return;
  }

  res.json({ count: count ?? 0 });
});

/** POST /api/notifications/:id/read */
router.post("/notifications/:notificationId/read", requireAuth, async (req, res): Promise<void> => {
  const notificationId = Array.isArray(req.params.notificationId) ? req.params.notificationId[0] : req.params.notificationId;
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("id", notificationId)
    .eq("user_id", req.user!.id);

  if (error) {
    res.status(500).json({ error: `Failed to mark notification read: ${error.message}` });
    return;
  }

  res.sendStatus(204);
});

/** POST /api/notifications/read-all */
router.post("/notifications/read-all", requireAuth, async (req, res): Promise<void> => {
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", req.user!.id)
    .eq("is_read", false);

  if (error) {
    res.status(500).json({ error: `Failed to mark notifications read: ${error.message}` });
    return;
  }

  res.sendStatus(204);
});

/** POST /api/profile-views — record that the caller opened someone's
 *  detailed profile view. */
router.post("/profile-views", requireAuth, async (req, res): Promise<void> => {
  const { viewedId } = req.body as { viewedId?: string };
  if (!viewedId) {
    res.status(400).json({ error: "viewedId is required" });
    return;
  }

  try {
    await recordProfileView(req.user!.id, viewedId);
  } catch {
    // Non-fatal — view tracking failing shouldn't break the profile view
    // itself for the person looking.
  }

  res.sendStatus(204);
});

/** GET /api/profile-views/who-viewed-me — FREE. Returns:
 *  - revealed: viewers this user has already paid to reveal (permanent
 *    — never re-hidden once revealed, even when new unrevealed viewers
 *    show up)
 *  - new_count: how many additional distinct viewers haven't been
 *    revealed yet (still requires a paid reveal), matching the
 *    /discover/invites pattern. */
router.get("/profile-views/who-viewed-me", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  // Reciprocal visibility: if this user has profile-view visibility
  // turned off, they don't get to see who viewed them either — same
  // trade-off as turning off story-view sharing on TikTok/Instagram.
  const { data: self } = await supabase
    .from("profiles")
    .select("notify_profile_views")
    .eq("id", userId)
    .single();

  if (self?.notify_profile_views === false) {
    res.json({ revealed: [], new_count: 0, visibility_off: true });
    return;
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: views, error } = await supabase
    .from("profile_views")
    .select("viewer_id, created_at")
    .eq("viewed_id", userId)
    .gt("created_at", sevenDaysAgo)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    res.status(500).json({ error: `Failed to load viewers: ${error.message}` });
    return;
  }

  // Dedupe to one entry per viewer, keeping their most recent view time
  // (views are already ordered newest-first, so the first occurrence
  // of each viewer_id is the most recent).
  const seen = new Set<string>();
  const latestViews: { viewer_id: string; created_at: string }[] = [];
  for (const v of views ?? []) {
    if (seen.has(v.viewer_id)) continue;
    seen.add(v.viewer_id);
    latestViews.push(v);
  }

  if (latestViews.length === 0) {
    res.json({ revealed: [], new_count: 0 });
    return;
  }

  // Reciprocal filter: a viewer who currently has their own visibility
  // off doesn't show up in anyone else's list, regardless of when they
  // viewed.
  const { data: viewerProfiles } = await supabase
    .from("profiles")
    .select("id, notify_profile_views")
    .in("id", latestViews.map((v) => v.viewer_id));
  const visibleViewerIds = new Set(
    (viewerProfiles ?? []).filter((p) => p.notify_profile_views !== false).map((p) => p.id),
  );
  const visibleViews = latestViews.filter((v) => visibleViewerIds.has(v.viewer_id));

  if (visibleViews.length === 0) {
    res.json({ revealed: [], new_count: 0 });
    return;
  }

  const { data: alreadyRevealed } = await supabase
    .from("profile_view_reveals")
    .select("viewer_id")
    .eq("user_id", userId);

  const revealedIds = new Set((alreadyRevealed ?? []).map((r) => r.viewer_id));
  const revealedViews = visibleViews.filter((v) => revealedIds.has(v.viewer_id));
  const newCount = visibleViews.length - revealedViews.length;

  if (revealedViews.length === 0) {
    res.json({ revealed: [], new_count: newCount });
    return;
  }

  const viewerIds = revealedViews.map((v) => v.viewer_id);
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, name, age, birthday, city, photo_url, personality_tags, is_verified, photo_verified, is_founder")
    .in("id", viewerIds);

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
  const merged = withComputedAges(
    revealedViews
      .map((v) => {
        const profile = profileMap.get(v.viewer_id);
        return profile ? { ...profile, viewed_at: v.created_at } : null;
      })
      .filter((p): p is NonNullable<typeof p> => p !== null),
  );

  const withPhotos = await attachPhotoGalleries(merged);
  const withAudio = await attachAudioPrompts(withPhotos);

  res.json({ revealed: withAudio, new_count: newCount });
});

/** POST /api/profile-views/reveal — PAID (admin-configurable Sparks),
 *  but ONLY if there's at least one genuinely new unrevealed viewer
 *  since the last reveal. Already-revealed viewers never cost Sparks
 *  again. Also schedules the profile_views notification to auto-clear
 *  from the bell 24 hours from now, per the reveal. Returns the full
 *  updated list of everyone revealed (previously + newly). */
router.post("/profile-views/reveal", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  // Reciprocal visibility: if this user has profile-view visibility
  // turned off, there's nothing to reveal (and nothing to charge for).
  const { data: self } = await supabase
    .from("profiles")
    .select("notify_profile_views")
    .eq("id", userId)
    .single();

  if (self?.notify_profile_views === false) {
    res.json({ revealed: [], balance: null });
    return;
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: views } = await supabase
    .from("profile_views")
    .select("viewer_id")
    .eq("viewed_id", userId)
    .gt("created_at", sevenDaysAgo)
    .limit(200);

  const rawViewerIds = [...new Set((views ?? []).map((v) => v.viewer_id))];

  if (rawViewerIds.length === 0) {
    res.json({ revealed: [], balance: null });
    return;
  }

  // Reciprocal filter — same as who-viewed-me: a viewer who currently
  // has their own visibility off is excluded, so they can't be paid-reveal
  // targets either.
  const { data: viewerProfiles } = await supabase
    .from("profiles")
    .select("id, notify_profile_views")
    .in("id", rawViewerIds);
  const distinctViewerIds = (viewerProfiles ?? [])
    .filter((p) => p.notify_profile_views !== false)
    .map((p) => p.id);

  if (distinctViewerIds.length === 0) {
    res.json({ revealed: [], balance: null });
    return;
  }

  const { data: alreadyRevealed } = await supabase
    .from("profile_view_reveals")
    .select("viewer_id")
    .eq("user_id", userId);

  const revealedIds = new Set((alreadyRevealed ?? []).map((r) => r.viewer_id));
  const hasNew = distinctViewerIds.some((id) => !revealedIds.has(id));

  let balance: number | null = null;

  if (hasNew) {
    const { cost_reveal_profile_views } = await getEconomyConfig();
    const spend = await spendSparks(userId, cost_reveal_profile_views, "Reveal who viewed your profile");
    if (!spend.success) {
      res.status(402).json({ error: `Insufficient Sparks (need ${cost_reveal_profile_views})`, balance: spend.balance });
      return;
    }
    balance = spend.balance;

    const rows = distinctViewerIds.map((viewerId) => ({ user_id: userId, viewer_id: viewerId }));
    await supabase.from("profile_view_reveals").upsert(rows, { onConflict: "user_id,viewer_id" });

    await scheduleProfileViewNotificationClear(userId);
  }

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, name, age, birthday, city, photo_url, personality_tags, is_verified, photo_verified, is_founder")
    .in("id", distinctViewerIds);

  const { data: freshViews } = await supabase
    .from("profile_views")
    .select("viewer_id, created_at")
    .eq("viewed_id", userId)
    .in("viewer_id", distinctViewerIds)
    .gt("created_at", sevenDaysAgo)
    .order("created_at", { ascending: false });

  const latestByViewer = new Map<string, string>();
  for (const v of freshViews ?? []) {
    if (!latestByViewer.has(v.viewer_id)) latestByViewer.set(v.viewer_id, v.created_at);
  }

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
  const merged = withComputedAges(
    distinctViewerIds
      .map((id) => {
        const profile = profileMap.get(id);
        const viewedAt = latestByViewer.get(id);
        return profile && viewedAt ? { ...profile, viewed_at: viewedAt } : null;
      })
      .filter((p): p is NonNullable<typeof p> => p !== null),
  );

  const withPhotos = await attachPhotoGalleries(merged);
  const withAudio = await attachAudioPrompts(withPhotos);

  res.json({ revealed: withAudio, balance });
});

// ============================================================
// Identity Verification — free "Photo Verified" (selfie vs existing
// gallery photos) and paid "ID Verified" (R99, ID front/back + selfie).
// Admin reviews both manually; approval/rejection are the terminal
// states, and either one triggers storage cleanup since the documents
// don't need to be retained once reviewed.
// ============================================================

const VERIFICATION_BUCKET = "identity-documents";

const verificationUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      cb(new Error("Only JPEG, PNG, or WEBP images are allowed"));
      return;
    }
    cb(null, true);
  },
});

async function uploadVerificationFile(userId: string, file: Express.Multer.File): Promise<string> {
  const ext = file.mimetype.split("/")[1] || "jpg";
  const path = `${userId}/${randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(VERIFICATION_BUCKET).upload(path, file.buffer, { contentType: file.mimetype });
  if (error) throw error;
  return path;
}

/** POST /api/verification/photo — free tier. Selfie only, compared by an
 *  admin against the user's existing gallery photos. */
router.post("/verification/photo", requireAuth, verificationUpload.single("selfie"), async (req, res): Promise<void> => {
  const userId = req.user!.id;

  if (!req.file) {
    res.status(400).json({ error: "A selfie is required" });
    return;
  }

  const { data: existingPending } = await supabase
    .from("identity_verification_submissions")
    .select("id")
    .eq("user_id", userId)
    .eq("verification_type", "photo")
    .eq("status", "pending")
    .maybeSingle();
  if (existingPending) {
    res.status(400).json({ error: "You already have a photo verification pending review" });
    return;
  }

  let selfiePath: string;
  try {
    selfiePath = await uploadVerificationFile(userId, req.file);
  } catch (err) {
    res.status(500).json({ error: `Failed to upload selfie: ${err instanceof Error ? err.message : "unknown error"}` });
    return;
  }

  const { error: insertError } = await supabase.from("identity_verification_submissions").insert({
    user_id: userId,
    verification_type: "photo",
    selfie_path: selfiePath,
    status: "pending",
  });

  if (insertError) {
    // Technical failure after upload — clean up the now-orphaned file.
    await supabase.storage.from(VERIFICATION_BUCKET).remove([selfiePath]).catch(() => {});
    res.status(500).json({ error: `Failed to submit: ${insertError.message}` });
    return;
  }

  res.status(201).json({ success: true });
});

/** POST /api/verification/id/request-refund — user-initiated only, never
 *  automatic. Marks the payment as 'refund_requested' so it can no
 *  longer be used to submit (the user has said they want their money
 *  back, not to keep trying), but does NOT itself move real money —
 *  there's no payment gateway wired in yet, so this just flags it for
 *  manual processing, the same as Skootlink's refund_requests pattern. */
router.post("/verification/id/request-refund", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const { data: payment } = await supabase
    .from("identity_verification_payments")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "paid")
    .maybeSingle();

  if (!payment) {
    res.status(400).json({ error: "No active payment found to refund" });
    return;
  }

  const { error } = await supabase
    .from("identity_verification_payments")
    .update({ status: "refund_requested" })
    .eq("id", payment.id);

  if (error) {
    res.status(500).json({ error: `Failed to submit refund request: ${error.message}` });
    return;
  }

  res.json({ success: true });
});

const ID_VERIFICATION_GOOGLE_PRODUCT_ID = "id_verification_fee";

/** GET /api/verification/id/payment-status — also reports whether this
 *  user is eligible for a founders free verification grant they haven't
 *  claimed yet, so the frontend can show "Claim Free Verification"
 *  instead of a price. */
router.get("/verification/id/payment-status", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const { data: payment } = await supabase
    .from("identity_verification_payments")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "paid")
    .maybeSingle();

  const { data: profile } = await supabase
    .from("profiles")
    .select("free_verification")
    .eq("id", userId)
    .single();

  res.json({
    hasPaid: !!payment,
    isFounderEligible: !!profile?.free_verification && !payment,
  });
});

/** POST /api/verification/id/claim-free — founders-only. Never trusts
 *  the client's claim of eligibility; re-checks profiles.free_verification
 *  server-side, since that flag is set exclusively by the atomic founders
 *  claim in PUT /profile/me, never by anything client-controlled. */
router.post("/verification/id/claim-free", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const { data: profile } = await supabase
    .from("profiles")
    .select("free_verification")
    .eq("id", userId)
    .single();

  if (!profile?.free_verification) {
    res.status(403).json({ error: "You're not eligible for free verification" });
    return;
  }

  const { data: existing } = await supabase
    .from("identity_verification_payments")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "paid")
    .maybeSingle();
  if (existing) {
    res.json({ success: true, alreadyPaid: true });
    return;
  }

  const { error } = await supabase.from("identity_verification_payments").insert({
    user_id: userId,
    amount: 0,
    status: "paid",
    is_founder_grant: true,
  });
  if (error) {
    res.status(500).json({ error: `Failed to claim free verification: ${error.message}` });
    return;
  }

  res.status(201).json({ success: true });
});

/** POST /api/verification/id/pay/google — verifies a completed Google
 *  Play purchase for the ID verification fee before marking payment as
 *  'paid'. Mirrors /api/sparks/purchase/google exactly — reuses the same
 *  verification helper, which was already written generically. */
router.post("/verification/id/pay/google", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { purchase_token } = req.body as { purchase_token?: string };

  if (!purchase_token) {
    res.status(400).json({ error: "purchase_token is required" });
    return;
  }

  const { data: existing } = await supabase
    .from("identity_verification_payments")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "paid")
    .maybeSingle();
  if (existing) {
    res.json({ success: true, alreadyPaid: true });
    return;
  }

  try {
    await verifyAndConsumeGooglePurchase(ID_VERIFICATION_GOOGLE_PRODUCT_ID, purchase_token);
  } catch (err) {
    console.error("Google Play verification-fee purchase failed:", err);
    res.status(402).json({ error: "Could not verify this purchase with Google Play. Please try again or contact support." });
    return;
  }

  const { id_verification_fee_zar } = await getEconomyConfig();
  const { error } = await supabase.from("identity_verification_payments").insert({
    user_id: userId,
    amount: id_verification_fee_zar,
    status: "paid",
  });
  if (error) {
    res.status(500).json({ error: `Failed to record payment: ${error.message}` });
    return;
  }

  res.status(201).json({ success: true });
});

/** POST /api/verification/id/checkout/payfast — starts a PayFast
 *  checkout for the ID verification fee. Web only — see
 *  VerificationSection's platform check. Reuses the SAME
 *  payfast_transactions table and the SAME ITN webhook endpoint already
 *  configured in Hookdeck/PayFast for Sparks (no need to reconfigure
 *  anything there) — the ITN handler in sparks.ts fulfills based on
 *  purchase_type, so this only ever creates the pending row and hands
 *  back signed checkout fields; payment is marked 'paid' only once that
 *  shared ITN handler confirms it. */
router.post("/verification/id/checkout/payfast", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const { data: existing } = await supabase
    .from("identity_verification_payments")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "paid")
    .maybeSingle();
  if (existing) {
    res.status(400).json({ error: "You've already paid for ID verification" });
    return;
  }

  const { data: userData } = await supabase.auth.admin.getUserById(userId);
  const email = userData.user?.email;
  const name = (userData.user?.user_metadata as { name?: string } | null)?.name;

  const { id_verification_fee_zar } = await getEconomyConfig();

  const { data: txn, error: insertError } = await supabase
    .from("payfast_transactions")
    .insert({
      user_id: userId,
      purchase_type: "id_verification",
      amount_zar: id_verification_fee_zar,
    })
    .select("m_payment_id")
    .single();

  if (insertError || !txn) {
    console.error("Failed to create PayFast verification transaction:", insertError);
    res.status(500).json({ error: "Failed to start checkout. Please try again." });
    return;
  }

  const baseUrl = process.env.APP_BASE_URL ?? "https://app.deeplydating.co.za";

  try {
    const checkout = buildPayfastCheckout({
      m_payment_id: txn.m_payment_id,
      amount: id_verification_fee_zar.toFixed(2),
      item_name: "ID Verification",
      custom_str1: userId,
      name_first: name,
      email_address: email,
      return_url: `${baseUrl}/verification/payfast/return?m_payment_id=${txn.m_payment_id}`,
      cancel_url: `${baseUrl}/verification/payfast/cancel`,
      notify_url: process.env.PAYFAST_NOTIFY_URL ?? `${baseUrl}/api/sparks/payfast/itn`,
    });
    res.json(checkout);
  } catch (err) {
    console.error("Failed to build PayFast verification checkout:", err);
    res.status(500).json({ error: "Payment processing is temporarily unavailable." });
  }
});

/** GET /api/verification/id/payfast/status/:mPaymentId — mirrors
 *  /api/sparks/payfast/status/:mPaymentId, for the verification-specific
 *  return-landing page to poll. */
router.get("/verification/id/payfast/status/:mPaymentId", requireAuth, async (req, res): Promise<void> => {
  const { mPaymentId } = req.params;

  const { data: txn } = await supabase
    .from("payfast_transactions")
    .select("status, user_id, purchase_type")
    .eq("m_payment_id", mPaymentId)
    .single();

  if (!txn || txn.user_id !== req.user!.id || txn.purchase_type !== "id_verification") {
    res.status(404).json({ error: "Transaction not found" });
    return;
  }

  res.json({ status: txn.status });
});

/** POST /api/verification/id — paid tier. Requires an existing unused
 *  'paid' payment record. ID front, back, and selfie all required. Any
 *  technical failure during upload/submission reverses the payment
 *  (status -> 'refunded') so the user isn't out R99 for a submission
 *  that never reached the review queue — this is distinct from an admin
 *  rejection, which deliberately leaves the payment intact so the user
 *  can resubmit for free. */
router.post(
  "/verification/id",
  requireAuth,
  verificationUpload.fields([
    { name: "id_front", maxCount: 1 },
    { name: "id_back", maxCount: 1 },
    { name: "selfie", maxCount: 1 },
  ]),
  async (req, res): Promise<void> => {
    const userId = req.user!.id;
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const idFront = files?.id_front?.[0];
    const idBack = files?.id_back?.[0];
    const selfie = files?.selfie?.[0];

    if (!idFront || !idBack || !selfie) {
      res.status(400).json({ error: "ID front, ID back, and a selfie are all required" });
      return;
    }

    const { data: payment } = await supabase
      .from("identity_verification_payments")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "paid")
      .maybeSingle();
    if (!payment) {
      res.status(402).json({ error: "Payment required before submitting ID verification" });
      return;
    }

    const { data: existingPending } = await supabase
      .from("identity_verification_submissions")
      .select("id")
      .eq("user_id", userId)
      .eq("verification_type", "id")
      .eq("status", "pending")
      .maybeSingle();
    if (existingPending) {
      res.status(400).json({ error: "You already have an ID verification pending review" });
      return;
    }

    let frontPath: string, backPath: string, selfiePath: string;
    try {
      [frontPath, backPath, selfiePath] = await Promise.all([
        uploadVerificationFile(userId, idFront),
        uploadVerificationFile(userId, idBack),
        uploadVerificationFile(userId, selfie),
      ]);
    } catch (err) {
      // Technical failure before reaching the review queue — the payment
      // deliberately stays 'paid' here rather than being auto-refunded.
      // Auto-refunding would force the user to pay again just to retry,
      // which punishes them for a failure on our end. Instead they get a
      // real choice: retry (their payment still works), or explicitly
      // request a refund via /verification/id/request-refund if they'd
      // rather not continue.
      res.status(500).json({
        error: `Failed to upload documents (${err instanceof Error ? err.message : "unknown error"}). Your payment is still valid — you can try again, or request a refund.`,
        code: "UPLOAD_FAILED",
      });
      return;
    }

    const { error: insertError } = await supabase.from("identity_verification_submissions").insert({
      user_id: userId,
      verification_type: "id",
      id_front_path: frontPath,
      id_back_path: backPath,
      selfie_path: selfiePath,
      status: "pending",
    });

    if (insertError) {
      await supabase.storage.from(VERIFICATION_BUCKET).remove([frontPath, backPath, selfiePath]).catch(() => {});
      // Same reasoning as above — payment stays valid, no auto-refund.
      res.status(500).json({
        error: `Failed to submit: ${insertError.message}. Your payment is still valid — you can try again, or request a refund.`,
        code: "UPLOAD_FAILED",
      });
      return;
    }

    res.status(201).json({ success: true });
  },
);

/** GET /api/verification/status — most recent submission of each type,
 *  regardless of status, so the profile page can show pending/approved/
 *  rejected (with reason + resubmit option) correctly. */
router.get("/verification/status", requireAuth, async (req, res): Promise<void> => {
  const { data } = await supabase
    .from("identity_verification_submissions")
    .select("id, verification_type, status, rejection_reason, created_at")
    .eq("user_id", req.user!.id)
    .order("created_at", { ascending: false });

  const photo = (data ?? []).find((s) => s.verification_type === "photo") ?? null;
  const idVerification = (data ?? []).find((s) => s.verification_type === "id") ?? null;

  res.json({ photo, id: idVerification });
});

/** GET /api/admin/verification-queue */
router.get("/admin/verification-queue", requireAuth, requireAdminScope("manage_users"), async (req, res): Promise<void> => {
  const { data: submissions, error } = await supabase
    .from("identity_verification_submissions")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    res.status(500).json({ error: `Failed to load verification queue: ${error.message}` });
    return;
  }

  const userIds = [...new Set((submissions ?? []).map((s) => s.user_id))];
  const { data: profiles } = userIds.length
    ? await supabase.from("profiles").select("id, name, photo_url").in("id", userIds)
    : { data: [] };
  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  // Existing gallery photos, for the admin to visually compare the
  // submitted selfie against.
  const { data: galleryPhotos } = userIds.length
    ? await supabase.from("profile_photos").select("user_id, photo_url").in("user_id", userIds).eq("media_type", "image")
    : { data: [] };
  const galleryMap = new Map<string, string[]>();
  for (const p of galleryPhotos ?? []) {
    const arr = galleryMap.get(p.user_id) ?? [];
    arr.push(p.photo_url);
    galleryMap.set(p.user_id, arr);
  }

  const enriched = await Promise.all(
    (submissions ?? []).map(async (s) => {
      const signedUrls: Record<string, string | null> = { selfie_url: null, id_front_url: null, id_back_url: null };
      const pathFields: [keyof typeof signedUrls, string | null][] = [
        ["selfie_url", s.selfie_path],
        ["id_front_url", s.id_front_path],
        ["id_back_url", s.id_back_path],
      ];
      for (const [key, path] of pathFields) {
        if (!path) continue;
        const { data: signed } = await supabase.storage.from(VERIFICATION_BUCKET).createSignedUrl(path, 600);
        signedUrls[key] = signed?.signedUrl ?? null;
      }

      return {
        id: s.id,
        verification_type: s.verification_type,
        created_at: s.created_at,
        user: profileMap.get(s.user_id) ?? null,
        gallery_photos: galleryMap.get(s.user_id) ?? [],
        ...signedUrls,
      };
    }),
  );

  res.json(enriched);
});

/** POST /api/admin/verification/:submissionId/approve */
router.post(
  "/admin/verification/:submissionId/approve",
  requireAuth,
  requireAdminScope("manage_users"),
  async (req, res): Promise<void> => {
    const adminId = req.user!.id;
    const submissionId = Array.isArray(req.params.submissionId) ? req.params.submissionId[0] : req.params.submissionId;

    const { data: submission } = await supabase
      .from("identity_verification_submissions")
      .select("*")
      .eq("id", submissionId)
      .single();
    if (!submission) {
      res.status(404).json({ error: "Submission not found" });
      return;
    }

    const { error: updateError } = await supabase
      .from("identity_verification_submissions")
      .update({ status: "approved", reviewed_by: adminId, reviewed_at: new Date().toISOString() })
      .eq("id", submissionId);
    if (updateError) {
      res.status(500).json({ error: `Failed to approve: ${updateError.message}` });
      return;
    }

    const badgeField = submission.verification_type === "photo" ? "photo_verified" : "is_verified";
    const { error: badgeError } = await supabase
      .from("profiles")
      .update({ [badgeField]: true })
      .eq("id", submission.user_id);
    if (badgeError) {
      // The submission is already marked 'approved' at this point, so
      // don't leave it stuck — but the admin needs to know the badge
      // itself didn't actually get set, since silently swallowing this
      // is exactly how "approved but no badge shows" bugs happen.
      res.status(500).json({
        error: `Submission was approved, but failed to set the ${badgeField} badge: ${badgeError.message}. Please investigate — the user's profile does not yet reflect this approval.`,
      });
      return;
    }

    const paths = [submission.selfie_path, submission.id_front_path, submission.id_back_path].filter(Boolean) as string[];
    if (paths.length > 0) {
      await supabase.storage.from(VERIFICATION_BUCKET).remove(paths).catch(() => {});
    }

    res.sendStatus(204);
  },
);

/** POST /api/admin/verification/:submissionId/reject */
router.post(
  "/admin/verification/:submissionId/reject",
  requireAuth,
  requireAdminScope("manage_users"),
  async (req, res): Promise<void> => {
    const adminId = req.user!.id;
    const submissionId = Array.isArray(req.params.submissionId) ? req.params.submissionId[0] : req.params.submissionId;
    const { reason } = req.body as { reason?: string };

    if (!reason) {
      res.status(400).json({ error: "A rejection reason is required" });
      return;
    }

    const { data: submission } = await supabase
      .from("identity_verification_submissions")
      .select("*")
      .eq("id", submissionId)
      .single();
    if (!submission) {
      res.status(404).json({ error: "Submission not found" });
      return;
    }

    const { error } = await supabase
      .from("identity_verification_submissions")
      .update({ status: "rejected", rejection_reason: reason, reviewed_by: adminId, reviewed_at: new Date().toISOString() })
      .eq("id", submissionId);
    if (error) {
      res.status(500).json({ error: `Failed to reject: ${error.message}` });
      return;
    }

    // Same storage cleanup as approve — rejection is also a terminal
    // state for these documents (the payment, if this was the paid tier,
    // deliberately stays 'paid' so the user can resubmit for free).
    const paths = [submission.selfie_path, submission.id_front_path, submission.id_back_path].filter(Boolean) as string[];
    if (paths.length > 0) {
      await supabase.storage.from(VERIFICATION_BUCKET).remove(paths).catch(() => {});
    }

    res.sendStatus(204);
  },
);

// ============================================================
// Admin-configurable economy figures — Sparks costs, the monthly grant
// amount, and the ID verification fee. Reuses the same app_settings
// table that already powers the Incognito/Dealbreakers toggles, so
// there's one consistent place admins manage platform-wide settings.
// ============================================================

const ECONOMY_CONFIG_LABELS: Record<string, { label: string; description: string; unit: string }> = {
  sparks_monthly_grant: { label: "Monthly Free Grant", description: "Free Sparks every user receives each month", unit: "Sparks" },
  cost_super_like: { label: "Super Like", description: "Cost to send a Super Like", unit: "Sparks" },
  cost_undo_swipe: { label: "Undo Swipe / Withdraw Invite", description: "Cost to undo a swipe or withdraw a sent invite", unit: "Sparks" },
  cost_reveal_invites: { label: "Reveal Who Invited You", description: "Cost to see new pending inviters", unit: "Sparks" },
  cost_message_before_match: { label: "Message Before Match", description: "Cost to message someone before matching", unit: "Sparks" },
  cost_reshuffle: { label: "Discover Reshuffle", description: "Cost for a paid reshuffle (one free per week)", unit: "Sparks" },
  cost_send_message: { label: "Send Message", description: "Cost to send a message in a match", unit: "Sparks" },
  cost_unsend_message: { label: "Unsend Message", description: "Cost to unsend a sent message", unit: "Sparks" },
  cost_unlock_read_receipts: { label: "Unlock Read Receipts", description: "Cost to unlock read receipts, per match", unit: "Sparks" },
  cost_chat_unlock: { label: "Chat Unlock", description: "Total cost to unlock a new match's chat — split 50/50 between both people if replied to within 48 hours, or paid in full by whoever revives it after that window passes", unit: "Sparks" },
  cost_extra_invite: { label: "Extra Invite", description: "Cost per invite past the daily free quota", unit: "Sparks" },
  daily_free_invites: { label: "Daily Free Invites", description: "Free invites per day before the extra-invite cost applies", unit: "invites/day" },
  cost_reveal_profile_views: { label: "Reveal Profile Viewers", description: "Cost to see who viewed your profile", unit: "Sparks" },
  cost_extra_photo: { label: "Extra Photo", description: "Cost per gallery photo past the free limit", unit: "Sparks" },
  cost_boost: { label: "Profile Boost", description: "Cost for a 5-hour profile boost (24h cooldown)", unit: "Sparks" },
  cost_incognito_per_day: { label: "Incognito Mode", description: "Cost per day while Incognito is active", unit: "Sparks" },
  id_verification_fee_zar: { label: "ID Verification Fee", description: "One-off fee for paid ID verification", unit: "ZAR" },
  sparks_price_starter: { label: "Starter Bundle Price", description: "Price for the 100-Sparks starter bundle", unit: "ZAR" },
  sparks_price_popular: { label: "Popular Bundle Price", description: "Price for the 300-Sparks popular bundle", unit: "ZAR" },
  sparks_price_date_night: { label: "Date Night Bundle Price", description: "Price for the 600-Sparks date night bundle", unit: "ZAR" },
  sparks_price_power_user: { label: "Power User Bundle Price", description: "Price for the 1500-Sparks power user bundle", unit: "ZAR" },
  sparks_price_deep_connection: { label: "Deep Connection Bundle Price", description: "Price for the 4000-Sparks deep connection bundle", unit: "ZAR" },
};

/** GET /api/admin/economy-config — current value of every configurable
 *  figure, plus display metadata so the dashboard doesn't need its own
 *  hardcoded copy of labels/descriptions. */
router.get("/admin/economy-config", requireAuth, requireAdminScope("manage_sparks"), async (req, res): Promise<void> => {
  const config = await getEconomyConfig();
  const withLabels = Object.entries(config).map(([key, value]) => ({
    key,
    value,
    ...(ECONOMY_CONFIG_LABELS[key] ?? { label: key, description: "", unit: "" }),
  }));
  res.json(withLabels);
});

/** PUT /api/admin/economy-config — update one figure. Validates it's a
 *  known key and a non-negative number before writing, then invalidates
 *  the in-memory cache so the change is live for the very next request
 *  rather than waiting out the cache TTL. */
router.put("/admin/economy-config", requireAuth, requireAdminScope("manage_sparks"), async (req, res): Promise<void> => {
  const { key, value } = req.body as { key?: string; value?: number };

  if (!key || !(key in ECONOMY_CONFIG_LABELS)) {
    res.status(400).json({ error: "Unknown configuration key" });
    return;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    res.status(400).json({ error: "value must be a non-negative number" });
    return;
  }

  const { error } = await supabase
    .from("app_settings")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });

  if (error) {
    res.status(500).json({ error: `Failed to update: ${error.message}` });
    return;
  }

  invalidateEconomyConfigCache();
  res.sendStatus(204);
});

export default router;