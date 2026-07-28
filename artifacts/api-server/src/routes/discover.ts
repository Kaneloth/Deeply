import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { supabase } from "../lib/supabase";
import { spendSparks } from "../lib/sparks-helper";
import { attachPhotoGalleries } from "../lib/photo-galleries";
import { withComputedAge, withComputedAges } from "../lib/age";

const router: IRouter = Router();

const SUPER_LIKE_COST = 20;
const UNDO_COST = 10;
const REVEAL_LIKES_COST = 30;
const MESSAGE_REQUEST_COST = 30;

/** GET /api/discover/queue — return a batch of candidate profiles the user
 *  hasn't swiped on yet, ready to swipe through Tinder-style. */
router.get("/discover/queue", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const { data: alreadySwiped } = await supabase
    .from("swipes")
    .select("target_id")
    .eq("swiper_id", userId);

  const excludedIds = [userId, ...(alreadySwiped?.map((s) => s.target_id) ?? [])];

  // Fetch a larger pool than we'll return, so we can prioritize active
  // boosts before trimming down to the final page size.
  const { data: candidates, error } = await supabase
    .from("profiles")
    .select("id, name, age, birthday, bio, city, photo_url, personality_tags, integrity_score, boosted_until, num_kids, family_plans, smoking_status, drinking_status")
    .not("id", "in", `(${excludedIds.join(",")})`)
    .limit(60);

  if (error) {
    res.status(500).json({ error: "Failed to load discover queue" });
    return;
  }

  if (!candidates || candidates.length === 0) {
    res.json({ candidates: [] });
    return;
  }

  const now = Date.now();
  const boosted = candidates.filter((c) => c.boosted_until && new Date(c.boosted_until).getTime() > now);
  const rest = candidates.filter((c) => !c.boosted_until || new Date(c.boosted_until).getTime() <= now);

  // Shuffle each group independently so it's not always the same order,
  // then boosted profiles first.
  const shuffle = <T,>(arr: T[]) => arr.sort(() => Math.random() - 0.5);
  const prioritized = [...shuffle(boosted), ...shuffle(rest)].slice(0, 20);

  const strippedCandidates = prioritized.map(({ boosted_until, ...profileFields }) => profileFields);

  const candidateIds = strippedCandidates.map((c) => c.id);
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

  const enriched = strippedCandidates.map((c) => ({
    ...c,
    audio_prompts: promptsByUser.get(c.id) ?? [],
  }));

  const withPhotos = await attachPhotoGalleries(enriched);

  res.json({ candidates: withComputedAges(withPhotos) });
});

/** POST /api/discover/swipe — record a like / pass / super_like and report
 *  back whether it created a mutual match. Super Like costs Sparks. */
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

  if (direction === "super_like") {
    const spend = await spendSparks(userId, SUPER_LIKE_COST, "Super Like");
    if (!spend.success) {
      res.status(402).json({ error: `Insufficient Sparks (need ${SUPER_LIKE_COST})`, balance: spend.balance });
      return;
    }
  }

  const { error: insertError } = await supabase.from("swipes").insert({
    swiper_id: userId,
    target_id: targetId,
    direction,
  });

  if (insertError) {
    if (insertError.code === "23505") {
      res.status(409).json({ error: "You've already swiped on this profile" });
      return;
    }
    res.status(500).json({ error: `Failed to record swipe: ${insertError.message}` });
    return;
  }

  if (direction === "pass") {
    res.json({ matched: false });
    return;
  }

  const [lo, hi] = [userId, targetId].sort();
  const { data: match } = await supabase
    .from("matches")
    .select("id")
    .eq("user1_id", lo)
    .eq("user2_id", hi)
    .maybeSingle();

  res.json({ matched: !!match, matchId: match?.id ?? null });
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

  const spend = await spendSparks(userId, UNDO_COST, "Undo swipe");
  if (!spend.success) {
    res.status(402).json({ error: `Insufficient Sparks (need ${UNDO_COST})`, balance: spend.balance });
    return;
  }

  await supabase.from("swipes").delete().eq("id", lastSwipe.id);

  const { data: restoredProfile } = await supabase
    .from("profiles")
    .select("id, name, age, birthday, bio, city, photo_url, personality_tags, integrity_score, num_kids, family_plans, smoking_status, drinking_status")
    .eq("id", lastSwipe.target_id)
    .single();

  const [restoredWithPhotos] = restoredProfile ? await attachPhotoGalleries([restoredProfile]) : [null];

  res.json({ restoredProfile: restoredWithPhotos ? withComputedAge(restoredWithPhotos) : null, balance: spend.balance });
});

