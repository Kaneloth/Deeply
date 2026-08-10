import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { supabase } from "../lib/supabase";
import { spendSparks } from "../lib/sparks-helper";
import { attachPhotoGalleries } from "../lib/photo-galleries";
import { attachAudioPrompts } from "../lib/audio-prompts-helper";
import { withComputedAge, withComputedAges, calculateAge } from "../lib/age";
import { consumeFreeInviteOrCharge } from "../lib/invites-quota";
import { getExcludedCandidateIds, getPendingInviterIds } from "../lib/discover-exclusions";
import { haversineDistanceKm } from "../lib/geo";
import { genderSatisfiesPreference, passesDealbreakers, passesAgeRange, computeCompatibilityScore } from "../lib/matching";
import { getEconomyConfig } from "../lib/economy-config";

const router: IRouter = Router();

const RESHUFFLE_FREE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/** Shared by /discover/queue and /discover/reshuffle — builds a fresh,
 *  randomized batch of candidates, boosted profiles prioritized.
 *  Distance is computed from stored lat/lng (captured from the device's
 *  geolocation) rather than the free-text city field, and used to both
 *  filter by the viewer's preferred radius and attach a real distance_km
 *  to each candidate. If the viewer hasn't granted location access yet
 *  (no lat/lng on file), distance filtering is skipped entirely rather
 *  than showing an empty queue. */
/** Shared by the invites endpoints — fetches the viewer's location once,
 *  computes distance_km for each profile that has coordinates, and strips
 *  the raw lat/lng before returning (never exposed to the client). Skips
 *  filtering entirely (just returns everyone with distance_km: null) if
 *  the viewer hasn't granted location access — invites should never be
 *  hidden by radius, only Discover/Search do that; this is purely about
 *  showing the distance, not filtering by it. */
async function attachDistances<T extends { id: string; latitude?: number | null; longitude?: number | null }>(
  viewerId: string,
  profiles: T[],
): Promise<(Omit<T, "latitude" | "longitude"> & { distance_km: number | null })[]> {
  const { data: viewer } = await supabase.from("profiles").select("latitude, longitude").eq("id", viewerId).single();
  const viewerHasLocation = viewer?.latitude != null && viewer?.longitude != null;

  return profiles.map((p) => {
    const { latitude, longitude, ...rest } = p;
    if (viewerHasLocation && latitude != null && longitude != null) {
      const distance_km = Math.round(haversineDistanceKm(viewer!.latitude!, viewer!.longitude!, latitude, longitude));
      return { ...rest, distance_km };
    }
    return { ...rest, distance_km: null };
  });
}

async function buildDiscoverQueue(userId: string) {
  const excludedIds = await getExcludedCandidateIds(userId);

  const { data: viewer } = await supabase
    .from("profiles")
    .select(
      "latitude, longitude, distance_km, gender, looking_for_gender, relationship_type, dating_intentions, personality_tags, dealbreakers, " +
        "pref_age_min, pref_age_max, " +
        "pref_num_kids, pref_family_plans, pref_smoking_status, pref_vaping_status, pref_drinking_status, pref_nightlife_frequency, pref_has_tattoos, pref_pets, pref_activity_level",
    )
    .eq("id", userId)
    .single();

  if (!viewer) {
    return { candidates: [], error: null };
  }

  const viewerHasLocation = viewer.latitude != null && viewer.longitude != null;
  const radiusKm = viewer.distance_km ?? 25;
  const dealbreakers: string[] = viewer.dealbreakers ?? [];

  const { data: candidates, error } = await supabase
    .from("profiles")
    .select(
      "id, name, age, birthday, bio, city, photo_url, personality_tags, integrity_score, is_verified, photo_verified, boosted_until, " +
        "gender, looking_for_gender, relationship_type, dating_intentions, num_kids, family_plans, smoking_status, vaping_status, drinking_status, " +
        "nightlife_frequency, has_tattoos, pets, activity_level, latitude, longitude",
    )
    .not("id", "in", `(${excludedIds.join(",")})`)
    .eq("is_incognito", false)
    .limit(300);

  if (error || !candidates || candidates.length === 0) {
    return { candidates: [], error };
  }

  // Hard filters — gender preference is bidirectional (both people need
  // to be open to the other's gender), age range, plus radius and
  // dealbreakers. Everything else is a soft signal handled by scoring
  // below, not a filter — with a small user base, hard-filtering on
  // every preference by default would risk an empty queue. Age range is
  // the one exception treated as always-on rather than optional, since
  // it's a baseline expectation on every mainstream dating app, not
  // something people expect to have to opt into.
  const hardFiltered = candidates.filter((c) => {
    if (!genderSatisfiesPreference(c.gender, viewer.looking_for_gender)) return false;
    if (!genderSatisfiesPreference(viewer.gender, c.looking_for_gender)) return false;
    if (!passesDealbreakers(c, viewer, dealbreakers)) return false;
    if (!passesAgeRange(calculateAge(c.birthday ?? null) ?? c.age, viewer.pref_age_min, viewer.pref_age_max)) return false;
    return true;
  });

  // Attach distance where computable; candidates without location data
  // are kept (unknown distance) rather than excluded, so the pool isn't
  // artificially shrunk just because someone hasn't granted geolocation
  // access yet.
  const withDistance = hardFiltered.map((c) => {
    if (viewerHasLocation && c.latitude != null && c.longitude != null) {
      const distance_km = Math.round(haversineDistanceKm(viewer.latitude!, viewer.longitude!, c.latitude, c.longitude));
      return { ...c, distance_km };
    }
    return { ...c, distance_km: null as number | null };
  });

  // Only actually filter by radius for candidates whose distance we
  // could compute — unknown-distance candidates pass through regardless.
  const withinRadius = viewerHasLocation
    ? withDistance.filter((c) => c.distance_km === null || c.distance_km <= radiusKm)
    : withDistance;

  const now = Date.now();
  const boosted = withinRadius.filter((c) => c.boosted_until && new Date(c.boosted_until).getTime() > now);
  const rest = withinRadius.filter((c) => !c.boosted_until || new Date(c.boosted_until).getTime() <= now);

  // Weighted shuffle rather than a strict score-sort: each candidate's
  // compatibility score becomes a bias on top of randomness, so better
  // matches surface more often WITHOUT the queue becoming perfectly
  // deterministic (always the exact same top matches in the exact same
  // order). Preserves variety, matching how established apps avoid
  // showing only exact-preference matches.
  const weightedShuffle = <T extends Record<string, any>>(arr: T[]) =>
    arr
      .map((c) => ({ c, sortKey: computeCompatibilityScore(c, { ...viewer, dealbreakers }) + Math.random() * 20 }))
      .sort((a, b) => b.sortKey - a.sortKey)
      .map(({ c }) => c);

  const prioritized = [...weightedShuffle(boosted), ...weightedShuffle(rest)].slice(0, 20);

  const strippedCandidates = prioritized.map(
    ({ boosted_until, latitude, longitude, gender, looking_for_gender, relationship_type, dating_intentions, ...profileFields }) =>
      profileFields,
  );

  const withPhotos = await attachPhotoGalleries(strippedCandidates);
  const withAudio = await attachAudioPrompts(withPhotos);

  return { candidates: withComputedAges(withAudio), error: null };
}

