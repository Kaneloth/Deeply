import { supabase } from "./supabase";
import { spendSparks } from "./sparks-helper";
import { getNextLocalMidnightUTC } from "./timezone";
import { getEconomyConfig } from "./economy-config";

/** Consumes one "invite" against the user's daily free quota, resetting
 *  at local midnight (count is admin-configurable — see economy-config).
 *  If the free quota is exhausted, charges the admin-configured Sparks
 *  cost instead. Also opportunistically updates the user's stored
 *  timezone if a fresher one was provided (e.g. from the browser), so
 *  the local-midnight reset stays accurate if they travel. */
export async function consumeFreeInviteOrCharge(
  userId: string,
  clientTimezone?: string,
): Promise<{ success: boolean; usedFree: boolean; balance: number | null }> {
  const { daily_free_invites: DAILY_FREE_INVITES, cost_extra_invite: EXTRA_INVITE_COST } = await getEconomyConfig();

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

/** For any other file that previously imported the static
 *  DAILY_FREE_INVITES/EXTRA_INVITE_COST constants (e.g. to display "X
 *  free invites remaining today" in an API response) — these are no
 *  longer static now that they're admin-configurable, so this async
 *  getter replaces that direct import. */
export async function getInviteQuotaConfig(): Promise<{ dailyFreeInvites: number; extraInviteCost: number }> {
  const { daily_free_invites, cost_extra_invite } = await getEconomyConfig();
  return { dailyFreeInvites: daily_free_invites, extraInviteCost: cost_extra_invite };
}
