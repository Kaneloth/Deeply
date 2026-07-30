import { supabase } from "./supabase";

/** Returns everyone involved in a block relationship with this user, in
 *  EITHER direction (userId blocked them, or they blocked userId) — used
 *  to exclude blocked users from Discover/Search/Categories regardless
 *  of who blocked whom. Includes hidden ("removed from list") blocks too,
 *  since the block itself still applies even once removed from view. */
export async function getBlockedUserIds(userId: string): Promise<string[]> {
  const { data: iBlocked } = await supabase
    .from("blocks")
    .select("blocked_id")
    .eq("blocker_id", userId);

  const { data: blockedMe } = await supabase
    .from("blocks")
    .select("blocker_id")
    .eq("blocked_id", userId);

  return [
    ...(iBlocked?.map((b) => b.blocked_id) ?? []),
    ...(blockedMe?.map((b) => b.blocker_id) ?? []),
  ];
}

/** Returns true if either user has blocked the other. */
export async function isBlockedEitherWay(userIdA: string, userIdB: string): Promise<boolean> {
  const { data } = await supabase
    .from("blocks")
    .select("id")
    .or(
      `and(blocker_id.eq.${userIdA},blocked_id.eq.${userIdB}),and(blocker_id.eq.${userIdB},blocked_id.eq.${userIdA})`,
    )
    .limit(1);

  return (data?.length ?? 0) > 0;
}