/** GET /api/discover/queue — return a batch of candidate profiles the user
 *  hasn't swiped on yet, ready to swipe through Tinder-style. */
router.get("/discover/queue", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { candidates, error } = await buildDiscoverQueue(userId);

  if (error) {
    res.status(500).json({ error: "Failed to load discover queue" });
    return;
  }

  res.json({ candidates });
});

/** GET /api/discover/reshuffle-status — tells the frontend whether the
 *  next reshuffle is free or will cost Sparks, so the button can show
 *  the right label before the person taps it. */
router.get("/discover/reshuffle-status", requireAuth, async (req, res): Promise<void> => {
  const { data: profile } = await supabase
    .from("profiles")
    .select("last_free_reshuffle_at")
    .eq("id", req.user!.id)
    .single();

  const lastFree = profile?.last_free_reshuffle_at ? new Date(profile.last_free_reshuffle_at) : null;
  const isFree = !lastFree || Date.now() - lastFree.getTime() >= RESHUFFLE_FREE_INTERVAL_MS;
  const nextFreeAt = lastFree ? new Date(lastFree.getTime() + RESHUFFLE_FREE_INTERVAL_MS).toISOString() : null;

  const { cost_reshuffle } = await getEconomyConfig();
  res.json({ isFree, cost: cost_reshuffle, nextFreeAt: isFree ? null : nextFreeAt });
});

/** POST /api/discover/reshuffle — re-randomizes the discover queue on
 *  demand. Free once every 7 days, admin-configurable Sparks otherwise. */
router.post("/discover/reshuffle", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const { data: profile } = await supabase
    .from("profiles")
    .select("last_free_reshuffle_at")
    .eq("id", userId)
    .single();

  const lastFree = profile?.last_free_reshuffle_at ? new Date(profile.last_free_reshuffle_at) : null;
  const isFree = !lastFree || Date.now() - lastFree.getTime() >= RESHUFFLE_FREE_INTERVAL_MS;

  if (isFree) {
    await supabase.from("profiles").update({ last_free_reshuffle_at: new Date().toISOString() }).eq("id", userId);
  } else {
    const { cost_reshuffle } = await getEconomyConfig();
    const spend = await spendSparks(userId, cost_reshuffle, "Discover reshuffle");
    if (!spend.success) {
      res.status(400).json({ error: "Not enough Sparks to reshuffle" });
      return;
    }
  }

  const { candidates, error } = await buildDiscoverQueue(userId);
  if (error) {
    res.status(500).json({ error: "Failed to reshuffle" });
    return;
  }

  res.json({ candidates, wasFree: isFree });
});

