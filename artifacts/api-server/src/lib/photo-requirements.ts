import { createHash } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { supabase } from "./supabase";
import { checkImageSafety } from "./content-moderation";

/** How many real, distinct photos/clips of themselves a user needs before
 *  they can browse anyone (Discover, Search, categories) or be browsed. */
export const MIN_QUALIFYING_PHOTOS = 3;

/** Admin on/off switch (app_settings key). Defaults to OFF when the row is
 *  missing, so shipping this code changes nothing until it is turned on.
 *  While off: no minimum-photos rule for browsing and no overlay. These are
 *  always active regardless: the duplicate-photo check, "an object can't be
 *  the main photo", and "no main photo = not shown in anyone's feed". */
export const PHOTO_REQUIREMENT_SETTING_KEY = "photo_requirement_enabled";
const SETTING_CACHE_MS = 30_000;
let settingCache: { value: boolean; at: number } | null = null;

export async function isPhotoRequirementEnabled(): Promise<boolean> {
  if (settingCache && Date.now() - settingCache.at < SETTING_CACHE_MS) return settingCache.value;
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", PHOTO_REQUIREMENT_SETTING_KEY)
    .maybeSingle();
  if (error) return settingCache?.value ?? false;
  const value = data?.value === true || data?.value === "true";
  settingCache = { value, at: Date.now() };
  return value;
}

/** Two photos whose 64-bit perceptual hashes differ in this many bits or
 *  fewer are treated as the same picture (re-saved, resized, recompressed). */
const PHASH_MAX_DISTANCE = 4;

export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Accepts only a well-formed 16-char hex hash from the client — anything
 *  else is ignored rather than trusted. */
export function sanitizePerceptualHash(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f]{16}$/.test(value) ? value : null;
}

function hammingDistance(a: string, b: string): number {
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    const x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    dist += (x & 1) + ((x >> 1) & 1) + ((x >> 2) & 1) + ((x >> 3) & 1);
  }
  return dist;
}

/** A photo counts toward the requirement unless a face was positively
 *  confirmed ABSENT. Videos always count (no frame check yet). A null
 *  has_face (check hasn't run or the Vision call failed) fails open, same
 *  philosophy as the existing set-main check. */
export function isQualifying(p: { media_type: string; has_face: boolean | null }): boolean {
  return p.media_type === "video" || p.has_face !== false;
}

interface PhotoRow {
  id: string;
  photo_url: string;
  media_type: "image" | "video";
  position: number;
  has_face: boolean | null;
  content_hash: string | null;
  perceptual_hash: string | null;
}

/** Loads a user's gallery and, once per row, fills in anything missing
 *  from before this feature existed: the content hash (so duplicates of
 *  OLD uploads can be caught too) and has_face (so an old random-object
 *  photo stops counting). Fetches each stored file by URL since only the
 *  URL is kept after upload. Failures leave the row as-is, retried next
 *  time. */
async function loadPhotosWithBackfill(userId: string): Promise<PhotoRow[]> {
  const { data } = await supabase
    .from("profile_photos")
    .select("id, photo_url, media_type, position, has_face, content_hash, perceptual_hash")
    .eq("user_id", userId)
    .order("position", { ascending: true });

  const photos = (data ?? []) as PhotoRow[];
  const needsBackfill = photos.filter((p) => !p.content_hash || (p.media_type === "image" && p.has_face === null));

  await Promise.all(
    needsBackfill.map(async (p) => {
      try {
        const r = await fetch(p.photo_url);
        if (!r.ok) return;
        const buffer = Buffer.from(await r.arrayBuffer());
        const update: Record<string, unknown> = {};

        if (!p.content_hash) {
          p.content_hash = sha256(buffer);
          update.content_hash = p.content_hash;
        }
        if (p.media_type === "image" && p.has_face === null) {
          const safety = await checkImageSafety(buffer);
          if (safety.hasFace !== null && safety.hasFace !== undefined) {
            p.has_face = safety.hasFace;
            update.has_face = safety.hasFace;
          }
        }
        if (Object.keys(update).length > 0) {
          await supabase.from("profile_photos").update(update).eq("id", p.id);
        }
      } catch {
        // Non-fatal — retried on the next sync.
      }
    }),
  );

  return photos;
}