/** GET /api/discover/invites — FREE. Returns people who already invited
 *  this user and haven't matched yet, split into:
 *  - revealed: profiles this user already paid to see (free forever now)
 *  - new_count: how many additional pending inviters haven't been
 *    revealed yet (still requires a paid reveal) */
router.get("/discover/invites", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const { data: incomingLikes } = await supabase
    .from("swipes")
    .select("swiper_id, direction")
    .eq("target_id", userId)
    .in("direction", ["like", "super_like"]);

  const inviterIds = incomingLikes?.map((l) => l.swiper_id) ?? [];

  if (inviterIds.length === 0) {
    res.json({ revealed: [], new_count: 0 });
    return;
  }

  const { data: existingMatches } = await supabase
    .from("matches")
    .select("user1_id, user2_id")
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`);

  const matchedIds = new Set(
    (existingMatches ?? []).map((m) => (m.user1_id === userId ? m.user2_id : m.user1_id)),
  );

  // Also exclude anyone the user has already swiped on themselves —
  // accepting or declining an invite is a decision that shouldn't keep
  // reappearing even if it didn't result in a match.
  const { data: myOwnSwipes } = await supabase
    .from("swipes")
    .select("target_id")
    .eq("swiper_id", userId);

  const alreadyDecidedIds = new Set((myOwnSwipes ?? []).map((s) => s.target_id));

  const pendingInviterIds = inviterIds.filter((id) => !matchedIds.has(id) && !alreadyDecidedIds.has(id));

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
    .select("id, name, age, birthday, bio, city, photo_url, personality_tags, integrity_score, num_kids, family_plans, smoking_status, drinking_status")
    .in("id", revealedPendingIds);

  const superLikerIds = new Set(
    (incomingLikes ?? []).filter((l) => l.direction === "super_like").map((l) => l.swiper_id),
  );
  const enriched = (revealedProfiles ?? []).map((p) => ({ ...p, super_liked: superLikerIds.has(p.id) }));
  const enrichedWithPhotos = await attachPhotoGalleries(enriched);

  res.json({ revealed: withComputedAges(enrichedWithPhotos), new_count: newCount });
});

/** POST /api/discover/invites/reveal — PAID (30 Sparks), but ONLY if
 *  there's at least one genuinely new inviter since the last reveal.
 *  Already-revealed people never cost Sparks again. Returns the full
 *  updated list of everyone pending (previously revealed + newly
 *  revealed). */
router.post("/discover/invites/reveal", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const { data: incomingLikes } = await supabase
    .from("swipes")
    .select("swiper_id, direction")
    .eq("target_id", userId)
    .in("direction", ["like", "super_like"]);

  const inviterIds = incomingLikes?.map((l) => l.swiper_id) ?? [];

  const { data: existingMatches } = await supabase
    .from("matches")
    .select("user1_id, user2_id")
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`);

  const matchedIds = new Set(
    (existingMatches ?? []).map((m) => (m.user1_id === userId ? m.user2_id : m.user1_id)),
  );

  const { data: myOwnSwipes } = await supabase
    .from("swipes")
    .select("target_id")
    .eq("swiper_id", userId);

  const alreadyDecidedIds = new Set((myOwnSwipes ?? []).map((s) => s.target_id));

  const pendingInviterIds = inviterIds.filter((id) => !matchedIds.has(id) && !alreadyDecidedIds.has(id));

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
    const spend = await spendSparks(userId, REVEAL_LIKES_COST, "See who invited you");
    if (!spend.success) {
      res.status(402).json({ error: `Insufficient Sparks (need ${REVEAL_LIKES_COST})`, balance: spend.balance });
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
    .select("id, name, age, birthday, bio, city, photo_url, personality_tags, integrity_score, num_kids, family_plans, smoking_status, drinking_status")
    .in("id", pendingInviterIds);

  const superLikerIds = new Set(
    (incomingLikes ?? []).filter((l) => l.direction === "super_like").map((l) => l.swiper_id),
  );

  const enriched = (inviters ?? []).map((l) => ({ ...l, super_liked: superLikerIds.has(l.id) }));
  const enrichedWithPhotos = await attachPhotoGalleries(enriched);

  res.json({ invites: withComputedAges(enrichedWithPhotos), balance });
});

/** GET /api/discover/search — filter/search the same unswiped candidate
 *  pool as /queue, by name, age range, city, and personality tags. */