/** POST /api/discover/swipe — record a like / pass / super_like and report
 *  back whether it created a mutual match. Super Like costs Sparks. */
router.post("/discover/swipe", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { targetId, direction, clientTimezone, skipInviteQuota } = req.body as {
    targetId?: string;
    direction?: "like" | "pass" | "super_like";
    clientTimezone?: string;
    skipInviteQuota?: boolean;
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
    const { cost_super_like } = await getEconomyConfig();
    const spend = await spendSparks(userId, cost_super_like, "Super Like");
    if (!spend.success) {
      res.status(402).json({ error: `Insufficient Sparks (need ${cost_super_like})`, balance: spend.balance });
      return;
    }
  }

  // Regular "like" invites draw from the daily free quota (15/day,
  // resetting at local midnight) before falling back to a Sparks charge.
  // Accepting an already-received invite is exempt — that's completing an
  // existing match opportunity, not sending a fresh cold invite.
  let inviteBalanceAfter: number | null = null;
  if (direction === "like" && !skipInviteQuota) {
    const quota = await consumeFreeInviteOrCharge(userId, clientTimezone);
    if (!quota.success) {
      res.status(402).json({ error: "Insufficient Sparks for an extra invite today", balance: quota.balance });
      return;
    }
    inviteBalanceAfter = quota.balance;
  }

  // Upsert rather than insert — this lets someone swipe again on a
  // profile they'd already swiped on before (e.g. inviting back someone
  // from "Who Viewed You" who they'd invited earlier, before Discover's
  // exclusion filter hid them). A plain insert would hit the unique
  // constraint on (swiper_id, target_id) and fail — and since the
  // Sparks/quota charge above already happened by this point, that
  // failure meant the person was charged for a swipe that never actually
  // recorded. Upserting avoids that entirely.
  const { error: insertError } = await supabase.from("swipes").upsert(
    {
      swiper_id: userId,
      target_id: targetId,
      direction,
    },
    { onConflict: "swiper_id,target_id" },
  );

  if (insertError) {
    res.status(500).json({ error: `Failed to record swipe: ${insertError.message}` });
    return;
  }

  if (direction === "pass") {
    res.json({ matched: false });
    return;
  }

  const [lo, hi] = [userId, targetId].sort();

  // Check if the other person has already invited ME — if so, this swipe
  // completes a mutual match. We create the match explicitly here rather
  // than relying solely on a database trigger we don't have visibility
  // into, so this critical path is fully under our control and doesn't
  // silently depend on unverified trigger logic (e.g. someone accepting
  // an invite from Discover without ever visiting the Invites page).
  const { data: reverseSwipe } = await supabase
    .from("swipes")
    .select("id")
    .eq("swiper_id", targetId)
    .eq("target_id", userId)
    .in("direction", ["like", "super_like"])
    .maybeSingle();

  let match: { id: string } | null = null;

  const { data: existingMatch } = await supabase
    .from("matches")
    .select("id")
    .eq("user1_id", lo)
    .eq("user2_id", hi)
    .maybeSingle();

  if (existingMatch) {
    match = existingMatch;
  } else if (reverseSwipe) {
    const { data: newMatch, error: matchError } = await supabase
      .from("matches")
      .insert({ user1_id: lo, user2_id: hi })
      .select("id")
      .single();

    if (!matchError && newMatch) {
      match = newMatch;
    } else if (matchError?.code === "23505") {
      // Unique constraint hit — a trigger (or a concurrent request) beat
      // us to creating it. Fetch what it created instead of treating
      // this as a failure.
      const { data: raceMatch } = await supabase
        .from("matches")
        .select("id")
        .eq("user1_id", lo)
        .eq("user2_id", hi)
        .maybeSingle();
      match = raceMatch ?? null;
    }
  }

  res.json({ matched: !!match, matchId: match?.id ?? null, sparksCharged: inviteBalanceAfter !== null });
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

  const { cost_undo_swipe } = await getEconomyConfig();
  const spend = await spendSparks(userId, cost_undo_swipe, "Undo swipe");
  if (!spend.success) {
    res.status(402).json({ error: `Insufficient Sparks (need ${cost_undo_swipe})`, balance: spend.balance });
    return;
  }

  await supabase.from("swipes").delete().eq("id", lastSwipe.id);

  const { data: restoredProfile } = await supabase
    .from("profiles")
    .select("id, name, age, birthday, bio, city, photo_url, personality_tags, integrity_score, is_verified, photo_verified, num_kids, family_plans, smoking_status, drinking_status")
    .eq("id", lastSwipe.target_id)
    .single();

  const [restoredWithPhotos] = restoredProfile ? await attachPhotoGalleries([restoredProfile]) : [null];
  const [restoredWithAudio] = restoredWithPhotos ? await attachAudioPrompts([restoredWithPhotos]) : [null];

  res.json({ restoredProfile: restoredWithAudio ? withComputedAge(restoredWithAudio) : null, balance: spend.balance });
});

