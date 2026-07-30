import { supabase } from "./supabase";

/** IDs to exclude from any discovery/search candidate list: the viewer
 *  themselves, anyone they've already swiped on, and anyone they're
 *  already matched with. The matches table is checked directly rather
 *  than relying solely on swipe history, since some paths (e.g.
 *  message-request) can create a match without necessarily recording a
 *  reciprocal swipe row for both users. */
export async function getExcludedCandidateIds(userId: string): Promise<string[]> {
  const { data: alreadySwiped } = await supabase
    .from("swipes")
    .select("target_id")
    .eq("swiper_id", userId);

  const { data: existingMatches } = await supabase
    .from("matches")
    .select("user1_id, user2_id")
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`);

  const matchedPartnerIds = (existingMatches ?? []).map((m) =>
    m.user1_id === userId ? m.user2_id : m.user1_id,
  );

  return [userId, ...(alreadySwiped?.map((s) => s.target_id) ?? []), ...matchedPartnerIds];
}

export interface PendingInviter {
  id: string;
  direction: "like" | "super_like";
}

/** Returns everyone with a currently-pending (unmatched, not-yet-decided)
 *  invite toward this user — i.e. who should show up in their "received
 *  invites" list right now — along with the direction of their most
 *  recent invite (needed to know who used a Super Like).
 *
 *  An invite is excluded if the viewer is already matched with that
 *  person, OR if the viewer has their OWN decision-swipe on that person
 *  timestamped AT OR AFTER that specific invite. Critically, this is a
 *  per-invite timestamp comparison, not a blanket "have I ever swiped on
 *  them" check — an old pass/decision shouldn't permanently suppress a
 *  genuinely new invite attempt the same person sends later (e.g. trying
 *  again with a Super Invite after being declined once). */
export async function getPendingInviterIds(userId: string): Promise<PendingInviter[]> {
  const { data: incomingLikes } = await supabase
    .from("swipes")
    .select("swiper_id, direction, created_at")
    .eq("target_id", userId)
    .in("direction", ["like", "super_like"]);

  if (!incomingLikes || incomingLikes.length === 0) return [];

  const { data: existingMatches } = await supabase
    .from("matches")
    .select("user1_id, user2_id")
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`);

  const matchedIds = new Set(
    (existingMatches ?? []).map((m) => (m.user1_id === userId ? m.user2_id : m.user1_id)),
  );

  const { data: myOwnSwipes } = await supabase
    .from("swipes")
    .select("target_id, created_at")
    .eq("swiper_id", userId);

  // Map of person -> the most recent time I swiped on them myself.
  const myLatestDecisionAt = new Map<string, number>();
  for (const s of myOwnSwipes ?? []) {
    const t = new Date(s.created_at).getTime();
    const existing = myLatestDecisionAt.get(s.target_id);
    if (existing === undefined || t > existing) myLatestDecisionAt.set(s.target_id, t);
  }

  // Keep only the most recent inbound invite per inviter, along with its
  // direction (someone could have an old "like" plus a newer
  // "super_like", for instance — we want the newer one's direction).
  const latestInvitePerInviter = new Map<string, { createdAt: number; direction: "like" | "super_like" }>();
  for (const invite of incomingLikes) {
    const t = new Date(invite.created_at).getTime();
    const existing = latestInvitePerInviter.get(invite.swiper_id);
    if (existing === undefined || t > existing.createdAt) {
      latestInvitePerInviter.set(invite.swiper_id, { createdAt: t, direction: invite.direction });
    }
  }

  const pending: PendingInviter[] = [];
  for (const [inviterId, invite] of latestInvitePerInviter) {
    if (matchedIds.has(inviterId)) continue;
    const decidedAt = myLatestDecisionAt.get(inviterId);
    if (decidedAt !== undefined && decidedAt >= invite.createdAt) continue; // already acted on this one
    pending.push({ id: inviterId, direction: invite.direction });
  }

  return pending;
}
