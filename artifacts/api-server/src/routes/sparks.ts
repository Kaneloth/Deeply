import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { supabase } from "../lib/supabase";
import { getSparksSummary, addPaidSparks } from "../lib/sparks-helper";
import { verifyAndConsumeGooglePurchase } from "../lib/google-play-helper";
import { buildPayfastCheckout, validateItn } from "../lib/payfast-helper";

const router: IRouter = Router();

// google_product_id must exactly match an in-app product created in
// Google Play Console under this app's package (za.co.deeplydating.app).
const BUNDLES = [
  { id: "starter", sparks: 100, price_zar: 29, google_product_id: "sparks_starter" },
  { id: "popular", sparks: 300, price_zar: 79, google_product_id: "sparks_popular" },
  { id: "date_night", sparks: 600, price_zar: 149, google_product_id: "sparks_date_night" },
  { id: "power_user", sparks: 1500, price_zar: 299, google_product_id: "sparks_power_user" },
  { id: "deep_connection", sparks: 4000, price_zar: 699, google_product_id: "sparks_deep_connection" },
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

/** POST /api/sparks/purchase/google — verifies a completed Google Play
 *  purchase server-side before granting any Sparks. The client has
 *  already completed the actual purchase via @capgo/native-purchases by
 *  the time this is called; this endpoint's job is purely verification
 *  and fulfillment, never trusting the client's own claim that a
 *  purchase succeeded. */
router.post("/sparks/purchase/google", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { bundle_id, purchase_token } = req.body as { bundle_id?: string; purchase_token?: string };

  const bundle = BUNDLES.find((b) => b.id === bundle_id);
  if (!bundle) {
    res.status(400).json({ error: "Invalid bundle_id" });
    return;
  }
  if (!purchase_token) {
    res.status(400).json({ error: "purchase_token is required" });
    return;
  }

  try {
    await verifyAndConsumeGooglePurchase(bundle.google_product_id, purchase_token);
  } catch (err) {
    console.error("Google Play purchase verification failed:", err);
    res.status(402).json({ error: "Could not verify this purchase with Google Play. Please try again or contact support." });
    return;
  }

  // Claim this token exactly once. If this insert fails because the
  // token was already recorded (a retried request after e.g. a network
  // blip on the original response), treat it as a successful no-op
  // rather than an error — the purchase genuinely did go through the
  // first time, we just don't grant Sparks a second time for it.
  const { error: insertError } = await supabase
    .from("google_play_purchases")
    .insert({ purchase_token, user_id: userId, product_id: bundle.google_product_id, sparks_granted: bundle.sparks });

  if (insertError) {
    if (insertError.code === "23505") {
      const summary = await getSparksSummary(userId);
      res.json({ balance: summary.balance });
      return;
    }
    console.error("Failed to record Google Play purchase:", insertError);
    res.status(500).json({ error: "Failed to record your purchase. Please contact support." });
    return;
  }

  const newBalance = await addPaidSparks(userId, bundle.sparks, `Purchased ${bundle.id} bundle via Google Play`);
  res.json({ balance: newBalance });
});

/** POST /api/sparks/checkout/payfast — starts a PayFast checkout. Web
 *  only; the frontend must never call this from inside the native app
 *  (see SparksModal's platform check). Returns the signed form fields
 *  for the frontend to submit as a redirect to PayFast's hosted payment
 *  page — Sparks are NOT granted here, only once the ITN webhook below
 *  confirms the payment actually completed. */
router.post("/sparks/checkout/payfast", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { bundle_id } = req.body as { bundle_id?: string };

  const bundle = BUNDLES.find((b) => b.id === bundle_id);
  if (!bundle) {
    res.status(400).json({ error: "Invalid bundle_id" });
    return;
  }

  const { data: userData } = await supabase.auth.admin.getUserById(userId);
  const email = userData.user?.email;
  const name = (userData.user?.user_metadata as { name?: string } | null)?.name;

  // Inserted BEFORE redirecting to PayFast — this row is what the ITN
  // handler checks the paid amount against, and is the durable record
  // of what was actually expected for this specific attempt.
  const { data: txn, error: insertError } = await supabase
    .from("payfast_transactions")
    .insert({
      user_id: userId,
      bundle_id: bundle.id,
      sparks: bundle.sparks,
      amount_zar: bundle.price_zar,
    })
    .select("m_payment_id")
    .single();

  if (insertError || !txn) {
    console.error("Failed to create PayFast transaction:", insertError);
    res.status(500).json({ error: "Failed to start checkout. Please try again." });
    return;
  }

  const baseUrl = process.env.APP_BASE_URL ?? "https://app.deeplydating.co.za";

  try {
    const checkout = buildPayfastCheckout({
      m_payment_id: txn.m_payment_id,
      amount: bundle.price_zar.toFixed(2),
      item_name: `${bundle.sparks} Sparks`,
      custom_str1: userId,
      name_first: name,
      email_address: email,
      return_url: `${baseUrl}/sparks/payfast/return?m_payment_id=${txn.m_payment_id}`,
      cancel_url: `${baseUrl}/sparks/payfast/cancel`,
      notify_url: `${baseUrl}/api/sparks/payfast/itn`,
    });
    res.json(checkout);
  } catch (err) {
    console.error("Failed to build PayFast checkout:", err);
    res.status(500).json({ error: "Payment processing is temporarily unavailable." });
  }
});