/** GET /api/discover/invites — FREE. Returns people who already invited
 *  this user and haven't matched yet, split into:
 *  - revealed: profiles this user already paid to see (free forever now)
 *  - new_count: how many additional pending inviters haven't been
 *    revealed yet (still requires a paid reveal) */
router.get("/discover/invites", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const pendingInviters = await getPendingInviterIds(userId);
  const pendingInviterIds = pendingInviters.map((p) => p.id);

  if (pendingInviterIds.length === 0) {
    res.json({ revealed: [], new_count: 0 });
    return;
  }

  const { data: alreadyRevealed } = await supabase
    .from("invite_reveals")
    .select("target_id")
    .eq("user_id", userId)
    .in("target_id", pendingInviterIds);

  const revealedIds = new Set((alreadyRevealed ?? []).map((r) => r.target_id));
  const revealedPendingIds = pendingInviterIds.filter((id) => revealedIds.has(id));
  const newCount = pendingInviterIds.length - revealedPendingIds.length;

  if (revealedPendingIds.length === 0) {
    res.json({ revealed: [], new_count: newCount });
    return;
  }

  const { data: revealedProfiles } = await supabase
    .from("profiles")
    .select("id, name, age, birthday, bio, city, photo_url, personality_tags, integrity_score, is_verified, photo_verified, num_kids, family_plans, smoking_status, drinking_status, latitude, longitude")
    .in("id", revealedPendingIds);

  const superLikerIds = new Set(
    pendingInviters.filter((p) => p.direction === "super_like").map((p) => p.id),
  );
  const enriched = (revealedProfiles ?? []).map((p) => ({ ...p, super_liked: superLikerIds.has(p.id) }));
  const withDistance = await attachDistances(userId, enriched);
  const enrichedWithPhotos = await attachPhotoGalleries(withDistance);

  res.json({ revealed: withComputedAges(await attachAudioPrompts(enrichedWithPhotos)), new_count: newCount });
});

/** POST /api/discover/invites/reveal — PAID (30 Sparks), but ONLY if
 *  there's at least one genuinely new inviter since the last reveal.
 *  Already-revealed people never cost Sparks again. Returns the full
 *  updated list of everyone pending (previously revealed + newly
 *  revealed). */
router.post("/discover/invites/reveal", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const pendingInviters = await getPendingInviterIds(userId);
  const pendingInviterIds = pendingInviters.map((p) => p.id);

  if (pendingInviterIds.length === 0) {
    res.json({ invites: [], balance: null });
    return;
  }

  const { data: alreadyRevealed } = await supabase
    .from("invite_reveals")
    .select("target_id")
    .eq("user_id", userId)
    .in("target_id", pendingInviterIds);

  const revealedIds = new Set((alreadyRevealed ?? []).map((r) => r.target_id));
  const hasNew = pendingInviterIds.some((id) => !revealedIds.has(id));

  let balance: number | null = null;

  if (hasNew) {
    const { cost_reveal_invites } = await getEconomyConfig();
    const spend = await spendSparks(userId, cost_reveal_invites, "See who invited you");
    if (!spend.success) {
      res.status(402).json({ error: `Insufficient Sparks (need ${cost_reveal_invites})`, balance: spend.balance });
      return;
    }
    balance = spend.balance;

    // Mark everyone currently pending as revealed, so revisiting never
    // re-charges for people already seen.
    const rows = pendingInviterIds.map((targetId) => ({ user_id: userId, target_id: targetId }));
    await supabase.from("invite_reveals").upsert(rows, { onConflict: "user_id,target_id" });
  }

  const { data: inviters } = await supabase
    .from("profiles")
    .select("id, name, age, birthday, bio, city, photo_url, personality_tags, integrity_score, is_verified, photo_verified, num_kids, family_plans, smoking_status, drinking_status, latitude, longitude")
    .in("id", pendingInviterIds);

  const superLikerIds = new Set(
    pendingInviters.filter((p) => p.direction === "super_like").map((p) => p.id),
  );

  const enriched = (inviters ?? []).map((l) => ({ ...l, super_liked: superLikerIds.has(l.id) }));
  const withDistance = await attachDistances(userId, enriched);
  const enrichedWithPhotos = await attachPhotoGalleries(withDistance);

  res.json({ invites: withComputedAges(await attachAudioPrompts(enrichedWithPhotos)), balance });
});

/** GET /api/discover/search — filter/search the same unswiped candidate
 *  pool as /queue, by name, age range, city, and personality tags. Also
 *  respects the viewer's radius preference and attaches distance_km,
 *  same as the queue — skipped if the viewer hasn't granted location
 *  access yet. */
