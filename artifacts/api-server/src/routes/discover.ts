import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { supabase } from "../lib/supabase";
import { spendSparks } from "../lib/sparks-helper";
import { attachPhotoGalleries } from "../lib/photo-galleries";
import { attachAudioPrompts } from "../lib/audio-prompts-helper";
import { withComputedAge, withComputedAges, calculateAge } from "../lib/age";
import { consumeFreeInviteOrCharge } from "../lib/invites-quota";
import { getExcludedCandidateIds, getPendingInviterIds, getCandidateExclusionSets, rememberRevealed, getStickyRevealed, rememberReshuffleTimestamp, getStickyReshuffleTimestamp, rememberMatched } from "../lib/discover-exclusions";
import { haversineDistanceKm } from "../lib/geo";
import { genderSatisfiesPreference, passesDealbreakers, passesAgeRange, computeCompatibilityScore, passesEnabledPreferenceFilters, passesHeightRange } from "../lib/matching";
import { getEconomyConfig } from "../lib/economy-config";

const router: IRouter = Router();

const RESHUFFLE_FREE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

// Shared between /discover/categories (preview counts) and
// /discover/categories/:key (actual results) — both must use the exact
// same radius for "Near You" or the tile's advertised count could
// disagree with what tapping into it actually shows.
const NEARBY_RADIUS_KM = 15;