router.get("/discover/search", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { name, min_age, max_age, city, tags } = req.query as {
    name?: string;
    min_age?: string;
    max_age?: string;
    city?: string;
    tags?: string;
  };

  const { data: alreadySwiped } = await supabase
    .from("swipes")
    .select("target_id")
    .eq("swiper_id", userId);

  const excludedIds = [userId, ...(alreadySwiped?.map((s) => s.target_id) ?? [])];

  let query = supabase
    .from("profiles")
    .select("id, name, age, birthday, bio, city, photo_url, personality_tags, integrity_score, num_kids, family_plans, smoking_status, drinking_status")
    .not("id", "in", `(${excludedIds.join(",")})`);

  if (name) {
    query = query.ilike("name", `%${name}%`);
  }
  if (min_age) {
    query = query.gte("age", Number(min_age));
  }
  if (max_age) {
    query = query.lte("age", Number(max_age));
  }
  if (city) {
    query = query.ilike("city", `%${city}%`);
  }
  if (tags) {
    const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
    if (tagList.length > 0) {
      query = query.overlaps("personality_tags", tagList);
    }
  }

  const { data: results, error } = await query.limit(30);

  if (error) {
    res.status(500).json({ error: "Search failed" });
    return;
  }

  const withPhotos = await attachPhotoGalleries(results ?? []);

  res.json({ results: withComputedAges(withPhotos) });
});

/** GET /api/discover/categories — lightweight preview data for stat cards
 *  on the Search page (count + a few preview photos per category). */
router.get("/discover/categories", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const { data: alreadySwiped } = await supabase
    .from("swipes")
    .select("target_id")
    .eq("swiper_id", userId);

  const excludedIds = [userId, ...(alreadySwiped?.map((s) => s.target_id) ?? [])];
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
      .gte("created_at", sevenDaysAgo)
      .limit(3);
    const { count } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .not("id", "in", excludeClause)
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
      .eq("is_verified", true)
      .limit(3);
    const { count } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .not("id", "in", excludeClause)
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
      .ilike("city", viewerProfile.city)
      .limit(3);
    const { count } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .not("id", "in", excludeClause)
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
      .overlaps("personality_tags", viewerProfile.personality_tags)
      .limit(3);
    const { count } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .not("id", "in", excludeClause)
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
      const { data } = await supabase.from("profiles").select("id, photo_url").in("id", topIds);
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

  const { data: alreadySwiped } = await supabase
    .from("swipes")
    .select("target_id")
    .eq("swiper_id", userId);

  const excludedIds = [userId, ...(alreadySwiped?.map((s) => s.target_id) ?? [])];
  const excludeClause = `(${excludedIds.join(",")})`;
  const SELECT_FIELDS = "id, name, age, birthday, bio, city, photo_url, personality_tags, integrity_score, num_kids, family_plans, smoking_status, drinking_status";

  const { data: viewerProfile } = await supabase
    .from("profiles")
    .select("city, personality_tags")
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
        const { data } = await supabase.from("profiles").select(SELECT_FIELDS).in("id", audioUserIds.slice(0, 30));
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
          .ilike("city", viewerProfile.city)
          .limit(30);
        results = data ?? [];
      }
      break;
    }
    case "matches_vibe": {
      if (viewerProfile?.personality_tags && viewerProfile.personality_tags.length > 0) {
        const { data } = await supabase
          .from("profiles")
          .select(SELECT_FIELDS)
          .not("id", "in", excludeClause)
          .overlaps("personality_tags", viewerProfile.personality_tags)
          .limit(30);
        results = data ?? [];
      }
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
        const { data } = await supabase.from("profiles").select(SELECT_FIELDS).in("id", topIds);
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

  const withPhotos = await attachPhotoGalleries(results);

  res.json({ results: withComputedAges(withPhotos) });
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

  const spend = await spendSparks(userId, MESSAGE_REQUEST_COST, "Message before match");
  if (!spend.success) {
    res.status(402).json({ error: `Insufficient Sparks (need ${MESSAGE_REQUEST_COST})`, balance: spend.balance });
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
    .select("id, name, age, birthday, bio, city, photo_url, personality_tags, integrity_score, num_kids, family_plans, smoking_status, drinking_status")
    .in("id", pendingSentIds);

  const superSentIds = new Set(
    (outgoingLikes ?? []).filter((l) => l.direction === "super_like").map((l) => l.target_id),
  );
  const enriched = (sentProfiles ?? []).map((p) => ({ ...p, super_liked: superSentIds.has(p.id) }));
  const enrichedWithPhotos = await attachPhotoGalleries(enriched);

  res.json({ sent: withComputedAges(enrichedWithPhotos) });
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

  const { error } = await supabase.from("swipes").delete().eq("id", swipe.id);

  if (error) {
    res.status(500).json({ error: `Failed to withdraw invite: ${error.message}` });
    return;
  }

  res.sendStatus(204);
});

export default router;