/** GET /api/sparks/payfast/status/:mPaymentId — lets the return-landing
 *  page poll for whether the ITN has actually confirmed the payment yet
 *  (it can arrive slightly after the user's own browser redirect back
 *  from PayFast, since it's an independent server-to-server call). */
router.get("/sparks/payfast/status/:mPaymentId", requireAuth, async (req, res): Promise<void> => {
  const { mPaymentId } = req.params;

  const { data: txn } = await supabase
    .from("payfast_transactions")
    .select("status, sparks, user_id")
    .eq("m_payment_id", mPaymentId)
    .single();

  if (!txn || txn.user_id !== req.user!.id) {
    res.status(404).json({ error: "Transaction not found" });
    return;
  }

  res.json({ status: txn.status, sparks: txn.sparks });
});

/** POST /api/sparks/payfast/itn — PayFast's server-to-server webhook.
 *  PUBLIC: never gated behind requireAuth, since PayFast's own servers
 *  call this directly, not a logged-in user's browser. Trust nothing in
 *  the payload until validateItn() confirms both the signature AND a
 *  direct server-to-server check with PayFast itself. */
router.post("/sparks/payfast/itn", async (req, res): Promise<void> => {
  // Respond 200 immediately — PayFast retries on non-200, and none of
  // the validation/processing below should block or delay that
  // acknowledgment.
  res.sendStatus(200);

  const body = req.body as Record<string, string>;

  try {
    const isValid = await validateItn(body);
    if (!isValid) {
      console.error("Rejected invalid PayFast ITN for m_payment_id:", body.m_payment_id);
      return;
    }

    const mPaymentId = body.m_payment_id;
    const { data: txn, error: fetchError } = await supabase
      .from("payfast_transactions")
      .select("*")
      .eq("m_payment_id", mPaymentId)
      .single();

    if (fetchError || !txn) {
      console.error(`PayFast ITN for unknown transaction: ${mPaymentId}`);
      return;
    }

    if (body.payment_status !== "COMPLETE") {
      await supabase
        .from("payfast_transactions")
        .update({ status: "failed" })
        .eq("m_payment_id", mPaymentId)
        .eq("status", "pending");
      return;
    }

    // Never trust the ITN's amount blindly — this is one of PayFast's
    // own documented required checks. Compare against what THIS
    // transaction was actually created for.
    const paidAmount = parseFloat(body.amount_gross);
    if (Math.abs(paidAmount - Number(txn.amount_zar)) > 0.01) {
      console.error(`PayFast ITN amount mismatch for ${mPaymentId}: expected ${txn.amount_zar}, got ${paidAmount}`);
      await supabase
        .from("payfast_transactions")
        .update({ status: "failed" })
        .eq("m_payment_id", mPaymentId)
        .eq("status", "pending");
      return;
    }

    // Atomic claim — only proceeds if this row is STILL pending at the
    // moment of update. Guards against PayFast sending a duplicate ITN
    // (which they document as a real possibility) causing Sparks to be
    // granted twice for the same payment.
    const { data: claimed } = await supabase
      .from("payfast_transactions")
      .update({ status: "complete", pf_payment_id: body.pf_payment_id ?? null, completed_at: new Date().toISOString() })
      .eq("m_payment_id", mPaymentId)
      .eq("status", "pending")
      .select("m_payment_id");

    if (!claimed || claimed.length === 0) {
      // Someone else (a concurrent duplicate ITN) already completed
      // this transaction between our fetch and this update.
      return;
    }

    await addPaidSparks(txn.user_id, txn.sparks, `Purchased ${txn.bundle_id} bundle via PayFast`);
  } catch (err) {
    console.error("Error processing PayFast ITN:", err);
  }
});

export default router;