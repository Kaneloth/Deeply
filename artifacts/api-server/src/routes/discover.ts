import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { supabase } from "../lib/supabase";
import { spendSparks } from "../lib/sparks-helper";
import { attachPhotoGalleries } from "../lib/photo-galleries";
import { attachAudioPrompts } from "../lib/audio-prompts-helper";
import { withComputedAge, withComputedAges, calculateAge } from "../lib/age";
import { consumeFreeInviteOrCharge } from "../lib/invites-quota";
import { getExcludedCandidateIds, getPendingInviterIds, getCandidateExclusionSets } from "../lib/discover-exclusions";
import { haversineDistanceKm } from "../lib/geo";
import { genderSatisfiesPreference, passesDealbreakers, passesAgeRange, computeCompatibilityScore } from "../lib/matching";
import { getEconomyConfig } from "../lib/economy-config";

const router: IRouter = Router();

const RESHUFFLE_FREE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

async function attachPhotosAndAudio<T extends { id: string; photo_url: string | null }>(items: T[]) {
  const [withPhotos, withAudio] = await Promise.all([
    attachPhotoGalleries(items),
    attachAudioPrompts(items),
  ]);
  const audioById = new Map(withAudio.map((i) => [i.id, i.audio_prompts]));
  return withPhotos.map((item) => ({ ...item, audio_prompts: audioById.get(item.id) ?? [] }));
}

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

async function buildDiscoverQueue(userId: string, extraExcludeIds: string[] = []) {
  const [excludedFromHistory, { data: viewer }] = await Promise.all([
    getExcludedCandidateIds(userId),
    supabase
      .from("profiles")
      .select(
        "latitude, longitude, distance_km, gender, looking_for_gender, relationship_type, dating_intentions, personality_tags, dealbreakers, " +
          "pref_age_min, pref_age_max, " +
          "pref_num_kids, pref_family_plans, pref_smoking_status, pref_vaping_status, pref_drinking_status, pref_nightlife_frequency, pref_has_tattoos, pref_pets, pref_activity_level",
      )
      .eq("id", userId)
      .single(),
  ]);
  const excludedIds = [...excludedFromHistory, ...extraExcludeIds];

  if (!viewer) {
    return { candidates: [], error: null };
  }

  const viewerHasLocation = viewer.latitude != null && viewer.longitude != null;
  const radiusKm = viewer.distance_km ?? 25;
  const dealbreakers: string[] = viewer.dealbreakers ?? [];

  const { data: candidates, error } = await supabase
    .from("profiles")
    .select(
      "id, name, age, birthday, bio, city, photo_url, personality_tags, integrity_score, is_verified, photo_verified, is_founder, boosted_until, " +
        "gender, looking_for_gender, relationship_type, dating_intentions, num_kids, family_plans, smoking_status, vaping_status, drinking_status, " +
        "nightlife_frequency, has_tattoos, pets, activity_level, height_cm, latitude, longitude",
    )
    .not("id", "in", `(${excludedIds.join(",")})`)
    .eq("is_incognito", false)
    .limit(300);

  if (error || !candidates || candidates.length === 0) {
    return { candidates: [], error };
  }

  const hardFiltered = candidates.filter((c) => {
    if (!genderSatisfiesPreference(c.gender, viewer.looking_for_gender)) return false;
    if (!genderSatisfiesPreference(viewer.gender, c.looking_for_gender)) return false;
    if (!passesDealbreakers(c, viewer, dealbreakers)) return false;
    if (!passesAgeRange(calculateAge(c.birthday ?? null) ?? c.age, viewer.pref_age_min, viewer.pref_age_max)) return false;
    return true;
  });

  const withDistance = hardFiltered.map((c) => {
    if (viewerHasLocation && c.latitude != null && c.longitude != null) {
      const distance_km = Math.round(haversineDistanceKm(viewer.latitude!, viewer.longitude!, c.latitude, c.longitude));
      return { ...c, distance_km };
    }
    return { ...c, distance_km: null as number | null };
  });

  const withinRadius = viewerHasLocation
    ? withDistance.filter((c) => c.distance_km === null || c.distance_km <= radiusKm)
    : withDistance;

  const now = Date.now();
  const boosted = withinRadius.filter((c) => c.boosted_until && new Date(c.boosted_until).getTime() > now);
  const rest = withinRadius.filter((c) => !c.boosted_until || new Date(c.boosted_until).getTime() <= now);

  const weightedShuffle = <T extends Record<string, any>>(arr: T[]) => {
    if (arr.length === 0) return arr;

    const scored = arr.map((c) => ({ c, score: computeCompatibilityScore(c, { ...viewer, dealbreakers }) }));
    const minScore = Math.min(...scored.map((s) => s.score));
    const pool = scored.map((s) => ({ c: s.c, weight: s.score - minScore + 1 }));

    const result: T[] = [];
    while (pool.length > 0) {
      const totalWeight = pool.reduce((sum, p) => sum + p.weight, 0);
      let roll = Math.random() * totalWeight;
      let pickIndex = pool.length - 1;
      for (let i = 0; i < pool.length; i++) {
        roll -= pool[i].weight;
        if (roll <= 0) {
          pickIndex = i;
          break;
        }
      }
      result.push(pool[pickIndex].c);
      pool.splice(pickIndex, 1);
    }
    return result;
  };

  const prioritized = [...weightedShuffle(boosted), ...weightedShuffle(rest)].slice(0, 20);

  const strippedCandidates = prioritized.map(
    ({ boosted_until, latitude, longitude, gender, looking_for_gender, relationship_type, dating_intentions, ...profileFields }) =>
      profileFields,
  );

  const withPhotosAndAudio = await attachPhotosAndAudio(strippedCandidates);

  return { candidates: withComputedAges(withPhotosAndAudio), error: null };
}

