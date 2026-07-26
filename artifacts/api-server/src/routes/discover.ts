import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { supabase } from "../lib/supabase";
import { spendSparks } from "../lib/sparks-helper";

const router: IRouter = Router();

const SUPER_LIKE_COST = 20;
const UNDO_COST = 10;
const REVEAL_LIKES_COST = 30;

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
    .select("id, name, age, bio, city, photo_url, personality_tags, integrity_score, boosted_until")
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

  res.json({ candidates: enriched });
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
    res.status(500).json({ error: "Failed to record swipe" });
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
    .select("id, name, age, bio, city, photo_url, personality_tags, integrity_score")
    .eq("id", lastSwipe.target_id)
    .single();

  res.json({ restoredProfile: restoredProfile ?? null, balance: spend.balance });
});

/** GET /api/discover/invites/count — FREE. Just the number of people who
 *  invited this user (liked them) but haven't matched yet, to create
 *  curiosity without a paywall on the number itself. */
router.get("/discover/invites/count", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const { data: incomingLikes } = await supabase
    .from("swipes")
    .select("swiper_id")
    .eq("target_id", userId)
    .in("direction", ["like", "super_like"]);

  const inviterIds = incomingLikes?.map((l) => l.swiper_id) ?? [];

  if (inviterIds.length === 0) {
    res.json({ count: 0 });
    return;
  }

  // Exclude anyone already matched — no need to "reveal" someone you're
  // already talking to.
  const { data: existingMatches } = await supabase
    .from("matches")
    .select("user1_id, user2_id")
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`);

  const matchedIds = new Set(
    (existingMatches ?? []).map((m) => (m.user1_id === userId ? m.user2_id : m.user1_id)),
  );

  const pendingCount = inviterIds.filter((id) => !matchedIds.has(id)).length;

  res.json({ count: pendingCount });
});

/** POST /api/discover/invites/reveal — PAID (30 Sparks). Returns the full
 *  profiles of everyone who invited this user and hasn't matched yet. */
router.post("/discover/invites/reveal", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const spend = await spendSparks(userId, REVEAL_LIKES_COST, "See who invited you");
  if (!spend.success) {
    res.status(402).json({ error: `Insufficient Sparks (need ${REVEAL_LIKES_COST})`, balance: spend.balance });
    return;
  }

  const { data: incomingLikes } = await supabase
    .from("swipes")
    .select("swiper_id, direction")
    .eq("target_id", userId)
    .in("direction", ["like", "super_like"]);

  const inviterIds = incomingLikes?.map((l) => l.swiper_id) ?? [];

  if (inviterIds.length === 0) {
    res.json({ invites: [], balance: spend.balance });
    return;
  }

  const { data: existingMatches } = await supabase
    .from("matches")
    .select("user1_id, user2_id")
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`);

  const matchedIds = new Set(
    (existingMatches ?? []).map((m) => (m.user1_id === userId ? m.user2_id : m.user1_id)),
  );

  const pendingInviterIds = inviterIds.filter((id) => !matchedIds.has(id));

  if (pendingInviterIds.length === 0) {
    res.json({ invites: [], balance: spend.balance });
    return;
  }

  const { data: inviters } = await supabase
    .from("profiles")
    .select("id, name, age, bio, city, photo_url, personality_tags, integrity_score")
    .in("id", pendingInviterIds);

  // Flag super-likers so the frontend can show a star badge.
  const superLikerIds = new Set(
    (incomingLikes ?? []).filter((l) => l.direction === "super_like").map((l) => l.swiper_id),
  );

  const enriched = (inviters ?? []).map((l) => ({ ...l, super_liked: superLikerIds.has(l.id) }));

  res.json({ invites: enriched, balance: spend.balance });
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
    .select("id, name, age, bio, city, photo_url, personality_tags, integrity_score")
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

  res.json({ results: results ?? [] });
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
  const SELECT_FIELDS = "id, name, age, bio, city, photo_url, personality_tags, integrity_score";

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

  res.json({ results });
});

export default router;
