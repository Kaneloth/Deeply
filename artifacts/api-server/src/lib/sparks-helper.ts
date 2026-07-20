import { supabase } from "./supabase";
import { logger } from "./logger";

/**
 * Add Sparks to a user's balance and record the transaction.
 * Returns the new balance.
 */
export async function addSparks(
  userId: string,
  amount: number,
  reason: string,
): Promise<number> {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("sparks_balance")
    .eq("id", userId)
    .single();

  if (error || !profile) {
    logger.error({ userId, error }, "Failed to fetch profile for spark add");
    throw new Error("Profile not found");
  }

  const newBalance = profile.sparks_balance + amount;

  await supabase
    .from("profiles")
    .update({ sparks_balance: newBalance })
    .eq("id", userId);

  await supabase.from("sparks_transactions").insert({
    user_id: userId,
    amount,
    reason,
    balance_after: newBalance,
  });

  return newBalance;
}

/**
 * Deduct Sparks from a user's balance.
 * Returns { success: true, balance } on success or { success: false, balance } if insufficient.
 */
export async function deductSparks(
  userId: string,
  amount: number,
  reason: string,
): Promise<{ success: boolean; balance: number }> {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("sparks_balance")
    .eq("id", userId)
    .single();

  if (error || !profile) {
    logger.error({ userId, error }, "Failed to fetch profile for spark deduct");
    return { success: false, balance: 0 };
  }

  if (profile.sparks_balance < amount) {
    return { success: false, balance: profile.sparks_balance };
  }

  const newBalance = profile.sparks_balance - amount;

  await supabase
    .from("profiles")
    .update({ sparks_balance: newBalance })
    .eq("id", userId);

  await supabase.from("sparks_transactions").insert({
    user_id: userId,
    amount: -amount,
    reason,
    balance_after: newBalance,
  });

  return { success: true, balance: newBalance };
}