router.get("/discover/search", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { name, min_age, max_age, city, tags } = req.query as {
    name?: string;
    min_age?: string;
    max_age?: string;
    city?: string;
    tags?: string;
  };

  const excludedIds = await getExcludedCandidateIds(userId);

  const { data: viewer } = await supabase
    .from("profiles")
    .select(
      "latitude, longitude, distance_km, gender, looking_for_gender, dealbreakers, pref_age_min, pref_age_max, " +
        "pref_num_kids, pref_family_plans, pref_smoking_status, pref_vaping_status, pref_drinking_status, pref_nightlife_frequency, pref_has_tattoos, pref_pets, pref_activity_level",
    )
    .eq("id", userId)
    .single();
  const viewerHasLocation = viewer?.latitude != null && viewer?.longitude != null;
  const radiusKm = viewer?.distance_km ?? 25;
  const dealbreakers: string[] = viewer?.dealbreakers ?? [];

  // Explicit query params (from typing a one-off range into this specific
  // search) take priority when present, but fall back to the viewer's
  // saved preference from Preferences — previously this endpoint only
  // ever looked at the query params, so unless someone manually entered
  // an age range for that particular search, their saved preference was
  // silently ignored entirely.
  const effectiveMinAge = min_age ? Number(min_age) : viewer?.pref_age_min ?? 18;
  const effectiveMaxAge = max_age ? Number(max_age) : viewer?.pref_age_max ?? 99;

  let query = supabase
    .from("profiles")
    .select(
      "id, name, age, birthday, bio, city, photo_url, personality_tags, integrity_score, is_verified, photo_verified, " +
        "gender, looking_for_gender, num_kids, family_plans, smoking_status, vaping_status, drinking_status, nightlife_frequency, has_tattoos, pets, activity_level, " +
        "latitude, longitude",
    )
    .not("id", "in", `(${excludedIds.join(",")})`)
    .eq("is_incognito", false);

  if (name) {
    query = query.ilike("name", `%${name}%`);
  }
  query = query.gte("age", effectiveMinAge).lte("age", effectiveMaxAge);
  if (city) {
    query = query.ilike("city", `%${city}%`);
  }
  if (tags) {
    const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
    if (tagList.length > 0) {
      query = query.overlaps("personality_tags", tagList);
    }
  }

  const { data: rawResults, error } = await query.limit(150);

  if (error) {
    res.status(500).json({ error: "Search failed" });
    return;
  }

  // Same gender-preference and dealbreaker enforcement the main Discover
  // queue applies — previously missing here entirely, meaning Search
  // could surface people outside the viewer's stated gender preference
  // or explicit lifestyle dealbreakers.
  const results = (rawResults ?? []).filter((c) => {
    if (!genderSatisfiesPreference(c.gender, viewer?.looking_for_gender)) return false;
    if (!genderSatisfiesPreference(viewer?.gender, c.looking_for_gender)) return false;
    if (viewer && !passesDealbreakers(c, viewer, dealbreakers)) return false;
    return true;
  });

  const withDistance = (results ?? []).map((c) => {
    if (viewerHasLocation && c.latitude != null && c.longitude != null) {
      const distance_km = Math.round(haversineDistanceKm(viewer!.latitude!, viewer!.longitude!, c.latitude, c.longitude));
      return { ...c, distance_km };
    }
    return { ...c, distance_km: null as number | null };
  });

  const withinRadius = viewerHasLocation
    ? withDistance.filter((c) => c.distance_km === null || c.distance_km <= radiusKm)
    : withDistance;

  const stripped = withinRadius.slice(0, 30).map(({ latitude, longitude, ...rest }) => rest);

  const withPhotos = await attachPhotoGalleries(stripped);

  res.json({ results: withComputedAges(await attachAudioPrompts(withPhotos)) });
});

/** GET /api/discover/categories — lightweight preview data for stat cards
 *  on the Search page (count + a few preview photos per category). */