router.get("/discover/queue", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { candidates, error } = await buildDiscoverQueue(userId);

  if (error) {
    res.status(500).json({ error: "Failed to load discover queue" });
    return;
  }

  res.json({ candidates });
});

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

router.post("/discover/reshuffle", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const { currentQueueIds } = req.body as { currentQueueIds?: unknown };
  const validCurrentQueueIds = Array.isArray(currentQueueIds)
    ? currentQueueIds.filter((id): id is string => typeof id === "string" && UUID_RE.test(id))
    : [];

  const { data: profile } = await supabase
    .from("profiles")
    .select("last_free_reshuffle_at")
    .eq("id", userId)
    .single();

  const lastFree = profile?.last_free_reshuffle_at ? new Date(profile.last_free_reshuffle_at) : null;
  const isFree = !lastFree || Date.now() - lastFree.getTime() >= RESHUFFLE_FREE_INTERVAL_MS;

  const { cost_reshuffle } = await getEconomyConfig();

  if (isFree) {
    const { error: freeMarkerError } = await supabase
      .from("profiles")
      .update({ last_free_reshuffle_at: new Date().toISOString() })
      .eq("id", userId);
    if (freeMarkerError) {
      res.status(500).json({ error: "Failed to record free reshuffle" });
      return;
    }
  } else {
    const spend = await spendSparks(userId, cost_reshuffle, "Discover reshuffle");
    if (!spend.success) {
      res.status(400).json({ error: "Not enough Sparks to reshuffle" });
      return;
    }
  }

  const { candidates, error } = await buildDiscoverQueue(userId, validCurrentQueueIds);
  if (error) {
    res.status(500).json({ error: "Failed to reshuffle" });
    return;
  }

  res.json({ candidates, wasFree: isFree, cost: cost_reshuffle });
});

/** Creates a match between two users — idempotent, returns the existing
 *  match if one's already there (e.g. a race between two near-
 *  simultaneous requests). If either person's swipe toward the other
 *  carried an attached message_content — a "message before match"
 *  invite (see POST /discover/message-request) — that text becomes the
 *  match's opening message rather than being lost, inserted in
 *  chronological order if BOTH sides happen to have one (the rare
 *  crossed-invites case: each person messaged the other before either
 *  had accepted). Shared by the normal swipe endpoint (accepting a
 *  message-invite through Invites goes through there) and
 *  message-request itself (the crossed-invites case, where the target
 *  had already invited first). */
