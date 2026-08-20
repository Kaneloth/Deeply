import { supabase } from "./supabase";
import { logger } from "./logger";
import { createNotification } from "./notifications-helper";
import { getEconomyConfig } from "./economy-config";

const LOW_BALANCE_THRESHOLD = 30;

interface SparksProfile {
  free_sparks_balance: number;
  paid_sparks_balance: number;
  next_spark_grant_at: string;
}

/**
 * Checks whether this user's monthly free-Spark grant is due, and applies
 * it if so (resetting free_sparks_balance to 300 — no rollover — and
 * pushing next_spark_grant_at one month out). Called lazily at the start
 * of any Sparks-reading or Sparks-spending action, so no cron job is
 * needed.
 *
 * Returns the up-to-date profile balances.
 */
export async function checkAndApplyMonthlyGrant(userId: string): Promise<SparksProfile> {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("free_sparks_balance, paid_sparks_balance, next_spark_grant_at")
    .eq("id", userId)
    .single();

  if (error || !profile) {
    logger.error({ userId, error }, "Failed to fetch profile for grant check");
    throw new Error("Profile not found");
  }

  const grantDue = new Date(profile.next_spark_grant_at).getTime() <= Date.now();

  if (!grantDue) {
    return profile as SparksProfile;
  }

  const { sparks_monthly_grant: grantAmount } = await getEconomyConfig();

  const nextGrantAt = new Date();
  nextGrantAt.setMonth(nextGrantAt.getMonth() + 1);

  const { data: updated, error: updateError } = await supabase
    .from("profiles")
    .update({
      free_sparks_balance: grantAmount,
      next_spark_grant_at: nextGrantAt.toISOString(),
    })
    .eq("id", userId)
    .select("free_sparks_balance, paid_sparks_balance, next_spark_grant_at")
    .single();

  if (updateError || !updated) {
    logger.error({ userId, updateError }, "Failed to apply monthly Spark grant");
    return profile as SparksProfile;
  }

  // Fire-and-forget — this is an audit-log row, not the balance itself
  // (already durably applied by the awaited .update() above). Blocking
  // the response on it added a full extra round trip to every single
  // Sparks-reading/spending action across the app, since this function
  // runs at the start of all of them.
  supabase
    .from("sparks_transactions")
    .insert({
      user_id: userId,
      amount: grantAmount,
      reason: "Monthly free Sparks grant",
      balance_after: updated.free_sparks_balance + updated.paid_sparks_balance,
    })
    .then(() => {});

  // Fire-and-forget — a notification failure shouldn't block the grant
  // itself from applying.
  createNotification(
    userId,
    "spark_grant",
    "Your free Sparks have arrived",
    `${grantAmount} free Sparks were just added to your balance.`,
  ).catch(() => {});

  return updated as SparksProfile;
}

/**
 * Add PAID Sparks to a user's balance (e.g. after a purchase in Phase 5)
 * and record the transaction. Paid Sparks never expire. Returns the new
 * total balance (free + paid).
 */
export async function addPaidSparks(
  userId: string,
  amount: number,
  reason: string,
): Promise<number> {
  const profile = await checkAndApplyMonthlyGrant(userId);
  const newPaidBalance = profile.paid_sparks_balance + amount;

  await supabase
    .from("profiles")
    .update({ paid_sparks_balance: newPaidBalance })
    .eq("id", userId);

  const newTotal = profile.free_sparks_balance + newPaidBalance;

  // Fire-and-forget — same reasoning as checkAndApplyMonthlyGrant: this
  // is the audit-log row, not the balance itself, which is already
  // durably applied by the awaited .update() above.
  supabase
    .from("sparks_transactions")
    .insert({
      user_id: userId,
      amount,
      reason,
      balance_after: newTotal,
    })
    .then(() => {});

  return newTotal;
}

/**
 * Deduct Sparks from a user's balance, spending free Sparks first and
 * paid Sparks second. Returns { success: true, balance } on success, or
 * { success: false, balance } if the combined balance is insufficient
 * (nothing is deducted in that case).
 */
export async function spendSparks(
  userId: string,
  amount: number,
  reason: string,
): Promise<{ success: boolean; balance: number }> {
  const profile = await checkAndApplyMonthlyGrant(userId);
  const total = profile.free_sparks_balance + profile.paid_sparks_balance;

  if (total < amount) {
    return { success: false, balance: total };
  }

  const spendFromFree = Math.min(profile.free_sparks_balance, amount);
  const spendFromPaid = amount - spendFromFree;

  const newFree = profile.free_sparks_balance - spendFromFree;
  const newPaid = profile.paid_sparks_balance - spendFromPaid;

  await supabase
    .from("profiles")
    .update({ free_sparks_balance: newFree, paid_sparks_balance: newPaid })
    .eq("id", userId);

  const newTotal = newFree + newPaid;

  // Fire-and-forget — same reasoning as above. This is the single
  // highest-impact change here: spendSparks runs at the start of nearly
  // every paid action in the app (super likes, reshuffle, undo, unsend,
  // read-receipt unlocks, message-before-match), so removing one
  // blocking round trip from it removes that same round trip from all
  // of them at once.
  supabase
    .from("sparks_transactions")
    .insert({
      user_id: userId,
      amount: -amount,
      reason,
      balance_after: newTotal,
    })
    .then(() => {});

  // Only fire on the actual crossing (was above threshold, now at/below
  // it) — not on every subsequent spend while already low, which would
  // spam a notification per message sent.
  //
  // Deliberately doesn't cite a specific balance figure in the body —
  // this notification is stored permanently and read whenever the user
  // next opens the bell, which could be minutes or days later. Any
  // number baked in here is only ever accurate at the instant it's
  // written; the user's real balance keeps moving with every subsequent
  // spend, so a stored "You have X Sparks left" reliably goes stale and
  // shows a wrong figure by the time it's actually read — exactly the
  // mismatch users were seeing between this and the always-live toast
  // in SparksContext.tsx.
  if (total > LOW_BALANCE_THRESHOLD && newTotal <= LOW_BALANCE_THRESHOLD) {
    createNotification(
      userId,
      "spark_low",
      "You're running low on Sparks",
      "Recharge to keep chatting and inviting — check your current balance on your profile.",
    ).catch(() => {});
  }

  return { success: true, balance: newTotal };
}

/**
 * Read-only balance + next grant date, applying the monthly grant first
 * if it's due. Used by GET /api/sparks.
 */
export async function getSparksSummary(userId: string): Promise<{
  balance: number;
  next_grant_at: string;
}> {
  const profile = await checkAndApplyMonthlyGrant(userId);
  return {
    balance: profile.free_sparks_balance + profile.paid_sparks_balance,
    next_grant_at: profile.next_spark_grant_at,
  };
}

/**
 * @deprecated Use spendSparks instead. Kept as an alias so older callers
 * (like the pre-Phase-3 messages route) don't break the build while
 * they're being migrated.
 */
export const deductSparks = spendSparks;