import { supabase } from "./supabase";
import { spendSparks } from "./sparks-helper";
import { getNextLocalMidnightUTC } from "./timezone";

const DAILY_FREE_INVITES = 15;
const EXTRA_INVITE_COST = 5;

/** Consumes one "invite" against the user's daily free quota (15/day,
 *  resetting at local midnight). If the free quota is exhausted, charges
 *  EXTRA_INVITE_COST Sparks instead. Also opportunistically updates the
 *  user's stored timezone if a fresher one was provided (e.g. from the
 *  browser), so the local-midnight reset stays accurate if they travel. */
export async function consumeFreeInviteOrCharge(
  userId: string,
  clientTimezone?: string,
): Promise<{ success: boolean; usedFree: boolean; balance: number | null }> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone, free_invites_used_today, invites_reset_at")
    .eq("id", userId)
    .single();

  if (!profile) {
    return { success: false, usedFree: false, balance: null };
  }

  const timezone = clientTimezone && clientTimezone !== profile.timezone ? clientTimezone : profile.timezone ?? "UTC";
  const now = new Date();
  const resetAt = profile.invites_reset_at ? new Date(profile.invites_reset_at) : new Date(0);

  let usedToday = profile.free_invites_used_today ?? 0;

  // Lazy reset — if we've passed the stored reset instant, the quota
  // refills and we compute the next local-midnight reset instant.
  if (now >= resetAt) {
    usedToday = 0;
  }

  if (usedToday < DAILY_FREE_INVITES) {
    const nextReset = now >= resetAt ? getNextLocalMidnightUTC(timezone) : new Date(profile.invites_reset_at);
    await supabase
      .from("profiles")
      .update({
        free_invites_used_today: usedToday + 1,
        invites_reset_at: nextReset.toISOString(),
        timezone,
      })
      .eq("id", userId);

    return { success: true, usedFree: true, balance: null };
  }

  // Free quota exhausted for today — charge Sparks instead.
  const spend = await spendSparks(userId, EXTRA_INVITE_COST, "Extra invite beyond daily free limit");
  if (!spend.success) {
    return { success: false, usedFree: false, balance: spend.balance };
  }

  // Still keep the timezone fresh even on the paid path.
  if (timezone !== profile.timezone) {
    await supabase.from("profiles").update({ timezone }).eq("id", userId);
  }

  return { success: true, usedFree: false, balance: spend.balance };
}

export { DAILY_FREE_INVITES, EXTRA_INVITE_COST };