/** True if this user already has the same picture: byte-identical (SHA-256)
 *  or visually near-identical (perceptual hash, supplied by the client for
 *  images). Old rows are hash-backfilled first so old duplicates count. */
export async function isDuplicateUpload(
  userId: string,
  contentHash: string,
  perceptualHash: string | null,
): Promise<boolean> {
  const existing = await loadPhotosWithBackfill(userId);
  return existing.some((p) => {
    if (p.content_hash && p.content_hash === contentHash) return true;
    if (perceptualHash && p.perceptual_hash && hammingDistance(p.perceptual_hash, perceptualHash) <= PHASH_MAX_DISTANCE) {
      return true;
    }
    return false;
  });
}

export interface PhotoState {
  qualifying: number;
  required: number;
  met: boolean;
  mainPhotoUrl: string | null;
}

/** Single source of truth for a user's photo state. Recomputes and stores:
 *   - profiles.photo_requirement_met  (qualifying distinct photos/clips >= 3;
 *     admins are always met so they can still reach people they invite)
 *   - profiles.photo_url              (the first image that is NOT a
 *     confirmed non-face photo — so a random object can never be the main
 *     photo; null if none)
 *  and, if the gallery's first item is a confirmed non-face image, moves
 *  the chosen main image to the front so cards don't lead with an object.
 *  Call after every upload, delete, and set-main, and from the status
 *  endpoint. */
export async function syncPhotoState(userId: string): Promise<PhotoState> {
  const [{ data: profile }, photos] = await Promise.all([
    supabase.from("profiles").select("is_admin, photo_url, photo_requirement_met").eq("id", userId).single(),
    loadPhotosWithBackfill(userId),
  ]);

  // Count distinct pictures only — three copies of one photo count as one.
  const seen = new Set<string>();
  let qualifying = 0;
  for (const p of photos) {
    if (!isQualifying(p)) continue;
    if (p.content_hash) {
      if (seen.has(p.content_hash)) continue;
      seen.add(p.content_hash);
    }
    qualifying++;
  }

  const mainImage = photos.find((p) => p.media_type === "image" && p.has_face !== false) ?? null;

  const first = photos[0];
  if (mainImage && first && first.id !== mainImage.id && first.media_type === "image" && first.has_face === false) {
    const reordered = [mainImage, ...photos.filter((p) => p.id !== mainImage.id)];
    for (let i = 0; i < reordered.length; i++) {
      if (reordered[i].position !== i) {
        await supabase.from("profile_photos").update({ position: i }).eq("id", reordered[i].id);
      }
    }
  }

  const met = !!profile?.is_admin || qualifying >= MIN_QUALIFYING_PHOTOS;
  const mainPhotoUrl = mainImage?.photo_url ?? null;

  if (profile && (profile.photo_url !== mainPhotoUrl || profile.photo_requirement_met !== met)) {
    await supabase.from("profiles").update({ photo_url: mainPhotoUrl, photo_requirement_met: met }).eq("id", userId);
  }

  return { qualifying, required: MIN_QUALIFYING_PHOTOS, met, mainPhotoUrl };
}

/** Route guard for every browse/swipe surface. Put AFTER requireAuth.
 *  Read routes answer with an empty, correctly-shaped payload (so the
 *  page renders its empty state behind the overlay without error toasts);
 *  action routes answer 403 with a machine-readable code. Fails open on a
 *  read error. This only limits what the signed-in user can browse; it
 *  never hides their profile from others. */
export async function requirePhotoRequirement(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!(await isPhotoRequirementEnabled())) {
    next();
    return;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("photo_requirement_met, is_admin")
    .eq("id", req.user!.id)
    .maybeSingle();

  if (error || !data || data.is_admin || data.photo_requirement_met) {
    next();
    return;
  }

  if (req.method === "GET") {
    const path = req.path;
    if (path === "/discover/queue") {
      res.json({ candidates: [], photo_requirement_unmet: true });
    } else if (path === "/discover/categories") {
      res.json({ categories: [], photo_requirement_unmet: true });
    } else {
      res.json({ results: [], photo_requirement_unmet: true });
    }
    return;
  }

  res.status(403).json({
    error: `Add at least ${MIN_QUALIFYING_PHOTOS} real photos or clips of yourself to start browsing.`,
    code: "PHOTO_REQUIREMENT_UNMET",
  });
}