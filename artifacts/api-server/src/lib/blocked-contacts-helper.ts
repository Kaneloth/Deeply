import { supabase } from "./supabase";

/** Resolves a user's blocked phone numbers (blocked_contacts) into the
 *  ids of any CURRENT profiles whose verified phone number matches one
 *  of them. Deliberately re-checked at query time rather than stored
 *  denormalized: the blocked person may not have had an account (or a
 *  verified number) at the time they were blocked, and should still
 *  become excluded the moment they later verify that same number. */
export async function getBlockedContactProfileIds(userId: string): Promise<string[]> {
  const { data: blockedRows } = await supabase
    .from("blocked_contacts")
    .select("blocked_phone_number")
    .eq("user_id", userId);

  const blockedNumbers = (blockedRows ?? []).map((r) => r.blocked_phone_number);
  if (blockedNumbers.length === 0) return [];

  const { data: matchingProfiles } = await supabase
    .from("profiles")
    .select("id")
    .eq("phone_verified", true)
    .in("phone_number", blockedNumbers);

  return (matchingProfiles ?? []).map((p) => p.id);
}
