import { supabase } from "./supabase";
import { logger } from "./logger";

const MONTHLY_GRANT_AMOUNT = 300;

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

  const nextGrantAt = new Date();
  nextGrantAt.setMonth(nextGrantAt.getMonth() + 1);

  const { data: updated, error: updateError } = await supabase
    .from("profiles")
    .update({
      free_sparks_balance: MONTHLY_GRANT_AMOUNT,
      next_spark_grant_at: nextGrantAt.toISOString(),
    })
    .eq("id", userId)
    .select("free_sparks_balance, paid_sparks_balance, next_spark_grant_at")
    .single();

  if (updateError || !updated) {
    logger.error({ userId, updateError }, "Failed to apply monthly Spark grant");
    return profile as SparksProfile;
  }

  await supabase.from("sparks_transactions").insert({
    user_id: userId,
    amount: MONTHLY_GRANT_AMOUNT,
    reason: "Monthly free Sparks grant",
    balance_after: updated.free_sparks_balance + updated.paid_sparks_balance,
  });

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

  await supabase.from("sparks_transactions").insert({
    user_id: userId,
    amount,
    reason,
    balance_after: newTotal,
  });

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

  await supabase.from("sparks_transactions").insert({
    user_id: userId,
    amount: -amount,
    reason,
    balance_after: newTotal,
  });

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