import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { supabase } from "../lib/supabase";
import { addSparks } from "../lib/sparks-helper";

const router: IRouter = Router();

const DAILY_EARN_OPTIONS = [
  { type: "daily_login", label: "Daily Login", amount: 1 },
  { type: "post_date_feedback", label: "Post-Date Feedback", amount: 2 },
  { type: "profile_complete", label: "Complete Your Profile", amount: 5 },
];

const BUNDLES = [
  {
    id: "starter",
    name: "Starter",
    sparks: 15,
    price_usd: 2.99,
    label: "Try it",
    description: "Impulse buy",
  },
  {
    id: "date_night",
    name: "Date Night",
    sparks: 60,
    price_usd: 9.99,
    label: "Best Value",
    description: "Covers 2 weeks of boosting",
  },
  {
    id: "power_user",
    name: "Power User",
    sparks: 150,
    price_usd: 19.99,
    label: null,
    description: "Full month of daily boosts",
  },
];

/** GET /api/sparks */
router.get("/sparks", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const { data: profile } = await supabase
    .from("profiles")
    .select("sparks_balance")
    .eq("id", userId)
    .single();

  // Weekly stats
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: txns } = await supabase
    .from("sparks_transactions")
    .select("amount")
    .eq("user_id", userId)
    .gte("created_at", weekAgo);

  const earnedThisWeek = (txns ?? [])
    .filter((t) => t.amount > 0)
    .reduce((sum, t) => sum + t.amount, 0);
  const spentThisWeek = (txns ?? [])
    .filter((t) => t.amount < 0)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  // Daily earn status
  const today = new Date().toISOString().split("T")[0];
  const { data: claims } = await supabase
    .from("daily_earn_claims")
    .select("claim_type")
    .eq("user_id", userId)
    .eq("claimed_date", today);

  const claimedTypes = new Set((claims ?? []).map((c) => c.claim_type));

  const daily_earn_available = DAILY_EARN_OPTIONS.map((opt) => ({
    ...opt,
    claimed: claimedTypes.has(opt.type),
  }));

  // Count free keys and unsends remaining today
  const freeKeysRemaining = claimedTypes.has("chat_key_used") ? 0 : 1;
  const freeUnsendsRemaining = claimedTypes.has("free_unsend_used") ? 0 : 1;

  res.json({
    balance: profile?.sparks_balance ?? 0,
    earned_this_week: earnedThisWeek,
    spent_this_week: spentThisWeek,
    free_keys_remaining: freeKeysRemaining,
    free_unsends_remaining: freeUnsendsRemaining,
    daily_earn_available,
  });
});

/** GET /api/sparks/history */
router.get("/sparks/history", requireAuth, async (req, res): Promise<void> => {
  const { data: txns } = await supabase
    .from("sparks_transactions")
    .select("*")
    .eq("user_id", req.user!.id)
    .order("created_at", { ascending: false })
    .limit(20);

  res.json(txns ?? []);
});

/** GET /api/sparks/bundles */
router.get("/sparks/bundles", requireAuth, async (_req, res): Promise<void> => {
  res.json(BUNDLES);
});

/** POST /api/sparks/earn — claim a daily earn action */
router.post("/sparks/earn", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { claim_type } = req.body as { claim_type?: string };

  const option = DAILY_EARN_OPTIONS.find((o) => o.type === claim_type);
  if (!option) {
    res.status(400).json({ error: "Invalid claim_type" });
    return;
  }

  const today = new Date().toISOString().split("T")[0];

  // Check if already claimed
  const { data: existing } = await supabase
    .from("daily_earn_claims")
    .select("id")
    .eq("user_id", userId)
    .eq("claim_type", claim_type)
    .eq("claimed_date", today)
    .single();

  if (existing) {
    res.status(409).json({ error: "Already claimed today" });
    return;
  }

  // Record the claim
  const { error: claimError } = await supabase
    .from("daily_earn_claims")
    .insert({ user_id: userId, claim_type, claimed_date: today });

  if (claimError) {
    res.status(409).json({ error: "Already claimed today" });
    return;
  }

  const newBalance = await addSparks(userId, option.amount, option.label);

  // Return updated sparks summary (re-use GET /sparks logic inline)
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: txns } = await supabase
    .from("sparks_transactions")
    .select("amount")
    .eq("user_id", userId)
    .gte("created_at", weekAgo);

  const earnedThisWeek = (txns ?? [])
    .filter((t) => t.amount > 0)
    .reduce((sum, t) => sum + t.amount, 0);
  const spentThisWeek = (txns ?? [])
    .filter((t) => t.amount < 0)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  const { data: claims } = await supabase
    .from("daily_earn_claims")
    .select("claim_type")
    .eq("user_id", userId)
    .eq("claimed_date", today);

  const claimedTypes = new Set((claims ?? []).map((c) => c.claim_type));
  const daily_earn_available = DAILY_EARN_OPTIONS.map((opt) => ({
    ...opt,
    claimed: claimedTypes.has(opt.type),
  }));

  res.json({
    balance: newBalance,
    earned_this_week: earnedThisWeek,
    spent_this_week: spentThisWeek,
    free_keys_remaining: claimedTypes.has("chat_key_used") ? 0 : 1,
    free_unsends_remaining: claimedTypes.has("free_unsend_used") ? 0 : 1,
    daily_earn_available,
  });
});

/** POST /api/sparks/purchase — simulate purchase (no real payment yet) */
router.post("/sparks/purchase", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { bundle_id } = req.body as { bundle_id?: string };

  const bundle = BUNDLES.find((b) => b.id === bundle_id);
  if (!bundle) {
    res.status(400).json({ error: "Invalid bundle_id" });
    return;
  }

  const newBalance = await addSparks(
    userId,
    bundle.sparks,
    `Purchased ${bundle.name} bundle`,
  );

  // Return summary
  res.json({
    balance: newBalance,
    earned_this_week: 0,
    spent_this_week: 0,
    free_keys_remaining: 1,
    free_unsends_remaining: 1,
    daily_earn_available: DAILY_EARN_OPTIONS.map((opt) => ({
      ...opt,
      claimed: false,
    })),
  });
});

export default router;
