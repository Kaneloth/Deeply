import { supabase } from "./supabase";
import { logger } from "./logger";
import { createNotification } from "./notifications-helper";
import { getEconomyConfig } from "./economy-config";

const LOW_BALANCE_PERCENTAGE = 0.25; // notify once 75% of the grant is used, i.e. 25% remains
const GRANT_ABUSE_COOLDOWN_DAYS = 30;

interface SparksProfile {
  free_sparks_balance: number;
  paid_sparks_balance: number;
  next_spark_grant_at: string;
  is_founder: boolean;
}

/** Checks whether granting to userId right now should be delayed
 *  because a DIFFERENT account already received a grant on the same
 *  device and/or normalized email within the cooldown window — the
 *  actual defense against deleting an account and signing up again to
 *  reset the 30-day clock early. Returns the timestamp to delay until
 *  if blocked, or null if this grant should proceed normally.
 *
 *  Deliberately ignores any log entry that belongs to this SAME
 *  user_id — that's just this account's own previous grant, and
 *  blocking on it would incorrectly delay someone's completely normal,
 *  expected monthly renewal. */
async function getAbuseDelayUntil(
  userId: string,
  deviceId: string | null,
  normalizedEmail: string | null,
): Promise<Date | null> {
  const logs: { last_grant_at: string; last_granted_user_id: string }[] = [];

  // Two separate, simple .eq() queries rather than one combined .or()
  // filter — email addresses contain "@" and other characters that
  // would need careful escaping inside a hand-built PostgREST filter
  // string, and this codebase has already hit exactly that class of
  // bug once before (see profile.ts's isUuidLike search fix). Two
  // small queries avoid the issue entirely rather than risking it again.
  if (deviceId) {
    const { data } = await supabase
      .from("grant_abuse_log")
      .select("last_grant_at, last_granted_user_id")
      .eq("identifier_type", "device")
      .eq("identifier_value", deviceId);
    if (data) logs.push(...data);
  }
  if (normalizedEmail) {
    const { data } = await supabase
      .from("grant_abuse_log")
      .select("last_grant_at, last_granted_user_id")
      .eq("identifier_type", "email")
      .eq("identifier_value", normalizedEmail);
    if (data) logs.push(...data);
  }

  if (logs.length === 0) return null;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - GRANT_ABUSE_COOLDOWN_DAYS);

  let latestBlockingGrant: Date | null = null;
  for (const log of logs) {
    if (log.last_granted_user_id === userId) continue; // this account's own history — never blocking
    const grantedAt = new Date(log.last_grant_at);
    if (grantedAt < cutoff) continue; // outside the cooldown window already
    if (!latestBlockingGrant || grantedAt > latestBlockingGrant) {
      latestBlockingGrant = grantedAt;
    }
  }

  if (!latestBlockingGrant) return null;

  const delayUntil = new Date(latestBlockingGrant);
  delayUntil.setDate(delayUntil.getDate() + GRANT_ABUSE_COOLDOWN_DAYS);
  return delayUntil;
}

/** Records that userId just received a grant against these identifiers,
 *  so a future different account reusing the same device/email gets
 *  caught by getAbuseDelayUntil above. Upserts rather than inserts,
 *  since the same device/email legitimately gets a new row's worth of
 *  "last granted" data every single month for its original owner. */
async function recordGrantForAbuseCheck(
  userId: string,
  deviceId: string | null,
  normalizedEmail: string | null,
): Promise<void> {
  const rows: { identifier_type: string; identifier_value: string; last_grant_at: string; last_granted_user_id: string }[] = [];
  const now = new Date().toISOString();
  if (deviceId) rows.push({ identifier_type: "device", identifier_value: deviceId, last_grant_at: now, last_granted_user_id: userId });
  if (normalizedEmail) rows.push({ identifier_type: "email", identifier_value: normalizedEmail, last_grant_at: now, last_granted_user_id: userId });

  if (rows.length === 0) return;

  await supabase.from("grant_abuse_log").upsert(rows, { onConflict: "identifier_type,identifier_value" });
}

