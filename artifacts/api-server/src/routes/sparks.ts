import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { supabase } from "../lib/supabase";
import { getSparksSummary, addPaidSparks } from "../lib/sparks-helper";

const router: IRouter = Router();

// NOTE: purchases are not live yet (Phase 5). These are shown on the
// recharge screen but the buy buttons stay disabled until real payments
// are wired up.
const BUNDLES = [
  { id: "starter", sparks: 100, price_zar: 29 },
  { id: "popular", sparks: 300, price_zar: 79 },
  { id: "date_night", sparks: 600, price_zar: 149 },
  { id: "power_user", sparks: 1500, price_zar: 299 },
  { id: "deep_connection", sparks: 4000, price_zar: 699 },
];

/** GET /api/sparks — current balance and next monthly grant date */
router.get("/sparks", requireAuth, async (req, res): Promise<void> => {
  const summary = await getSparksSummary(req.user!.id);
  res.json(summary);
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

/** POST /api/sparks/purchase — TEMPORARY dev-only stub. Grants Sparks
 *  instantly with no real payment. Replace with real payment verification
 *  in Phase 5 before this ever goes live to real users. */
router.post("/sparks/purchase", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { bundle_id } = req.body as { bundle_id?: string };

  const bundle = BUNDLES.find((b) => b.id === bundle_id);
  if (!bundle) {
    res.status(400).json({ error: "Invalid bundle_id" });
    return;
  }

  const newBalance = await addPaidSparks(userId, bundle.sparks, `[DEV] Purchased ${bundle.id} bundle`);

  res.json({ balance: newBalance });
});

export default router;