async function createMatchWithAnyPendingMessages(
  userId: string,
  targetId: string,
): Promise<{ id: string } | null> {
  const [lo, hi] = [userId, targetId].sort();

  const { data: existingMatch } = await supabase
    .from("matches")
    .select("id")
    .eq("user1_id", lo)
    .eq("user2_id", hi)
    .maybeSingle();
  if (existingMatch) return existingMatch;

  // Same PGRST116 retry pattern used elsewhere in this file — a match
  // insert immediately followed by a read-back is exactly the kind of
  // operation that's previously hit transient connection-consistency
  // lag.
  let match: { id: string } | null = null;
  let matchError: { code?: string } | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await supabase.from("matches").insert({ user1_id: lo, user2_id: hi }).select("id").single();
    if (result.data) {
      match = result.data;
      matchError = null;
      break;
    }
    matchError = result.error;
    if (attempt === 0 && result.error?.code === "PGRST116") {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (matchError?.code === "23505") {
    // A concurrent request beat us to it — fetch what it created rather
    // than treating this as a failure.
    const { data: raceMatch } = await supabase.from("matches").select("id").eq("user1_id", lo).eq("user2_id", hi).maybeSingle();
    match = raceMatch ?? null;
  }
  if (!match) return null;

  const [{ data: mySwipe }, { data: theirSwipe }] = await Promise.all([
    supabase.from("swipes").select("message_content, created_at").eq("swiper_id", userId).eq("target_id", targetId).maybeSingle(),
    supabase.from("swipes").select("message_content, created_at").eq("swiper_id", targetId).eq("target_id", userId).maybeSingle(),
  ]);

  const pendingMessages: { sender_id: string; content: string; created_at: string }[] = [];
  if (mySwipe?.message_content) {
    pendingMessages.push({ sender_id: userId, content: mySwipe.message_content, created_at: mySwipe.created_at });
  }
  if (theirSwipe?.message_content) {
    pendingMessages.push({ sender_id: targetId, content: theirSwipe.message_content, created_at: theirSwipe.created_at });
  }
  pendingMessages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  if (pendingMessages.length > 0) {
    await supabase
      .from("messages")
      .insert(pendingMessages.map((m) => ({ match_id: match!.id, sender_id: m.sender_id, content: m.content })));
    await supabase.from("matches").update({ message_count: pendingMessages.length }).eq("id", match.id);
  }

  return match;
}

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

  let inviteBalanceAfter: number | null = null;
  if (direction === "like" && !skipInviteQuota) {
    const quota = await consumeFreeInviteOrCharge(userId, clientTimezone);
    if (!quota.success) {
      res.status(402).json({ error: "Insufficient Sparks for an extra invite today", balance: quota.balance });
      return;
    }
    inviteBalanceAfter = quota.balance;
  }

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

  const { data: reverseSwipe } = await supabase
    .from("swipes")
    .select("id")
    .eq("swiper_id", targetId)
    .eq("target_id", userId)
    .in("direction", ["like", "super_like"])
    .maybeSingle();

  // Handles both a genuinely new match AND the "accepting a message-
  // before-match invite" case — if the target's earlier swipe carried a
  // message_content, createMatchWithAnyPendingMessages inserts it as
  // this match's opening message automatically.
  const match = reverseSwipe ? await createMatchWithAnyPendingMessages(userId, targetId) : null;

  res.json({ matched: !!match, matchId: match?.id ?? null, sparksCharged: inviteBalanceAfter !== null });
});

router.post("/discover/undo", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { targetId } = req.body as { targetId?: string };

  if (!targetId) {
    res.status(400).json({ error: "No swipe to undo" });
    return;
  }

  const { data: lastSwipe } = await supabase
    .from("swipes")
    .select("*")
    .eq("swiper_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lastSwipe || lastSwipe.target_id !== targetId) {
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
    .select("id, name, age, birthday, bio, city, photo_url, personality_tags, integrity_score, is_verified, photo_verified, is_founder, num_kids, family_plans, smoking_status, drinking_status")
    .eq("id", lastSwipe.target_id)
    .single();

  const [restoredWithPhotos] = restoredProfile ? await attachPhotoGalleries([restoredProfile]) : [null];
  const [restoredWithAudio] = restoredWithPhotos ? await attachAudioPrompts([restoredWithPhotos]) : [null];

  res.json({ restoredProfile: restoredWithAudio ? withComputedAge(restoredWithAudio) : null, balance: spend.balance });
});