// Fetches every admin-configurable preference-filter toggle in one
// query, keyed exactly by the settings-key strings matching.ts's
// PREFERENCE_FILTER_SETTINGS_KEYS/HEIGHT_FILTER_SETTINGS_KEY define —
// so passesEnabledPreferenceFilters/passesHeightRange can be handed
// this object directly with no translation step. Same app_settings
// table already powering incognito_enabled/dealbreakers_enabled; a
// missing/unset key correctly reads as `undefined`, which the filter
// functions already treat as "off", so a brand-new toggle nobody has
// touched yet defaults safely to disabled rather than needing a
// migration to seed a default value first.
async function getEnabledPreferenceFilters(): Promise<Record<string, boolean>> {
  const { data } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", [
      "filter_num_kids_enabled",
      "filter_family_plans_enabled",
      "filter_smoking_enabled",
      "filter_vaping_enabled",
      "filter_drinking_enabled",
      "filter_nightlife_enabled",
      "filter_tattoos_enabled",
      "filter_pets_enabled",
      "filter_activity_level_enabled",
      "filter_height_enabled",
    ]);
  return Object.fromEntries((data ?? []).map((row) => [row.key, row.value === true]));
}

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
  const [excludedFromHistory, { data: viewer }, enabledFilters] = await Promise.all([
    getExcludedCandidateIds(userId),
    supabase
      .from("profiles")
      .select(
        "latitude, longitude, distance_km, gender, looking_for_gender, relationship_type, dating_intentions, personality_tags, dealbreakers, " +
          "pref_age_min, pref_age_max, pref_height_min_cm, pref_height_max_cm, " +
          "pref_num_kids, pref_family_plans, pref_smoking_status, pref_vaping_status, pref_drinking_status, pref_nightlife_frequency, pref_has_tattoos, pref_pets, pref_activity_level",
      )
      .eq("id", userId)
      .single(),
    getEnabledPreferenceFilters(),
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
        "nightlife_frequency, has_tattoos, pets, activity_level, height_cm, education, languages_spoken, languages_other, love_language, latitude, longitude",
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
    if (!passesEnabledPreferenceFilters(c, viewer, enabledFilters)) return false;
    if (!passesHeightRange(c.height_cm, viewer.pref_height_min_cm, viewer.pref_height_max_cm, enabledFilters)) return false;
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

  // Previously this stripped `gender` and `relationship_type` out
  // entirely before sending to the frontend, along with the genuinely
  // internal-only fields below (looking_for_gender, which only ever
  // existed to power the hard-filter checks above, and
  // boosted_until/latitude/longitude, which are consumed earlier in
  // this function). That meant ProfileCard.tsx's existing gender
  // display code never received any data on the main Discover feed at
  // all, and the "Looking For" row had nothing to show, ever — not a
  // frontend bug, the data was simply never being sent. relationship_type
  // is renamed to looking_for here to match ProfileCardData's existing
  // prop name (which other pages, e.g. Search/Invites, may already
  // populate this way from their own separate queries).
  //
  // dating_intentions was ALSO being destructured away here and never
  // restored — unlike relationship_type, it wasn't even renamed to
  // something else, just silently discarded every time. ProfileCard's
  // "More About Me" section has working display code for this field
  // (added alongside love_language below), but the main Discover feed
  // specifically was never actually sending it, the same class of bug
  // as the gender/relationship_type one above, just missed at the time.
  const strippedCandidates = prioritized.map(
    ({ boosted_until, latitude, longitude, looking_for_gender, relationship_type, ...profileFields }) => ({
      ...profileFields,
      looking_for: relationship_type ?? null,
    }),
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

// Reads BOTH the fresh DB value and the sticky cache concurrently, and
// uses whichever is more recent — same reasoning as the matched/
// revealed caches in discover-exclusions.ts. A lagged DB read here
// (which happens especially easily on rapid consecutive reshuffle taps,
// only a second or two apart) must never be allowed to hide a more
// recent free-reshuffle timestamp this exact server already recorded a
// moment earlier, or it re-evaluates as free and skips the Sparks
// charge it should have applied.
async function getEffectiveLastFreeReshuffleAt(userId: string): Promise<Date | null> {
  const [{ data: profile }, stickyTimestamp] = await Promise.all([
    supabase.from("profiles").select("last_free_reshuffle_at").eq("id", userId).single(),
    getStickyReshuffleTimestamp(userId),
  ]);

  const dbMs = profile?.last_free_reshuffle_at ? new Date(profile.last_free_reshuffle_at).getTime() : 0;
  const stickyMs = stickyTimestamp ? new Date(stickyTimestamp).getTime() : 0;
  const effectiveMs = Math.max(dbMs, stickyMs);

  return effectiveMs > 0 ? new Date(effectiveMs) : null;
}

router.get("/discover/reshuffle-status", requireAuth, async (req, res): Promise<void> => {
  const lastFree = await getEffectiveLastFreeReshuffleAt(req.user!.id);
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

  const lastFree = await getEffectiveLastFreeReshuffleAt(userId);
  const isFree = !lastFree || Date.now() - lastFree.getTime() >= RESHUFFLE_FREE_INTERVAL_MS;

  const { cost_reshuffle } = await getEconomyConfig();

  if (isFree) {
    const nowIso = new Date().toISOString();
    const { error: freeMarkerError } = await supabase
      .from("profiles")
      .update({ last_free_reshuffle_at: nowIso })
      .eq("id", userId);
    if (freeMarkerError) {
      res.status(500).json({ error: "Failed to record free reshuffle" });
      return;
    }
    // Don't wait on a subsequent read to confirm what this request just
    // wrote itself — see getEffectiveLastFreeReshuffleAt and the
    // discover-exclusions.ts comment above rememberReshuffleTimestamp.
    // Awaited so it's guaranteed to land before this function returns,
    // which is what actually protects the very next rapid tap.
    await rememberReshuffleTimestamp(userId, nowIso);
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

// TEMPORARY DEBUG — see the "chat unlock still not sticking" investigation.
// Writes directly to a dedicated table rather than console.error, since
// log-based debugging in this specific investigation has repeatedly
// proven unreliable (a confirmed match-creating request showed zero
// console.error output at all in the Netlify log export, despite the
// code path that should have produced it). A DB row survives regardless
// of log export windows, Netlify buffering, or anything else in that
// pipeline. Safe to remove (along with the chat_unlock_debug_log table)
// once resolved.
async function debugLog(step: string, fields: Record<string, unknown>): Promise<void> {
  try {
    await supabase.from("chat_unlock_debug_log").insert({ step, ...fields });
  } catch {
    // Never let debug logging itself break the real request.
  }
}

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
  await debugLog("function_entered", { user_id: userId, target_id: targetId });

  const { data: existingMatch } = await supabase
    .from("matches")
    .select("id")
    .eq("user1_id", lo)
    .eq("user2_id", hi)
    .maybeSingle();
  if (existingMatch) {
    await debugLog("existing_match_early_return", { match_id: existingMatch.id, user_id: userId, target_id: targetId });
    return existingMatch;
  }

  // Checked BEFORE the insert below — this only reads the swipes table,
  // completely independent of the match row's own id, so there's no
  // reason it needs to wait until after the match exists. Doing this
  // first is what makes it possible to set chat_unlock_status directly
  // as part of the INSERT itself (see below) instead of via a separate,
  // follow-up UPDATE call.
  //
  // That earlier two-step approach (insert first with the column left
  // at its default, then a second UPDATE to 'locked' once pending
  // messages were known) had a genuine race window: between those two
  // calls, a concurrent request's OWN existingMatch check above could
  // find the row already inserted — still sitting at its 'unlocked'
  // database default — and return early with that stale value, never
  // reaching the follow-up UPDATE that would have corrected it. Debug
  // logging during the "chat unlock never engages" investigation
  // confirmed this precisely: a genuinely fresh, message-free mutual
  // match ended up 'unlocked' instead of 'locked', with the request
  // that logically should have set it never even reaching that code —
  // exactly what this race would produce. Setting the correct value in
  // the same INSERT that creates the row removes the window for this
  // race entirely: there is no longer a moment where the row exists
  // with a not-yet-correct value for another request to observe.
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

  // See chat-unlock-helper.ts for the full state machine this feeds
  // into. A pending pre-match message means someone already paid the
  // full cost_message_before_match fee (via POST /discover/message-request
  // or the swipe-with-message flow) — per the new economy, that single
  // payment covers BOTH sides permanently, so the chat opens fully
  // 'unlocked' immediately. A normal mutual match with no message
  // attached starts 'locked' instead — neither side has paid anything
  // yet, and the first message either of them sends is what starts the
  // 50/50 unlock process (see messages.ts's POST /matches/:matchId/messages).
  const initialChatUnlockStatus = pendingMessages.length > 0 ? "unlocked" : "locked";

  // TEMPORARY DEBUG — see the "chat unlock still not sticking" investigation.
  // Written directly into the SAME insert that creates the row (via the
  // debug_creation_info column below), rather than as a separate
  // debugLog() write. A prior version relied on debugLog for this exact
  // moment and it never showed up for the request that actually won the
  // insert race, even though the real matches row was created
  // successfully — meaning that separate, independent write silently
  // failed while the main insert succeeded. Embedding the diagnostic
  // payload in the same INSERT statement makes that failure mode
  // impossible: either both land together, or neither does. Safe to
  // remove (along with the debug_creation_info column) once resolved.
  const debugCreationInfo = {
    userId,
    targetId,
    mySwipeMessageContent: mySwipe?.message_content ?? null,
    theirSwipeMessageContent: theirSwipe?.message_content ?? null,
    pendingMessagesLength: pendingMessages.length,
    initialChatUnlockStatus,
    computedAt: new Date().toISOString(),
  };

  // Same PGRST116 retry pattern used elsewhere in this file — a match
  // insert immediately followed by a read-back is exactly the kind of
  // operation that's previously hit transient connection-consistency
  // lag.
  let match: { id: string } | null = null;
  let matchError: { code?: string } | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await supabase
      .from("matches")
      .insert({ user1_id: lo, user2_id: hi, chat_unlock_status: initialChatUnlockStatus, debug_creation_info: debugCreationInfo })
      .select("id, chat_unlock_status")
      .single();
    if (result.data) {
      match = result.data;
      matchError = null;
      await debugLog("insert_succeeded", {
        match_id: result.data.id,
        user_id: userId,
        target_id: targetId,
        detail: { persistedChatUnlockStatus: (result.data as any).chat_unlock_status },
      });
      break;
    }
    matchError = result.error;
    await debugLog("insert_attempt_failed", { user_id: userId, target_id: targetId, detail: { attempt, error: result.error } });
    if (attempt === 0 && result.error?.code === "PGRST116") {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (matchError?.code === "23505") {
    // A concurrent request beat us to it — fetch what it created rather
    // than treating this as a failure. That request's own INSERT would
    // have computed the same pendingMessages result we did (both read
    // the exact same underlying swipes rows), so its chat_unlock_status
    // is already correct — nothing further to set here.
    const { data: raceMatch } = await supabase.from("matches").select("id").eq("user1_id", lo).eq("user2_id", hi).maybeSingle();
    match = raceMatch ?? null;
    await debugLog("race_23505_fallback", { match_id: raceMatch?.id, user_id: userId, target_id: targetId });
  }
  if (!match) return null;

  // Seed the shared sticky-matched cache for both directions IMMEDIATELY
  // — not reactively, waiting for some future read to happen to
  // succeed and remember it. Production logs on 2026-08-24 showed this
  // gap concretely: a brand-new match had no prior successful read to
  // fall back on, so its very first checks (badge vs page, "match no
  // longer exists" on open) were fully exposed to the underlying read
  // inconsistency with zero protection — the cache could only ever
  // help *after* something had already gone right once. Since this
  // function is the one place that has definitive, first-hand
  // knowledge a match now exists (it just inserted the row, or
  // confirmed one already exists via the 23505 race-fallback above),
  // seeding here means even the very first read anyone does afterward
  // — for either party — already has ground truth to fall back on.
  await Promise.all([rememberMatched(userId, [targetId]), rememberMatched(targetId, [userId])]);

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

  // TEMPORARY DEBUG — see the "chat unlock still not sticking" investigation.
  await debugLog("swipe_endpoint_decision", { user_id: userId, target_id: targetId, detail: { reverseSwipeFound: !!reverseSwipe } });

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

  const { data: restoredProfileRaw } = await supabase
    .from("profiles")
    .select("id, name, age, birthday, bio, city, photo_url, personality_tags, integrity_score, is_verified, photo_verified, is_founder, num_kids, family_plans, smoking_status, drinking_status, vaping_status, has_tattoos, pets, activity_level, nightlife_frequency, height_cm, education, languages_spoken, languages_other, love_language, dating_intentions, relationship_type")
    .eq("id", lastSwipe.target_id)
    .single();

  // Same rename as buildDiscoverQueue — ProfileCardData only recognizes
  // `looking_for`, not the raw `relationship_type` column name.
  const restoredProfile = restoredProfileRaw
    ? (({ relationship_type, ...rest }) => ({ ...rest, looking_for: relationship_type ?? null }))(restoredProfileRaw)
    : null;

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

  // Same mitigation as the sticky-matched cache, now for invite_reveals
  // — see the comment above rememberRevealed/getStickyRevealed for the
  // production log evidence. Remember whatever this read genuinely
  // found, then union in anything remembered from a recent prior
  // read/write so a lagged read can't make an already-paid-for reveal
  // look new again. Both are independent DB calls, run concurrently.
  const [, stickyRevealed] = await Promise.all([
    rememberRevealed(userId, revealedIds),
    getStickyRevealed(userId),
  ]);
  const stickyRevealedAdditions: string[] = [];
  for (const targetId of stickyRevealed) {
    if (pendingInviterIds.includes(targetId) && !revealedIds.has(targetId)) {
      revealedIds.add(targetId);
      stickyRevealedAdditions.push(targetId);
    }
  }
  if (stickyRevealedAdditions.length > 0) {
    console.error(
      `INVITES DEBUG: sticky-revealed cache added [${stickyRevealedAdditions.join(",")}] for userId=${userId} — this read's own invite_reveals query missed them`,
    );
  }

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
    .select("id, name, age, birthday, bio, city, photo_url, personality_tags, integrity_score, is_verified, photo_verified, is_founder, num_kids, family_plans, smoking_status, drinking_status, vaping_status, has_tattoos, pets, activity_level, nightlife_frequency, height_cm, education, languages_spoken, languages_other, love_language, dating_intentions, relationship_type, latitude, longitude")
    .in("id", revealedPendingIds);

  const superLikerIds = new Set(
    pendingInviters.filter((p) => p.direction === "super_like").map((p) => p.id),
  );
  const messageById = new Map(pendingInviters.map((p) => [p.id, p.message_content]));
  // relationship_type renamed to looking_for — see the comment above
  // buildDiscoverQueue's own stripping step for why this rename exists.
  const enriched = (revealedProfiles ?? []).map(({ relationship_type, ...p }) => ({
    ...p,
    looking_for: relationship_type ?? null,
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

  // Same sticky-cache mitigation as the GET handler — see the comment
  // above rememberRevealed/getStickyRevealed. Without this, a lagged
  // read here can make hasNew wrongly true for someone already
  // revealed, charging Sparks again for nothing new.
  const [, stickyRevealedForReveal] = await Promise.all([
    rememberRevealed(userId, revealedIds),
    getStickyRevealed(userId),
  ]);
  const stickyRevealedAdditionsForReveal: string[] = [];
  for (const targetId of stickyRevealedForReveal) {
    if (pendingInviterIds.includes(targetId) && !revealedIds.has(targetId)) {
      revealedIds.add(targetId);
      stickyRevealedAdditionsForReveal.push(targetId);
    }
  }
  if (stickyRevealedAdditionsForReveal.length > 0) {
    console.error(
      `INVITES DEBUG: sticky-revealed cache added [${stickyRevealedAdditionsForReveal.join(",")}] for userId=${userId} — this read's own invite_reveals query missed them`,
    );
  }

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
    // Don't wait on a subsequent read to confirm what this request just
    // wrote itself — see the sticky-revealed comment above. Awaited so
    // it's guaranteed to land before this function (and the underlying
    // serverless instance) finishes handling the response.
    await rememberRevealed(userId, pendingInviterIds);
  }

  const { data: inviters } = await supabase
    .from("profiles")
    .select("id, name, age, birthday, bio, city, photo_url, personality_tags, integrity_score, is_verified, photo_verified, is_founder, num_kids, family_plans, smoking_status, drinking_status, vaping_status, has_tattoos, pets, activity_level, nightlife_frequency, height_cm, education, languages_spoken, languages_other, love_language, dating_intentions, relationship_type, latitude, longitude")
    .in("id", pendingInviterIds);

  const superLikerIds = new Set(
    pendingInviters.filter((p) => p.direction === "super_like").map((p) => p.id),
  );
  const messageById = new Map(pendingInviters.map((p) => [p.id, p.message_content]));

  const enriched = (inviters ?? []).map(({ relationship_type, ...l }) => ({
    ...l,
    looking_for: relationship_type ?? null,
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

  const [{ data: viewer }, enabledFilters] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "latitude, longitude, distance_km, gender, looking_for_gender, dealbreakers, pref_age_min, pref_age_max, pref_height_min_cm, pref_height_max_cm, " +
          "pref_num_kids, pref_family_plans, pref_smoking_status, pref_vaping_status, pref_drinking_status, pref_nightlife_frequency, pref_has_tattoos, pref_pets, pref_activity_level",
      )
      .eq("id", userId)
      .single(),
    getEnabledPreferenceFilters(),
  ]);
  const viewerHasLocation = viewer?.latitude != null && viewer?.longitude != null;
  const radiusKm = viewer?.distance_km ?? 25;
  const dealbreakers: string[] = viewer?.dealbreakers ?? [];

  const effectiveMinAge = min_age ? Number(min_age) : viewer?.pref_age_min ?? 18;
  const effectiveMaxAge = max_age ? Number(max_age) : viewer?.pref_age_max ?? 99;

  let query = supabase
    .from("profiles")
    .select(
      "id, name, age, birthday, bio, city, photo_url, personality_tags, integrity_score, is_verified, photo_verified, is_founder, " +
        "gender, looking_for_gender, relationship_type, dating_intentions, num_kids, family_plans, smoking_status, vaping_status, drinking_status, nightlife_frequency, has_tattoos, pets, activity_level, height_cm, " +
        "education, languages_spoken, languages_other, love_language, latitude, longitude",
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
    if (viewer && !passesEnabledPreferenceFilters(c, viewer, enabledFilters)) return false;
    if (viewer && !passesHeightRange(c.height_cm, viewer.pref_height_min_cm, viewer.pref_height_max_cm, enabledFilters)) return false;
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

  const stripped = withinRadius.slice(0, 30).map(({ latitude, longitude, relationship_type, ...rest }) => ({
    ...rest,
    looking_for: relationship_type ?? null,
    invite_pending: pendingInvitedSet.has(rest.id),
  }));

  const withPhotosAndAudio = await attachPhotosAndAudio(stripped);

  res.json({ results: withComputedAges(withPhotosAndAudio) });
});

router.get("/discover/categories", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const excludedIds = await getExcludedCandidateIds(userId);
  const excludeClause = `(${excludedIds.join(",")})`;
  // Added latitude/longitude (Near You needs real distance, not a city
  // string match — see below), relationship_type/dating_intentions/
  // personality_tags (computeCompatibilityScore needs these on the
  // CANDIDATE side to produce a meaningful score at all — without them,
  // "Matches Your Vibe" was silently scoring everyone as if they had
  // none of these set, which is a real but different bug from the
  // preview-sorting one described below).
  const PREVIEW_FIELDS =
    "id, photo_url, birthday, age, gender, looking_for_gender, num_kids, family_plans, smoking_status, vaping_status, drinking_status, " +
    "nightlife_frequency, has_tattoos, pets, activity_level, height_cm, latitude, longitude, relationship_type, dating_intentions, personality_tags";

  // NEARBY_RADIUS_KM (module-level, above) is deliberately smaller than
  // the viewer's own overall search radius (distance_km, used everywhere
  // else) — "Near You" is meant to be a meaningfully tighter subset
  // ("genuinely close by"), not just a restatement of the same pool the
  // main Discover feed already searches.

  const [{ data: viewerProfile }, enabledFilters] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "personality_tags, gender, looking_for_gender, relationship_type, dating_intentions, dealbreakers, " +
          "latitude, longitude, pref_age_min, pref_age_max, pref_height_min_cm, pref_height_max_cm, " +
          "pref_num_kids, pref_family_plans, pref_smoking_status, pref_vaping_status, pref_drinking_status, pref_nightlife_frequency, pref_has_tattoos, pref_pets, pref_activity_level",
      )
      .eq("id", userId)
      .single(),
    getEnabledPreferenceFilters(),
  ]);

  const dealbreakers: string[] = viewerProfile?.dealbreakers ?? [];
  const applyHardFilters = (candidates: any[]): { count: number; preview_photos: string[] } => {
    const filtered = candidates.filter((c) => {
      if (!genderSatisfiesPreference(c.gender, viewerProfile?.looking_for_gender)) return false;
      if (!genderSatisfiesPreference(viewerProfile?.gender, c.looking_for_gender)) return false;
      if (viewerProfile && !passesDealbreakers(c, viewerProfile, dealbreakers)) return false;
      if (viewerProfile && !passesEnabledPreferenceFilters(c, viewerProfile, enabledFilters)) return false;
      if (viewerProfile && !passesHeightRange(c.height_cm, viewerProfile.pref_height_min_cm, viewerProfile.pref_height_max_cm, enabledFilters)) return false;
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

  // Previously used .ilike("city", viewerProfile.city) — an exact
  // (case-insensitive) match on whatever free-text string each person
  // typed as their city during onboarding. That's a same-city-name
  // filter, not a distance filter: someone genuinely 2km away who typed
  // a different city name for their own suburb would never show up
  // here, while someone on the opposite side of a large metro area who
  // happened to type the identical city string would. Now computes real
  // distance via the same haversineDistanceKm already used for the main
  // Discover feed's own radius filter, against a fixed, deliberately
  // tighter NEARBY_RADIUS_KM. Requires the viewer to actually have a
  // recorded location — same as the old version requiring a non-empty
  // city string, this category simply doesn't appear for someone
  // location hasn't been captured for yet.
  if (viewerProfile?.latitude != null && viewerProfile?.longitude != null) {
    const { data } = await supabase
      .from("profiles")
      .select(PREVIEW_FIELDS)
      .not("id", "in", excludeClause)
      .eq("is_incognito", false)
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .limit(500);
    const nearby = (data ?? []).filter(
      (c) =>
        haversineDistanceKm(viewerProfile.latitude!, viewerProfile.longitude!, c.latitude, c.longitude) <=
        NEARBY_RADIUS_KM,
    );
    categories.push({ key: "near_you", label: "Near You", ...applyHardFilters(nearby) });
  }

  {
    // Sorted by actual compatibility score before hard-filtering, so the
    // 3 preview photos shown on this category's own tile are genuinely
    // the top vibe matches — not an arbitrary, unsorted slice of
    // whichever 300 rows the database happened to return first. This
    // previously called applyHardFilters directly on the raw unsorted
    // fetch, meaning the ACTUAL results (opened via /categories/matches_vibe,
    // which already sorted correctly) could look completely different
    // from the preview teaser advertising them.
    const { data } = await supabase
      .from("profiles")
      .select(PREVIEW_FIELDS)
      .not("id", "in", excludeClause)
      .eq("is_incognito", false)
      .limit(300);
    const sorted = (data ?? [])
      .map((c) => ({ c, score: viewerProfile ? computeCompatibilityScore(c, { ...viewerProfile, dealbreakers }) : 0 }))
      .sort((a, b) => b.score - a.score)
      .map((s) => s.c);
    categories.push({ key: "matches_vibe", label: "Matches Your Vibe", ...applyHardFilters(sorted) });
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

  // Relationship-type categories — deliberately only the 3 most
  // targeted, intentional search categories out of the 5 total
  // RELATIONSHIP_TYPES values. "Open to anything" and "Figuring it out"
  // are catch-all/uncertain answers rather than a specific thing
  // someone would actively filter FOR, so they're left out here (the
  // values themselves are unaffected — anyone who selected them is
  // still fully visible everywhere else, including the other
  // categories and the main Discover feed).
  {
    const RELATIONSHIP_CATEGORY_DEFS: { key: string; label: string; value: string }[] = [
      { key: "rel_long_term", label: "Long-term", value: "long_term" },
      { key: "rel_short_term", label: "Short-term", value: "short_term" },
      { key: "rel_friendship", label: "Friendship", value: "friendship" },
    ];
    const { data } = await supabase
      .from("profiles")
      .select(PREVIEW_FIELDS)
      .not("id", "in", excludeClause)
      .eq("is_incognito", false)
      .in(
        "relationship_type",
        RELATIONSHIP_CATEGORY_DEFS.map((d) => d.value),
      )
      .limit(500);
    for (const def of RELATIONSHIP_CATEGORY_DEFS) {
      const matching = (data ?? []).filter((c) => c.relationship_type === def.value);
      categories.push({ key: def.key, label: def.label, ...applyHardFilters(matching) });
    }
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
    "education, languages_spoken, languages_other, love_language, latitude, longitude";

  const [{ data: viewerProfile }, enabledFilters] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "city, latitude, longitude, personality_tags, gender, looking_for_gender, relationship_type, dating_intentions, dealbreakers, " +
          "pref_age_min, pref_age_max, pref_height_min_cm, pref_height_max_cm, " +
          "pref_num_kids, pref_family_plans, pref_smoking_status, pref_vaping_status, pref_drinking_status, pref_nightlife_frequency, pref_has_tattoos, pref_pets, pref_activity_level",
      )
      .eq("id", userId)
      .single(),
    getEnabledPreferenceFilters(),
  ]);

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
      // Same distance-based fix as the overview endpoint's preview count
      // above — was .ilike("city", viewerProfile.city), a same-city-name
      // string match rather than actual proximity. Now uses the same
      // haversineDistanceKm + NEARBY_RADIUS_KM as the preview count, so
      // what's advertised on the tile matches what tapping into it
      // actually shows.
      if (viewerProfile?.latitude != null && viewerProfile?.longitude != null) {
        const { data } = await supabase
          .from("profiles")
          .select(SELECT_FIELDS)
          .not("id", "in", excludeClause)
          .eq("is_incognito", false)
          .not("latitude", "is", null)
          .not("longitude", "is", null)
          .limit(500);
        results = (data ?? [])
          .filter(
            (c) =>
              haversineDistanceKm(viewerProfile.latitude!, viewerProfile.longitude!, c.latitude, c.longitude) <=
              NEARBY_RADIUS_KM,
          )
          .slice(0, 30);
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
    // Relationship-type categories — same 3-of-5 selection and reasoning
    // as the overview endpoint above ("Open to anything" and "Figuring
    // it out" are catch-all answers, not something someone actively
    // filters FOR). Kept as one case per value rather than a single
    // parameterized case, since RELATIONSHIP_TYPES' actual value strings
    // are the simplest, least-error-prone way to keep this in sync with
    // the category keys the overview endpoint already generates
    // (rel_long_term/rel_short_term/rel_friendship) — a mismatch here
    // would mean the tile's preview count and its actual results
    // silently disagree.
    case "rel_long_term":
    case "rel_short_term":
    case "rel_friendship": {
      const relationshipValue = key === "rel_long_term" ? "long_term" : key === "rel_short_term" ? "short_term" : "friendship";
      const { data } = await supabase
        .from("profiles")
        .select(SELECT_FIELDS)
        .not("id", "in", excludeClause)
        .eq("is_incognito", false)
        .eq("relationship_type", relationshipValue)
        .limit(30);
      results = data ?? [];
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
      if (!passesEnabledPreferenceFilters(c, viewerProfile, enabledFilters)) return false;
      if (!passesHeightRange(c.height_cm, viewerProfile.pref_height_min_cm, viewerProfile.pref_height_max_cm, enabledFilters)) return false;
      const candidateAge = calculateAge(c.birthday ?? null) ?? c.age;
      if (!passesAgeRange(candidateAge, viewerProfile.pref_age_min, viewerProfile.pref_age_max)) return false;
      return true;
    });
  }

  // Rename relationship_type -> looking_for — same reason as
  // buildDiscoverQueue's stripping step: ProfileCardData only
  // recognizes `looking_for`, so this endpoint's results previously had
  // the correct data fetched but under a field name the card never
  // reads, making "Looking For" silently show nothing for anyone
  // browsed via Search's Explore categories.
  const renamed = results.map(({ relationship_type, ...rest }) => ({ ...rest, looking_for: relationship_type ?? null }));

  const withDistance = await attachDistances(userId, renamed);
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
    .select("id, name, age, birthday, bio, city, photo_url, personality_tags, integrity_score, is_verified, photo_verified, is_founder, num_kids, family_plans, smoking_status, drinking_status, vaping_status, has_tattoos, pets, activity_level, nightlife_frequency, height_cm, education, languages_spoken, languages_other, love_language, dating_intentions, relationship_type, latitude, longitude")
    .in("id", pendingSentIds);

  const superSentIds = new Set(
    (outgoingLikes ?? []).filter((l) => l.direction === "super_like").map((l) => l.target_id),
  );
  const messageByTargetId = new Map((outgoingLikes ?? []).map((l) => [l.target_id, l.message_content ?? null]));
  const enriched = (sentProfiles ?? []).map(({ relationship_type, ...p }) => ({
    ...p,
    looking_for: relationship_type ?? null,
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