export async function checkAndApplyMonthlyGrant(userId: string): Promise<SparksProfile> {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("free_sparks_balance, paid_sparks_balance, next_spark_grant_at, is_founder, signup_device_id, normalized_email")
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

  const delayUntil = await getAbuseDelayUntil(userId, profile.signup_device_id, profile.normalized_email);
  if (delayUntil) {
    // Deliberately doesn't touch the balance at all here — this account
    // simply doesn't get a grant yet, silently, same as any month where
    // the grant genuinely isn't due. No error, no notification; there's
    // nothing this person did wrong that they'd need telling about, and
    // surfacing "we think you might be reusing a device/email" would
    // both tip off genuine abusers on exactly what's being checked and
    // risk confusing someone on a shared family device for no reason.
    const { data: delayed } = await supabase
      .from("profiles")
      .update({ next_spark_grant_at: delayUntil.toISOString() })
      .eq("id", userId)
      .select("free_sparks_balance, paid_sparks_balance, next_spark_grant_at, is_founder")
      .single();

    return (delayed ?? profile) as SparksProfile;
  }

  const { sparks_monthly_grant: baseGrantAmount } = await getEconomyConfig();

  // Founders get double whatever the admin has currently configured as
  // the standard monthly grant — always relative to that live value,
  // not a separately hardcoded founder-specific number, so a later
  // change to sparks_monthly_grant automatically keeps this 2x
  // relationship intact without needing a second setting to update.
  const grantAmount = profile.is_founder ? baseGrantAmount * 2 : baseGrantAmount;

  const nextGrantAt = new Date();
  nextGrantAt.setMonth(nextGrantAt.getMonth() + 1);

  const { data: updated, error: updateError } = await supabase
    .from("profiles")
    .update({
      free_sparks_balance: grantAmount,
      next_spark_grant_at: nextGrantAt.toISOString(),
    })
    .eq("id", userId)
    .select("free_sparks_balance, paid_sparks_balance, next_spark_grant_at, is_founder")
    .single();

  if (updateError || !updated) {
    logger.error({ userId, updateError }, "Failed to apply monthly Spark grant");
    return profile as SparksProfile;
  }

  recordGrantForAbuseCheck(userId, profile.signup_device_id, profile.normalized_email).catch((err) =>
    logger.error({ userId, err }, "Failed to record grant abuse log entry"),
  );

  supabase
    .from("sparks_transactions")
    .insert({
      user_id: userId,
      amount: grantAmount,
      reason: profile.is_founder ? "Monthly free Sparks grant (Founder — 2x)" : "Monthly free Sparks grant",
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

  // Threshold is now a PERCENTAGE of this specific user's actual grant
  // amount, not a flat hardcoded number. Previously this was a fixed
  // 30, which was fine back when the monthly grant was 300 (10%) but
  // became badly wrong the moment the admin changed the grant to 60 —
  // 30 out of 60 is 50% remaining, firing this "running low" warning
  // for every single new user almost immediately after signup.
  //
  // Also accounts for founder status specifically: a founder's actual
  // grant is double the base (see checkAndApplyMonthlyGrant above), so
  // their own meaningful "75% used" point is a different absolute
  // number than a non-founder's — computing this relative to each
  // person's own real grant keeps it correct for both, rather than
  // silently wrong for one group whenever founder status is involved.
  const { sparks_monthly_grant: baseGrantAmount } = await getEconomyConfig();
  const effectiveGrantAmount = profile.is_founder ? baseGrantAmount * 2 : baseGrantAmount;
  const lowBalanceThreshold = effectiveGrantAmount * LOW_BALANCE_PERCENTAGE;

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
  if (total > lowBalanceThreshold && newTotal <= lowBalanceThreshold) {
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