/** GET /api/discover/invites — FREE. Returns people who already invited
 *  this user and haven't matched yet. */
router.get("/discover/invites", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const pendingInviters = await getPendingInviterIds(userId);
  const pendingInviterIds = pendingInviters.map((p) => p.id);

  if (pendingInviterIds.length === 0) {
    res.json({ revealed: [], new_count: 0 });
    return;
  }

  // If this specific query fails, do NOT silently proceed as if the
  // user has revealed nothing — that inflates the badge/new_count to
  // include people already paid-for and dealt with in a past session.
  // Failing loudly here means the frontend's silent catch-and-keep-
  // prior-value fallback kicks in instead of confidently displaying a
  // wrong, too-high number.
  const { data: alreadyRevealed, error: revealedError } = await supabase
    .from("invite_reveals")
    .select("target_id")
    .eq("user_id", userId)
    .in("target_id", pendingInviterIds);

  if (revealedError) {
    console.error(`INVITES DEBUG [GET /discover/invites] ${new Date().toISOString()} userId=${userId} invite_reveals READ FAILED: ${revealedError.message}`);
    res.status(500).json({ error: "Failed to load invite reveal status" });
    return;
  }

  const revealedIds = new Set((alreadyRevealed ?? []).map((r) => r.target_id));
  const revealedPendingIds = pendingInviterIds.filter((id) => revealedIds.has(id));
  const newCount = pendingInviterIds.length - revealedPendingIds.length;

  console.error(
    `INVITES DEBUG [GET /discover/invites] ${new Date().toISOString()} userId=${userId} pendingInviterIds=[${pendingInviterIds.join(",")}] revealedIds=[${[...revealedIds].join(",")}] revealedPendingIds=[${revealedPendingIds.join(",")}] new_count=${newCount}`,
  );

  if (revealedPendingIds.length === 0) {
    res.json({ revealed: [], new_count: newCount });
    return;
  }

  const { data: revealedProfiles } = await supabase
    .from("profiles")
    .select("id, name, age, birthday, bio, city, photo_url, personality_tags, integrity_score, is_verified, photo_verified, is_founder, num_kids, family_plans, smoking_status, drinking_status, latitude, longitude")
    .in("id", revealedPendingIds);

  const superLikerIds = new Set(
    pendingInviters.filter((p) => p.direction === "super_like").map((p) => p.id),
  );
  const messageById = new Map(pendingInviters.map((p) => [p.id, p.message_content]));
  const enriched = (revealedProfiles ?? []).map((p) => ({
    ...p,
    super_liked: superLikerIds.has(p.id),
    message_content: messageById.get(p.id) ?? null,
  }));
  const withDistance = await attachDistances(userId, enriched);
  const withPhotosAndAudio = await attachPhotosAndAudio(withDistance);

  res.json({ revealed: withComputedAges(withPhotosAndAudio), new_count: newCount });
});

/** POST /api/discover/invites/reveal — PAID (30 Sparks), but ONLY if
 *  there's at least one genuinely new inviter since the last reveal. */