router.get("/discover/categories", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const excludedIds = await getExcludedCandidateIds(userId);
  const excludeClause = `(${excludedIds.join(",")})`;

  const { data: viewerProfile } = await supabase
    .from("profiles")
    .select("city, personality_tags")
    .eq("id", userId)
    .single();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const categories: Array<{ key: string; label: string; count: number; preview_photos: string[] }> = [];

  // New Here — joined in the last 7 days
  {
    const { data } = await supabase
      .from("profiles")
      .select("photo_url")
      .not("id", "in", excludeClause)
      .eq("is_incognito", false)
      .gte("created_at", sevenDaysAgo)
      .limit(3);
    const { count } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .not("id", "in", excludeClause)
      .eq("is_incognito", false)
      .gte("created_at", sevenDaysAgo);
    categories.push({
      key: "new_here",
      label: "New Here",
      count: count ?? 0,
      preview_photos: (data ?? []).map((p) => p.photo_url).filter(Boolean) as string[],
    });
  }

  // Verified
  {
    const { data } = await supabase
      .from("profiles")
      .select("photo_url")
      .not("id", "in", excludeClause)
      .eq("is_incognito", false)
      .eq("is_verified", true)
      .limit(3);
    const { count } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .not("id", "in", excludeClause)
      .eq("is_incognito", false)
      .eq("is_verified", true);
    categories.push({
      key: "verified",
      label: "Verified",
      count: count ?? 0,
      preview_photos: (data ?? []).map((p) => p.photo_url).filter(Boolean) as string[],
    });
  }

  // Has Audio Bio
  {
    const { data: audioUserRows } = await supabase.from("audio_prompts").select("user_id");
    const audioUserIds = [...new Set((audioUserRows ?? []).map((r) => r.user_id))].filter(
      (id) => !excludedIds.includes(id),
    );
    let preview: string[] = [];
    if (audioUserIds.length > 0) {
      const { data } = await supabase
        .from("profiles")
        .select("photo_url")
        .in("id", audioUserIds.slice(0, 50))
        .eq("is_incognito", false)
        .limit(3);
      preview = (data ?? []).map((p) => p.photo_url).filter(Boolean) as string[];
    }
    categories.push({ key: "has_audio", label: "Audio Bios", count: audioUserIds.length, preview_photos: preview });
  }

  // Near You — same city as viewer
  if (viewerProfile?.city) {
    const { data } = await supabase
      .from("profiles")
      .select("photo_url")
      .not("id", "in", excludeClause)
      .eq("is_incognito", false)
      .ilike("city", viewerProfile.city)
      .limit(3);
    const { count } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .not("id", "in", excludeClause)
      .eq("is_incognito", false)
      .ilike("city", viewerProfile.city);
    categories.push({
      key: "near_you",
      label: "Near You",
      count: count ?? 0,
      preview_photos: (data ?? []).map((p) => p.photo_url).filter(Boolean) as string[],
    });
  }

  // Matches Your Vibe — overlapping personality tags
  if (viewerProfile?.personality_tags && viewerProfile.personality_tags.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("photo_url")
      .not("id", "in", excludeClause)
      .eq("is_incognito", false)
      .overlaps("personality_tags", viewerProfile.personality_tags)
      .limit(3);
    const { count } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .not("id", "in", excludeClause)
      .eq("is_incognito", false)
      .overlaps("personality_tags", viewerProfile.personality_tags);
    categories.push({
      key: "matches_vibe",
      label: "Matches Your Vibe",
      count: count ?? 0,
      preview_photos: (data ?? []).map((p) => p.photo_url).filter(Boolean) as string[],
    });
  }

  // Popular — most invited (liked) in the last 7 days
  {
    const { data: recentLikes } = await supabase
      .from("swipes")
      .select("target_id")
      .in("direction", ["like", "super_like"])
      .gte("created_at", sevenDaysAgo);

    const countMap = new Map<string, number>();
    for (const l of recentLikes ?? []) {
      if (excludedIds.includes(l.target_id)) continue;
      countMap.set(l.target_id, (countMap.get(l.target_id) ?? 0) + 1);
    }
    const topIds = [...countMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id);
    let preview: string[] = [];
    if (topIds.length > 0) {
      const { data } = await supabase.from("profiles").select("id, photo_url").in("id", topIds).eq("is_incognito", false);
      preview = topIds
        .map((id) => data?.find((p) => p.id === id)?.photo_url)
        .filter(Boolean) as string[];
    }
    categories.push({ key: "popular", label: "Popular", count: countMap.size, preview_photos: preview });
  }

  res.json({ categories });
});

/** GET /api/discover/categories/:key — full profile results for a tapped
 *  stat card. */
