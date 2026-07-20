import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { supabase } from "../lib/supabase";

const router: IRouter = Router();

/** GET /api/discover/today — return today's curated match card */
router.get("/discover/today", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 1. Check if user already has an active match from today
  const { data: existing } = await supabase
    .from("matches")
    .select("*, user2:profiles!matches_user2_id_fkey(*)")
    .eq("user1_id", userId)
    .gte("created_at", today.toISOString())
    .in("status", ["pending", "matched"])
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (existing) {
    return void res.json(await buildDiscoverCard(existing, userId));
  }

  // 2. Find a random profile that hasn't been matched with this user
  const { data: previousMatches } = await supabase
    .from("matches")
    .select("user2_id")
    .eq("user1_id", userId);

  const excludedIds = [userId, ...(previousMatches?.map((m) => m.user2_id) ?? [])];

  // Also check reverse direction
  const { data: reverseMatches } = await supabase
    .from("matches")
    .select("user1_id")
    .eq("user2_id", userId);

  const reverseIds = reverseMatches?.map((m) => m.user1_id) ?? [];
  const allExcluded = [...new Set([...excludedIds, ...reverseIds])];

  const { data: candidates } = await supabase
    .from("profiles")
    .select("id")
    .not("id", "in", `(${allExcluded.join(",")})`)
    .limit(50);

  if (!candidates || candidates.length === 0) {
    // No matches available today
    res.sendStatus(204);
    return;
  }

  // Pick a random candidate
  const pick = candidates[Math.floor(Math.random() * candidates.length)];

  // 3. Create the match — expires in 24 hours
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { data: newMatch, error } = await supabase
    .from("matches")
    .insert({
      user1_id: userId,
      user2_id: pick.id,
      status: "pending",
      expires_at: expiresAt,
    })
    .select("*, user2:profiles!matches_user2_id_fkey(*)")
    .single();

  if (error || !newMatch) {
    res.status(500).json({ error: "Failed to create match" });
    return;
  }

  res.json(await buildDiscoverCard(newMatch, userId));
});

async function buildDiscoverCard(
  match: Record<string, unknown> & { user2?: Record<string, unknown> },
  _viewerId: string,
) {
  const other = match.user2 as Record<string, unknown> | undefined;

  // Fetch the other user's audio prompts
  const { data: prompts } = await supabase
    .from("audio_prompts")
    .select("*")
    .eq("user_id", other?.id ?? "")
    .limit(2);

  return {
    match_id: match.id,
    user_id: other?.id ?? null,
    name: other?.name ?? "Someone",
    age: other?.age ?? null,
    city: other?.city ?? null,
    distance_km: null,
    // Only expose photo if revealed
    photo_url: match.photo_revealed ? (other?.photo_url ?? null) : null,
    photo_revealed: match.photo_revealed ?? false,
    audio_prompts: prompts ?? [],
    personality_tags: (other?.personality_tags as string[]) ?? [],
    expires_at: match.expires_at,
    status: match.status,
  };
}

export default router;