router.post("/discover/invites/reveal", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const pendingInviters = await getPendingInviterIds(userId);
  const pendingInviterIds = pendingInviters.map((p) => p.id);

  if (pendingInviterIds.length === 0) {
    res.json({ invites: [], balance: null });
    return;
  }

  // Same reasoning as the GET handler above — a failed query here must
  // not be silently treated as "nothing revealed", since that would
  // wrongly set hasNew=true and charge Sparks for revealing invites the
  // user has already paid for.
  const { data: alreadyRevealed, error: revealedError } = await supabase
    .from("invite_reveals")
    .select("target_id")
    .eq("user_id", userId)
    .in("target_id", pendingInviterIds);

  if (revealedError) {
    console.error(`INVITES DEBUG [POST /discover/invites/reveal] ${new Date().toISOString()} userId=${userId} invite_reveals READ FAILED: ${revealedError.message}`);
    res.status(500).json({ error: "Failed to load invite reveal status" });
    return;
  }

  const revealedIds = new Set((alreadyRevealed ?? []).map((r) => r.target_id));
  const hasNew = pendingInviterIds.some((id) => !revealedIds.has(id));

  console.error(
    `INVITES DEBUG [POST /discover/invites/reveal] ${new Date().toISOString()} userId=${userId} pendingInviterIds=[${pendingInviterIds.join(",")}] revealedIds=[${[...revealedIds].join(",")}] hasNew=${hasNew}`,
  );

  let balance: number | null = null;

  if (hasNew) {
    const { cost_reveal_invites } = await getEconomyConfig();
    const spend = await spendSparks(userId, cost_reveal_invites, "See who invited you");
    if (!spend.success) {
      res.status(402).json({ error: `Insufficient Sparks (need ${cost_reveal_invites})`, balance: spend.balance });
      return;
    }
    balance = spend.balance;

    const rows = pendingInviterIds.map((targetId) => ({ user_id: userId, target_id: targetId }));
    await supabase.from("invite_reveals").upsert(rows, { onConflict: "user_id,target_id" });
  }

  const { data: inviters } = await supabase
    .from("profiles")
    .select("id, name, age, birthday, bio, city, photo_url, personality_tags, integrity_score, is_verified, photo_verified, is_founder, num_kids, family_plans, smoking_status, drinking_status, latitude, longitude")
    .in("id", pendingInviterIds);

  const superLikerIds = new Set(
    pendingInviters.filter((p) => p.direction === "super_like").map((p) => p.id),
  );
  const messageById = new Map(pendingInviters.map((p) => [p.id, p.message_content]));

  const enriched = (inviters ?? []).map((l) => ({
    ...l,
    super_liked: superLikerIds.has(l.id),
    message_content: messageById.get(l.id) ?? null,
  }));
  const withDistance = await attachDistances(userId, enriched);
  const withPhotosAndAudio = await attachPhotosAndAudio(withDistance);

  res.json({ invites: withComputedAges(withPhotosAndAudio), balance });
});

router.get("/discover/search", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { name, min_age, max_age, city, tags } = req.query as {
    name?: string;
    min_age?: string;
    max_age?: string;
    city?: string;
    tags?: string;
  };

  const { hardExcluded, pendingInvitedIds } = await getCandidateExclusionSets(userId);

  const isExplicitNameSearch = !!name && name.trim().length > 0;
  const excludedIds = isExplicitNameSearch ? hardExcluded : [...hardExcluded, ...pendingInvitedIds];
  const pendingInvitedSet = new Set(pendingInvitedIds);

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

  const effectiveMinAge = min_age ? Number(min_age) : viewer?.pref_age_min ?? 18;
  const effectiveMaxAge = max_age ? Number(max_age) : viewer?.pref_age_max ?? 99;

  let query = supabase
    .from("profiles")
    .select(
      "id, name, age, birthday, bio, city, photo_url, personality_tags, integrity_score, is_verified, photo_verified, is_founder, " +
        "gender, looking_for_gender, num_kids, family_plans, smoking_status, vaping_status, drinking_status, nightlife_frequency, has_tattoos, pets, activity_level, height_cm, " +
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

  const stripped = withinRadius.slice(0, 30).map(({ latitude, longitude, ...rest }) => ({
    ...rest,
    invite_pending: pendingInvitedSet.has(rest.id),
  }));

  const withPhotosAndAudio = await attachPhotosAndAudio(stripped);

  res.json({ results: withComputedAges(withPhotosAndAudio) });
});

