import { supabase } from "./supabase";

export interface EconomyConfig {
  sparks_monthly_grant: number;
  cost_super_like: number;
  cost_undo_swipe: number;
  cost_reveal_invites: number;
  cost_message_before_match: number;
  cost_reshuffle: number;
  cost_send_message: number;
  cost_unsend_message: number;
  cost_unlock_read_receipts: number;
  cost_extra_invite: number;
  daily_free_invites: number;
  cost_reveal_profile_views: number;
  cost_extra_photo: number;
  cost_boost: number;
  cost_incognito_per_day: number;
  id_verification_fee_zar: number;
}

// Mirrors the values these figures replaced — used only as a fallback
// for any key missing from app_settings (e.g. the migration hasn't run
// yet, or a new key was added to this interface but not yet seeded), so
// the economy degrades gracefully instead of throwing mid-purchase.
const DEFAULTS: EconomyConfig = {
  sparks_monthly_grant: 300,
  cost_super_like: 10,
  cost_undo_swipe: 5,
  cost_reveal_invites: 30,
  cost_message_before_match: 30,
  cost_reshuffle: 10,
  cost_send_message: 10,
  cost_unsend_message: 10,
  cost_unlock_read_receipts: 20,
  cost_extra_invite: 5,
  daily_free_invites: 15,
  cost_reveal_profile_views: 15,
  cost_extra_photo: 10,
  cost_boost: 50,
  cost_incognito_per_day: 5,
  id_verification_fee_zar: 99,
};

let cache: { value: EconomyConfig; expiresAt: number } | null = null;
const CACHE_TTL_MS = 30_000;

/** Fetches every admin-configurable economy figure (Sparks costs, the
 *  monthly grant amount, the ID verification fee) in one call, cached
 *  briefly in memory so a burst of requests on the same warm server
 *  instance doesn't hit the database on every single one. Falls back to
 *  DEFAULTS for any key missing from app_settings. */
export async function getEconomyConfig(): Promise<EconomyConfig> {
  if (cache && cache.expiresAt > Date.now()) {
    return cache.value;
  }

  const { data } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", Object.keys(DEFAULTS));

  const fromDb = Object.fromEntries((data ?? []).map((row) => [row.key, row.value]));
  const config = { ...DEFAULTS, ...fromDb } as EconomyConfig;

  cache = { value: config, expiresAt: Date.now() + CACHE_TTL_MS };
  return config;
}

/** Call this right after an admin edits a value so the change takes
 *  effect immediately for the next request, rather than waiting out the
 *  cache TTL (up to 30s of stale pricing otherwise). */
export function invalidateEconomyConfigCache(): void {
  cache = null;
}