router.get("/discover/categories/:key", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const key = Array.isArray(req.params.key) ? req.params.key[0] : req.params.key;

  const excludedIds = await getExcludedCandidateIds(userId);
  const excludeClause = `(${excludedIds.join(",")})`;
  const SELECT_FIELDS =
    "id, name, age, birthday, bio, city, photo_url, personality_tags, integrity_score, is_verified, photo_verified, " +
    "gender, looking_for_gender, relationship_type, dating_intentions, " +
    "num_kids, family_plans, smoking_status, vaping_status, drinking_status, nightlife_frequency, has_tattoos, pets, activity_level, " +
    "latitude, longitude";

  const { data: viewerProfile } = await supabase
    .from("profiles")
    .select(
      "city, personality_tags, gender, looking_for_gender, relationship_type, dating_intentions, dealbreakers, " +
        "pref_age_min, pref_age_max, " +
        "pref_num_kids, pref_family_plans, pref_smoking_status, pref_vaping_status, pref_drinking_status, pref_nightlife_frequency, pref_has_tattoos, pref_pets, pref_activity_level",
    )
    .eq("id", userId)
    .single();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  let results: any[] = [];

  switch (key) {
    case "new_here": {
      const { data } = await supabase
        .from("profiles")
        .select(SELECT_FIELDS)
        .not("id", "in", excludeClause)
        .eq("is_incognito", false)
        .gte("created_at", sevenDaysAgo)
        .order("created_at", { ascending: false })
        .limit(30);
      results = data ?? [];
      break;
    }
    case "verified": {
      const { data } = await supabase
        .from("profiles")
        .select(SELECT_FIELDS)
        .not("id", "in", excludeClause)
        .eq("is_incognito", false)
        .eq("is_verified", true)
        .limit(30);
      results = data ?? [];
      break;
    }
    case "has_audio": {
      const { data: audioUserRows } = await supabase.from("audio_prompts").select("user_id");
      const audioUserIds = [...new Set((audioUserRows ?? []).map((r) => r.user_id))].filter(
        (id) => !excludedIds.includes(id),
      );
      if (audioUserIds.length > 0) {
        const { data } = await supabase
          .from("profiles")
          .select(SELECT_FIELDS)
          .in("id", audioUserIds.slice(0, 30))
          .eq("is_incognito", false);
        results = data ?? [];
      }
      break;
    }
    case "near_you": {
      if (viewerProfile?.city) {
        const { data } = await supabase
          .from("profiles")
          .select(SELECT_FIELDS)
          .not("id", "in", excludeClause)
          .eq("is_incognito", false)
          .ilike("city", viewerProfile.city)
          .limit(30);
        results = data ?? [];
      }
      break;
    }
    case "matches_vibe": {
      // Previously this only checked personality_tags overlap at the
      // database level — meaning two people who shared one hobby tag
      // but disagreed on everything else (smoking, drinking, activity
      // level, relationship type) could still show up here, which is
      // exactly backwards for a category promising overall compatibility.
      // Now: fetch a broad pool, then use the same holistic scoring
      // function the main Discover queue uses, and take the best matches.
      const { data } = await supabase
        .from("profiles")
        .select(SELECT_FIELDS)
        .not("id", "in", excludeClause)
        .eq("is_incognito", false)
        .limit(300);

      results = (data ?? [])
        .map((c) => ({ ...c, __score: viewerProfile ? computeCompatibilityScore(c, { ...viewerProfile, dealbreakers: viewerProfile.dealbreakers ?? [] }) : 0 }))
        .sort((a, b) => b.__score - a.__score)
        .slice(0, 30)
        .map(({ __score, ...profile }) => profile);
      break;
    }
    case "popular": {
      const { data: recentLikes } = await supabase
        .from("swipes")
        .select("target_id")
        .in("direction", ["like", "super_like"])
        .gte("created_at", sevenDaysAgo);

      const countMap = new Map<string, number>();
      for (const l of recentLikes ?? []) {
        if (excludedIds.includes(l.target_id)) continue;
        countMap.set(l.target_id, (countMap.get(l.target_id) ?? 0) + 1);
      }
      const topIds = [...countMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([id]) => id);
      if (topIds.length > 0) {
        const { data } = await supabase.from("profiles").select(SELECT_FIELDS).in("id", topIds).eq("is_incognito", false);
        // Preserve popularity order
        results = topIds.map((id) => (data ?? []).find((p) => p.id === id)).filter(Boolean);
      }
      break;
    }
    default: {
      res.status(400).json({ error: "Unknown category" });
      return;
    }
  }

  // Applied uniformly across every category, regardless of which one was
  // requested — gender preference, dealbreakers, and age range are
  // baseline expectations a user set deliberately, and previously none
  // of these categories respected any of them at all. A category being
  // "New Here" or "Popular" doesn't make someone's stated preferences
  // optional; those are about ordering/selection criteria, not about
  // who's allowed to be shown in the first place.
  if (viewerProfile) {
    const dealbreakers: string[] = viewerProfile.dealbreakers ?? [];
    results = results.filter((c) => {
      if (!genderSatisfiesPreference(c.gender, viewerProfile.looking_for_gender)) return false;
      if (!genderSatisfiesPreference(viewerProfile.gender, c.looking_for_gender)) return false;
      if (!passesDealbreakers(c, viewerProfile, dealbreakers)) return false;
      const candidateAge = calculateAge(c.birthday ?? null) ?? c.age;
      if (!passesAgeRange(candidateAge, viewerProfile.pref_age_min, viewerProfile.pref_age_max)) return false;
      return true;
    });
  }

  const withDistance = await attachDistances(userId, results);
  const withPhotos = await attachPhotoGalleries(withDistance);

  res.json({ results: withComputedAges(await attachAudioPrompts(withPhotos)) });
});

/** POST /api/discover/message-request — send an opening message to
 *  someone before matching (30 Sparks). Creates the match immediately so
 *  the conversation works exactly like a normal match's chat from then
 *  on, for both people. */
