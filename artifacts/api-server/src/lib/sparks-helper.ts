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

/** Approximate distance in km between two lat/lon points (Haversine
 *  formula) — used for the "same GPS location" referral fraud signal.
 *  Deliberately a proximity threshold, not exact equality: GPS readings
 *  drift slightly every single time even for the same physical spot,
 *  so exact-match would almost never fire even for genuine fraud. */
function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const EARTH_RADIUS_KM = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const SAME_LOCATION_THRESHOLD_KM = 0.1; // ~100m — same household/building range, deliberately
const TOO_FAST_ONBOARDING_MS = 3 * 60 * 1000; // 3 minutes
const MULTI_REFERRAL_WINDOW_DAYS = 30;
const MULTI_REFERRAL_THRESHOLD = 3; // this account + how many others sharing the same device/IP

interface ReferralProfileFields {
  id: string;
  signup_device_id: string | null;
  normalized_email: string | null;
  signup_ip: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** Unified referral fraud check — every signal DeepSeek's plan
 *  suggested except selfie comparison (a separate facial-recognition
 *  integration, deliberately out of scope). Returns every signal that
 *  fired, not just the first — admin reviewing a flagged case benefits
 *  from seeing the full picture ("same device AND same IP" is more
 *  clearly suspicious than either alone), and this list is stored
 *  verbatim on the review-queue row. An empty array means auto-approve;
 *  any non-empty array means the reward sits in the review queue
 *  instead of crediting immediately — see profile.ts's PUT /profile/me
 *  for where this actually gets called and acted on. Nothing here is a
 *  silent, invisible drop anymore: every flagged case is visible to
 *  admin, who can then go cross-check both profiles manually. */
export async function checkReferralFraudSignals(
  referrer: ReferralProfileFields,
  newUser: ReferralProfileFields & { created_at: string },
  onboardingCompletedAt: Date,
): Promise<string[]> {
  const flags: string[] = [];

  if (referrer.signup_device_id && referrer.signup_device_id === newUser.signup_device_id) {
    flags.push("Same device ID as referrer");
  }
  if (referrer.normalized_email && referrer.normalized_email === newUser.normalized_email) {
    flags.push("Same email as referrer");
  }
  if (referrer.signup_ip && referrer.signup_ip === newUser.signup_ip) {
    flags.push("Same IP address as referrer");
  }
  if (
    referrer.latitude != null &&
    referrer.longitude != null &&
    newUser.latitude != null &&
    newUser.longitude != null &&
    haversineDistanceKm(referrer.latitude, referrer.longitude, newUser.latitude, newUser.longitude) < SAME_LOCATION_THRESHOLD_KM
  ) {
    flags.push("Same GPS location as referrer");
  }

  const signupToOnboardingMs = onboardingCompletedAt.getTime() - new Date(newUser.created_at).getTime();
  if (signupToOnboardingMs >= 0 && signupToOnboardingMs < TOO_FAST_ONBOARDING_MS) {
    flags.push("Completed onboarding suspiciously fast after signing up");
  }

  // "One person creating many accounts" — checked against the new
  // user's own device/IP specifically (not the referrer's), since
  // that's the side actually being newly created here. Two separate
  // queries, same reasoning as getAbuseDelayUntil above: avoids
  // hand-building a PostgREST .or() filter string.
  const cutoff = new Date(Date.now() - MULTI_REFERRAL_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  let sameSourceCount = 0;
  if (newUser.signup_device_id) {
    const { count } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("signup_device_id", newUser.signup_device_id)
      .neq("id", newUser.id)
      .gte("created_at", cutoff);
    sameSourceCount = Math.max(sameSourceCount, count ?? 0);
  }
  if (newUser.signup_ip) {
    const { count } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("signup_ip", newUser.signup_ip)
      .neq("id", newUser.id)
      .gte("created_at", cutoff);
    sameSourceCount = Math.max(sameSourceCount, count ?? 0);
  }
  if (sameSourceCount >= MULTI_REFERRAL_THRESHOLD - 1) {
    flags.push(`${sameSourceCount + 1} accounts total from the same device/IP in the last ${MULTI_REFERRAL_WINDOW_DAYS} days`);
  }

  return flags;
}

/** Records that userId just received a grant against these identifiers,
 *  so a future different account reusing the same device/email gets
 *  caught by getAbuseDelayUntil above. Upserts rather than inserts,
 *  since the same device/email legitimately gets a new row's worth of
 *  "last granted" data every single month for its original owner.
 *
 *  Exported (not just called internally from checkAndApplyMonthlyGrant
 *  below) so auth.ts can also call this directly at signup itself —
 *  confirmed as a real gap otherwise: this previously only got
 *  recorded reactively, the first time a grant actually processed,
 *  which might never happen at all if someone deletes their account
 *  before ever triggering that (e.g. testing the delete flow itself,
 *  or genuinely never opening a Sparks-related screen). Deleting the
 *  account before this ever ran meant the device/email was never
 *  marked as "used" at all — exactly the gap a quick delete-and-
 *  resignup would exploit to get a second free grant. Recording this
 *  at signup itself closes that gap regardless of whether or when the
 *  first grant ever actually processes. */
export async function recordGrantForAbuseCheck(
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
    .select(
      "free_sparks_balance, paid_sparks_balance, next_spark_grant_at, is_founder, signup_device_id, normalized_email, onboarding_completed",
    )
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

  // Confirmed real motive for a mass-signup pattern noticed in
  // production (many accounts with disposable-looking, bot-generated
  // email addresses — "name.randomdigits@gmail.com" — that never
  // complete onboarding): this grant previously fired on ANY Sparks-
  // related endpoint call, completely independent of onboarding status,
  // meaning a brand-new, never-onboarded account could collect free
  // Sparks instantly with zero friction. Gating specifically on
  // onboarding_completed removes that motive without needing a bigger
  // system like a signup CAPTCHA.
  //
  // Deliberately does NOT advance next_spark_grant_at here — this is
  // what makes this ONLY ever affect the very first grant, never a
  // later recurring one. Leaving it untouched means it simply stays
  // "due"; the moment this same account later completes onboarding and
  // makes any Sparks-related call, this same check runs again, finds
  // onboarding_completed now true, and the grant proceeds exactly as it
  // always did. Once onboarding_completed is true (a permanent, one-way
  // transition — see AuthContext.tsx), this check can never block
  // anything again for this account.
  if (!profile.onboarding_completed) {
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
  is_founder: boolean;
}> {
  const profile = await checkAndApplyMonthlyGrant(userId);
  return {
    balance: profile.free_sparks_balance + profile.paid_sparks_balance,
    next_grant_at: profile.next_spark_grant_at,
    is_founder: profile.is_founder,
  };
}

/**
 * @deprecated Use spendSparks instead. Kept as an alias so older callers
 * (like the pre-Phase-3 messages route) don't break the build while
 * they're being migrated.
 */
export const deductSparks = spendSparks;