router.get("/discover/categories", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const excludedIds = await getExcludedCandidateIds(userId);
  const excludeClause = `(${excludedIds.join(",")})`;
  const PREVIEW_FIELDS = "id, photo_url, birthday, age, gender, looking_for_gender, num_kids, family_plans, smoking_status, vaping_status, drinking_status, nightlife_frequency, has_tattoos, pets, activity_level";

  const { data: viewerProfile } = await supabase
    .from("profiles")
    .select(
      "city, personality_tags, gender, looking_for_gender, dealbreakers, pref_age_min, pref_age_max, " +
        "pref_num_kids, pref_family_plans, pref_smoking_status, pref_vaping_status, pref_drinking_status, pref_nightlife_frequency, pref_has_tattoos, pref_pets, pref_activity_level",
    )
    .eq("id", userId)
    .single();

  const dealbreakers: string[] = viewerProfile?.dealbreakers ?? [];
  const applyHardFilters = (candidates: any[]): { count: number; preview_photos: string[] } => {
    const filtered = candidates.filter((c) => {
      if (!genderSatisfiesPreference(c.gender, viewerProfile?.looking_for_gender)) return false;
      if (!genderSatisfiesPreference(viewerProfile?.gender, c.looking_for_gender)) return false;
      if (viewerProfile && !passesDealbreakers(c, viewerProfile, dealbreakers)) return false;
      const candidateAge = calculateAge(c.birthday ?? null) ?? c.age;
      if (!passesAgeRange(candidateAge, viewerProfile?.pref_age_min, viewerProfile?.pref_age_max)) return false;
      return true;
    });
    return {
      count: filtered.length,
      preview_photos: filtered.slice(0, 3).map((p) => p.photo_url).filter(Boolean),
    };
  };

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const categories: Array<{ key: string; label: string; count: number; preview_photos: string[] }> = [];

  {
    const { data } = await supabase
      .from("profiles")
      .select(PREVIEW_FIELDS)
      .not("id", "in", excludeClause)
      .eq("is_incognito", false)
      .gte("created_at", sevenDaysAgo)
      .limit(300);
    categories.push({ key: "new_here", label: "New Here", ...applyHardFilters(data ?? []) });
  }

  {
    const { data } = await supabase
      .from("profiles")
      .select(PREVIEW_FIELDS)
      .not("id", "in", excludeClause)
      .eq("is_incognito", false)
      .eq("is_verified", true)
      .limit(300);
    categories.push({ key: "verified", label: "Verified", ...applyHardFilters(data ?? []) });
  }

  {
    const { data: audioUserRows } = await supabase.from("audio_prompts").select("user_id");
    const audioUserIds = [...new Set((audioUserRows ?? []).map((r) => r.user_id))].filter(
      (id) => !excludedIds.includes(id),
    );
    let result = { count: 0, preview_photos: [] as string[] };
    if (audioUserIds.length > 0) {
      const { data } = await supabase
        .from("profiles")
        .select(PREVIEW_FIELDS)
        .in("id", audioUserIds)
        .eq("is_incognito", false);
      result = applyHardFilters(data ?? []);
    }
    categories.push({ key: "has_audio", label: "Audio Bios", ...result });
  }

  if (viewerProfile?.city) {
    const { data } = await supabase
      .from("profiles")
      .select(PREVIEW_FIELDS)
      .not("id", "in", excludeClause)
      .eq("is_incognito", false)
      .ilike("city", viewerProfile.city)
      .limit(300);
    categories.push({ key: "near_you", label: "Near You", ...applyHardFilters(data ?? []) });
  }

  {
    const { data } = await supabase
      .from("profiles")
      .select(PREVIEW_FIELDS)
      .not("id", "in", excludeClause)
      .eq("is_incognito", false)
      .limit(300);
    categories.push({ key: "matches_vibe", label: "Matches Your Vibe", ...applyHardFilters(data ?? []) });
  }

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
    const likedIds = [...countMap.keys()];
    let result = { count: 0, preview_photos: [] as string[] };
    if (likedIds.length > 0) {
      const { data } = await supabase
        .from("profiles")
        .select(PREVIEW_FIELDS)
        .in("id", likedIds)
        .eq("is_incognito", false);
      const sorted = (data ?? []).sort((a, b) => (countMap.get(b.id) ?? 0) - (countMap.get(a.id) ?? 0));
      result = applyHardFilters(sorted);
    }
    categories.push({ key: "popular", label: "Popular", ...result });
  }

  res.json({ categories });
});

