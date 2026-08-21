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

  supabase
    .from("sparks_transactions")
    .insert({
      user_id: userId,
      amount: grantAmount,
      reason: "Monthly free Sparks grant",
      balance_after: updated.free_sparks_balance + updated.paid_sparks_balance,
    })
    .then(() => {});

  createNotification(
    userId,
    "spark_grant",
    "Your free Sparks have arrived",
    `${grantAmount} free Sparks were just added to your balance.`,
  ).catch(() => {});

  return updated as SparksProfile;
}

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

  const { error: spendError } = await supabase
    .from("profiles")
    .update({ free_sparks_balance: newFree, paid_sparks_balance: newPaid })
    .eq("id", userId);
  if (spendError) {
    throw spendError;
  }

  const newTotal = newFree + newPaid;

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
  // shows a wrong figure by the time it's actually read.
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