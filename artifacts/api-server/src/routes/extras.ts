import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { supabase } from "../lib/supabase";
import { requireAdminScope } from "../lib/admin-auth";
import {
  getSparkBundles,
  invalidateSparkBundlesCache,
  validateExtras,
  getExtrasInventory,
  expireIncognitoIfDue,
} from "../lib/spark-bundles";

const router: IRouter = Router();

/** GET /api/sparks/extras — what the signed-in person owns. */
router.get("/sparks/extras", requireAuth, async (req, res): Promise<void> => {
  await expireIncognitoIfDue();
  const [inventory, { data: setting }] = await Promise.all([
    getExtrasInventory(req.user!.id),
    supabase.from("app_settings").select("value").eq("key", "incognito_enabled").maybeSingle(),
  ]);
  res.json({ ...inventory, incognito_available: setting?.value === true });
});

/** POST /api/sparks/extras/incognito/activate { hours } — uses one pass. */
router.post("/sparks/extras/incognito/activate", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { hours } = req.body as { hours?: number };
  if (typeof hours !== "number" || !Number.isInteger(hours) || hours < 1 || hours > 720) {
    res.status(400).json({ error: "Invalid pass" });
    return;
  }

  const { data: setting } = await supabase.from("app_settings").select("value").eq("key", "incognito_enabled").maybeSingle();
  if (setting?.value !== true) {
    res.status(403).json({ error: "Incognito mode is not currently available." });
    return;
  }

  const { data: profile } = await supabase.from("profiles").select("is_incognito, incognito_until").eq("id", userId).maybeSingle();
  if (profile?.is_incognito && !profile.incognito_until) {
    res.status(409).json({ error: "Incognito is already on. Turn it off first to use a pass." });
    return;
  }

  const { data, error } = await supabase.rpc("activate_incognito_pass", { p_user: userId, p_hours: hours });
  if (error) {
    console.error("activate_incognito_pass failed:", error.message);
    res.status(500).json({ error: "Could not activate. Please try again." });
    return;
  }
  if (!data) {
    res.status(400).json({ error: "You don't have an Incognito pass of that length." });
    return;
  }
  res.json({ incognito_until: data });
});

// ----------------------------- Admin ---------------------------------------

/** GET /api/admin/spark-bundles */
router.get("/admin/spark-bundles", requireAuth, requireAdminScope("manage_sparks"), async (_req, res): Promise<void> => {
  invalidateSparkBundlesCache();
  res.json(await getSparkBundles());
});

/** PUT /api/admin/spark-bundles/:id { price_zar, sparks_amount, extras } */
router.put("/admin/spark-bundles/:id", requireAuth, requireAdminScope("manage_sparks"), async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { price_zar, sparks_amount, extras } = req.body as {
    price_zar?: number;
    sparks_amount?: number;
    extras?: unknown;
  };

  const existing = (await getSparkBundles()).find((b) => b.id === id);
  if (!existing) {
    res.status(404).json({ error: "Unknown package" });
    return;
  }
  // PayFast rejects payments under R5.00.
  if (typeof price_zar !== "number" || !Number.isFinite(price_zar) || price_zar < 5 || price_zar > 100000) {
    res.status(400).json({ error: "Price must be between R5 and R100,000" });
    return;
  }
  if (typeof sparks_amount !== "number" || !Number.isInteger(sparks_amount) || sparks_amount < 1 || sparks_amount > 1_000_000) {
    res.status(400).json({ error: "Sparks must be a whole number of at least 1" });
    return;
  }
  let cleanExtras;
  try {
    cleanExtras = validateExtras(extras ?? []);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Invalid extras" });
    return;
  }

  // upsert (not update) so saving also works if the table was ever empty and
  // the packages were being served from the built-in fallback.
  const { error } = await supabase.from("spark_bundles").upsert(
    {
      id,
      sort_order: existing.sort_order,
      name: existing.name,
      google_product_id: existing.google_product_id,
      price_zar: Math.round(price_zar * 100) / 100,
      sparks_amount,
      extras: cleanExtras,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) {
    res.status(500).json({ error: `Failed to save: ${error.message}` });
    return;
  }

  invalidateSparkBundlesCache();
  res.sendStatus(204);
});

export default router;