router.post("/discover/message-request", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { targetId, content } = req.body as { targetId?: string; content?: string };

  if (!targetId || !content || content.trim() === "") {
    res.status(400).json({ error: "targetId and content are required" });
    return;
  }

  if (targetId === userId) {
    res.status(400).json({ error: "Cannot message yourself" });
    return;
  }

  const [lo, hi] = [userId, targetId].sort();
  const { data: existingMatch } = await supabase
    .from("matches")
    .select("id")
    .eq("user1_id", lo)
    .eq("user2_id", hi)
    .maybeSingle();

  if (existingMatch) {
    res.status(400).json({
      error: "You're already matched — send messages from your Matches list",
      matchId: existingMatch.id,
    });
    return;
  }

  const { data: targetProfile } = await supabase.from("profiles").select("id").eq("id", targetId).single();
  if (!targetProfile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  const { cost_message_before_match } = await getEconomyConfig();
  const spend = await spendSparks(userId, cost_message_before_match, "Message before match");
  if (!spend.success) {
    res.status(402).json({ error: `Insufficient Sparks (need ${cost_message_before_match})`, balance: spend.balance });
    return;
  }

  // Best-effort: record this as an implicit invite so the profile doesn't
  // keep reappearing in the sender's Discover queue. Not fatal if it
  // conflicts with an existing swipe row.
  await supabase.from("swipes").insert({ swiper_id: userId, target_id: targetId, direction: "like" });

  const { data: match, error: matchError } = await supabase
    .from("matches")
    .insert({ user1_id: lo, user2_id: hi })
    .select("id")
    .single();

  if (matchError || !match) {
    res.status(500).json({ error: "Failed to start conversation" });
    return;
  }

  const { data: message, error: messageError } = await supabase
    .from("messages")
    .insert({ match_id: match.id, sender_id: userId, content: content.trim() })
    .select("*")
    .single();

  if (messageError || !message) {
    res.status(500).json({ error: "Failed to send message" });
    return;
  }

  await supabase.from("matches").update({ message_count: 1 }).eq("id", match.id);

  res.status(201).json({ matchId: match.id, message, balance: spend.balance });
});

/** GET /api/discover/invites/sent — FREE. People this user has invited
 *  (liked/super-liked) who haven't matched back yet. No paywall here —
 *  the user already knows exactly who they chose to invite. */
router.get("/discover/invites/sent", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const { data: outgoingLikes } = await supabase
    .from("swipes")
    .select("target_id, direction")
    .eq("swiper_id", userId)
    .in("direction", ["like", "super_like"]);

  const sentIds = outgoingLikes?.map((l) => l.target_id) ?? [];

  if (sentIds.length === 0) {
    res.json({ sent: [] });
    return;
  }

  const { data: existingMatches } = await supabase
    .from("matches")
    .select("user1_id, user2_id")
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`);

  const matchedIds = new Set(
    (existingMatches ?? []).map((m) => (m.user1_id === userId ? m.user2_id : m.user1_id)),
  );

  const pendingSentIds = sentIds.filter((id) => !matchedIds.has(id));

  if (pendingSentIds.length === 0) {
    res.json({ sent: [] });
    return;
  }

  const { data: sentProfiles } = await supabase
    .from("profiles")
    .select("id, name, age, birthday, bio, city, photo_url, personality_tags, integrity_score, is_verified, photo_verified, num_kids, family_plans, smoking_status, drinking_status, latitude, longitude")
    .in("id", pendingSentIds);

  const superSentIds = new Set(
    (outgoingLikes ?? []).filter((l) => l.direction === "super_like").map((l) => l.target_id),
  );
  const enriched = (sentProfiles ?? []).map((p) => ({ ...p, super_liked: superSentIds.has(p.id) }));
  const withDistance = await attachDistances(userId, enriched);
  const enrichedWithPhotos = await attachPhotoGalleries(withDistance);

  res.json({ sent: withComputedAges(await attachAudioPrompts(enrichedWithPhotos)) });
});

/** DELETE /api/discover/invites/sent/:targetId — withdraw an invite you
 *  sent that hasn't been matched yet. Removes the underlying swipe, which
 *  also lets that profile reappear in your Discover/Search queue again. */
router.delete("/discover/invites/sent/:targetId", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const targetId = Array.isArray(req.params.targetId) ? req.params.targetId[0] : req.params.targetId;

  const [lo, hi] = [userId, targetId].sort();
  const { data: existingMatch } = await supabase
    .from("matches")
    .select("id")
    .eq("user1_id", lo)
    .eq("user2_id", hi)
    .maybeSingle();

  if (existingMatch) {
    res.status(400).json({ error: "You've already matched — unmatch from the Matches tab instead" });
    return;
  }

  const { data: swipe } = await supabase
    .from("swipes")
    .select("id")
    .eq("swiper_id", userId)
    .eq("target_id", targetId)
    .in("direction", ["like", "super_like"])
    .maybeSingle();

  if (!swipe) {
    res.status(404).json({ error: "Invite not found" });
    return;
  }

  const { cost_undo_swipe: withdrawCost } = await getEconomyConfig();
  const spend = await spendSparks(userId, withdrawCost, "Withdraw invite");
  if (!spend.success) {
    res.status(402).json({ error: `Insufficient Sparks (need ${withdrawCost})`, balance: spend.balance });
    return;
  }

  const { error } = await supabase.from("swipes").delete().eq("id", swipe.id);

  if (error) {
    res.status(500).json({ error: `Failed to withdraw invite: ${error.message}` });
    return;
  }

  res.json({ balance: spend.balance });
});

export default router;