router.get("/discover/categories/:key", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const key = Array.isArray(req.params.key) ? req.params.key[0] : req.params.key;

  const excludedIds = await getExcludedCandidateIds(userId);
  const excludeClause = `(${excludedIds.join(",")})`;
  const SELECT_FIELDS =
    "id, name, age, birthday, bio, city, photo_url, personality_tags, integrity_score, is_verified, photo_verified, is_founder, " +
    "gender, looking_for_gender, relationship_type, dating_intentions, " +
    "num_kids, family_plans, smoking_status, vaping_status, drinking_status, nightlife_frequency, has_tattoos, pets, activity_level, height_cm, " +
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
        results = topIds.map((id) => (data ?? []).find((p) => p.id === id)).filter(Boolean);
      }
      break;
    }
    default: {
      res.status(400).json({ error: "Unknown category" });
      return;
    }
  }

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
  const withPhotosAndAudio = await attachPhotosAndAudio(withDistance);

  res.json({ results: withComputedAges(withPhotosAndAudio) });
});

/** POST /api/discover/message-request — send an opening message to
 *  someone before matching (costs Sparks, admin-configurable). Treated
 *  as an invite with an attached message, exactly like a normal like —
 *  NOT an immediate match. The target sees it in their Received Invites
 *  with the message text attached, and can Accept (via the normal
 *  swipe/accept flow, which then surfaces this message as the match's
 *  opening line) or Decline it, same as any other invite. This
 *  deliberately replaced the previous behavior of creating a real match
 *  immediately, which put two people in a "match" neither had actually
 *  both agreed to — the target never confirmed anything, yet showed up
 *  in the sender's Matches list right away, and the resulting
 *  half-agreed-upon match caused real confusion (e.g. "match not found"
 *  errors once one side later interacted with a match the other side
 *  had never consciously accepted). */
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

  // The invite itself — same upsert shape as a normal like, just with
  // the message text riding along in message_content. onConflict means
  // re-sending (e.g. after editing) simply replaces the earlier draft
  // rather than erroring on the unique constraint.
  const { error: upsertError } = await supabase.from("swipes").upsert(
    {
      swiper_id: userId,
      target_id: targetId,
      direction: "like",
      message_content: content.trim(),
    },
    { onConflict: "swiper_id,target_id" },
  );

  if (upsertError) {
    res.status(500).json({ error: `Failed to send invite: ${upsertError.message}` });
    return;
  }

  // Crossed invites: the target had already invited (liked) this user
  // first, before this message was sent. That's a genuine mutual match
  // right now — createMatchWithAnyPendingMessages picks up this
  // message_content (and the target's, if they'd also attached one)
  // automatically as the opening message(s).
  const { data: reverseSwipe } = await supabase
    .from("swipes")
    .select("id")
    .eq("swiper_id", targetId)
    .eq("target_id", userId)
    .in("direction", ["like", "super_like"])
    .maybeSingle();

  const match = reverseSwipe ? await createMatchWithAnyPendingMessages(userId, targetId) : null;

  res.status(201).json({ matched: !!match, matchId: match?.id ?? null, balance: spend.balance });
});

router.get("/discover/invites/sent", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const { data: outgoingLikes } = await supabase
    .from("swipes")
    .select("target_id, direction, message_content")
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
    .select("id, name, age, birthday, bio, city, photo_url, personality_tags, integrity_score, is_verified, photo_verified, is_founder, num_kids, family_plans, smoking_status, drinking_status, latitude, longitude")
    .in("id", pendingSentIds);

  const superSentIds = new Set(
    (outgoingLikes ?? []).filter((l) => l.direction === "super_like").map((l) => l.target_id),
  );
  const messageByTargetId = new Map((outgoingLikes ?? []).map((l) => [l.target_id, l.message_content ?? null]));
  const enriched = (sentProfiles ?? []).map((p) => ({
    ...p,
    super_liked: superSentIds.has(p.id),
    message_content: messageByTargetId.get(p.id) ?? null,
  }));
  const withDistance = await attachDistances(userId, enriched);
  const withPhotosAndAudio = await attachPhotosAndAudio(withDistance);

  res.json({ sent: withComputedAges(withPhotosAndAudio) });
});

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