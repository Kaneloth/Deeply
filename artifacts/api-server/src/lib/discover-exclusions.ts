import { supabase } from "./supabase";
import { getBlockedUserIds } from "./blocks-helper";

/** IDs to exclude from any discovery/search candidate list: the viewer
 *  themselves, anyone they've already swiped on, anyone they're already
 *  matched with, and anyone involved in a block relationship with them
 *  (either direction). The matches table is checked directly rather than
 *  relying solely on swipe history, since some paths (e.g.
 *  message-request) can create a match without necessarily recording a
 *  reciprocal swipe row for both users. */
export async function getExcludedCandidateIds(userId: string): Promise<string[]> {
  // These 4 queries are fully independent of each other's results, but
  // were previously awaited one after another — on every single
  // Discover/Search/Categories/Invites request. Running them concurrently
  // cuts this part's latency to roughly the slowest single query instead
  // of the sum of all four, which matters here specifically because this
  // function is called on nearly every page in the app.
  const [{ data: alreadySwiped }, { data: existingMatches }, blockedIds, { data: adminRows }] = await Promise.all([
    supabase.from("swipes").select("target_id").eq("swiper_id", userId),
    supabase.from("matches").select("user1_id, user2_id").or(`user1_id.eq.${userId},user2_id.eq.${userId}`),
    getBlockedUserIds(userId),
    supabase.from("profiles").select("id").eq("is_admin", true),
  ]);

  const matchedPartnerIds = (existingMatches ?? []).map((m) =>
    m.user1_id === userId ? m.user2_id : m.user1_id,
  );
  const adminIds = (adminRows ?? []).map((a) => a.id);

  return [
    userId,
    ...(alreadySwiped?.map((s) => s.target_id) ?? []),
    ...matchedPartnerIds,
    ...blockedIds,
    ...adminIds,
  ];
}

/** Same underlying exclusion logic as getExcludedCandidateIds, but keeps
 *  the "invited but not yet decided" people (a pending "like" or
 *  "super_like" the viewer sent) SEPARATE from everyone else, rather
 *  than folding them into one blanket list. Used specifically by name
 *  search: a viewer deliberately searching for a name they remember
 *  should be able to find someone they've already invited (to check in,
 *  view the profile again, etc.), while passive browsing (Discover,
 *  Categories, filtered search without a name) should still hide them
 *  entirely, same as before. People who were passed on, matched,
 *  blocked, or are admins are always excluded regardless — this
 *  distinction only ever applies to pending invites specifically. */
export async function getCandidateExclusionSets(
  userId: string,
): Promise<{ hardExcluded: string[]; pendingInvitedIds: string[] }> {
  // Same fix as getExcludedCandidateIds above — these 4 queries don't
  // depend on each other, so run them concurrently rather than one after
  // another.
  const [{ data: allSwipes }, { data: existingMatches }, blockedIds, { data: adminRows }] = await Promise.all([
    supabase.from("swipes").select("target_id, direction").eq("swiper_id", userId),
    supabase.from("matches").select("user1_id, user2_id").or(`user1_id.eq.${userId},user2_id.eq.${userId}`),
    getBlockedUserIds(userId),
    supabase.from("profiles").select("id").eq("is_admin", true),
  ]);

  const pendingInvitedIds = (allSwipes ?? [])
    .filter((s) => s.direction === "like" || s.direction === "super_like")
    .map((s) => s.target_id);
  const passedIds = (allSwipes ?? []).filter((s) => s.direction === "pass").map((s) => s.target_id);

  const matchedPartnerIds = (existingMatches ?? []).map((m) =>
    m.user1_id === userId ? m.user2_id : m.user1_id,
  );
  const adminIds = (adminRows ?? []).map((a) => a.id);

  return {
    hardExcluded: [userId, ...passedIds, ...matchedPartnerIds, ...blockedIds, ...adminIds],
    pendingInvitedIds,
  };
}

export interface PendingInviter {
  id: string;
  direction: "like" | "super_like";
  message_content: string | null;
}

// Diagnostic logging on 2026-08-23 proved that the `matches` table read
// inside getPendingInviterIds is genuinely inconsistent between calls —
// not just the invite_reveals join originally suspected. The SAME
// viewer/target pair was observed flipping between "excluded — already
// matched" and "INCLUDED as pending" four times within five minutes,
// with no unmatch or any real action happening in between (see
// production log excerpt from 08:12–08:16 UTC that day). That
// inconsistency let an already-matched person spuriously reappear as a
// pending invite, complete with Accept/Decline buttons.
//
// This is a best-effort, same-instance-only mitigation (this runs as a
// stateless serverless function — there's no guarantee this module
// stays warm or is shared across invocations), following the same
// "merge, don't replace" principle used elsewhere in this app for the
// same class of read-after-write lag: once a match is genuinely
// observed for a viewer/partner pair, remember it for a bounded window
// so a subsequent lagged read that misses it can't un-match them. The
// TTL bounds the downside — a genuine unmatch is still reflected within
// a few minutes rather than the pair being stuck matched forever.
const MATCHED_STICKY_TTL_MS = 5 * 60 * 1000;
const stickyMatchedPairs = new Map<string, number>(); // `${viewerId}:${partnerId}` -> expiry

function stickyKey(viewerId: string, partnerId: string): string {
  return `${viewerId}:${partnerId}`;
}

function rememberMatched(viewerId: string, partnerIds: Iterable<string>): void {
  const expiry = Date.now() + MATCHED_STICKY_TTL_MS;
  for (const partnerId of partnerIds) {
    stickyMatchedPairs.set(stickyKey(viewerId, partnerId), expiry);
  }
}

function getStickyMatched(viewerId: string): Set<string> {
  const now = Date.now();
  const result = new Set<string>();
  for (const [key, expiry] of stickyMatchedPairs) {
    if (expiry < now) {
      stickyMatchedPairs.delete(key);
      continue;
    }
    if (key.startsWith(`${viewerId}:`)) {
      result.add(key.slice(viewerId.length + 1));
    }
  }
  return result;
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
    .select("swiper_id, direction, created_at, message_content")
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

  // Remember whatever this read genuinely found, then union in anything
  // remembered from a recent prior read — see the comment above
  // stickyMatchedPairs for why. Logged separately so it's visible
  // whenever this actually changes the outcome (i.e. this read alone
  // would have gotten it wrong).
  rememberMatched(userId, matchedIds);
  const stickyAdditions: string[] = [];
  for (const partnerId of getStickyMatched(userId)) {
    if (!matchedIds.has(partnerId)) {
      matchedIds.add(partnerId);
      stickyAdditions.push(partnerId);
    }
  }
  if (stickyAdditions.length > 0) {
    console.error(
      `INVITES DEBUG: sticky-matched cache added [${stickyAdditions.join(",")}] for userId=${userId} — this read's own matches query missed them`,
    );
  }

  const blockedIds = new Set(await getBlockedUserIds(userId));

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
  // "super_like", for instance — we want the newer one's direction) and
  // any attached message_content from a "message before match" invite.
  const latestInvitePerInviter = new Map<
    string,
    { createdAt: number; direction: "like" | "super_like"; message_content: string | null }
  >();
  for (const invite of incomingLikes) {
    const t = new Date(invite.created_at).getTime();
    const existing = latestInvitePerInviter.get(invite.swiper_id);
    if (existing === undefined || t > existing.createdAt) {
      latestInvitePerInviter.set(invite.swiper_id, {
        createdAt: t,
        direction: invite.direction,
        message_content: invite.message_content ?? null,
      });
    }
  }

  const pending: PendingInviter[] = [];
  for (const [inviterId, invite] of latestInvitePerInviter) {
    if (matchedIds.has(inviterId)) {
      console.error(`INVITES DEBUG: ${inviterId} excluded — already matched`);
      continue;
    }
    if (blockedIds.has(inviterId)) {
      console.error(`INVITES DEBUG: ${inviterId} excluded — blocked`);
      continue;
    }
    const decidedAt = myLatestDecisionAt.get(inviterId);
    if (decidedAt !== undefined && decidedAt >= invite.createdAt) {
      console.error(
        `INVITES DEBUG: ${inviterId} excluded — decided at ${new Date(decidedAt).toISOString()}, invite was at ${new Date(invite.createdAt).toISOString()}`,
      );
      continue;
    }
    console.error(
      `INVITES DEBUG: ${inviterId} INCLUDED as pending — invite at ${new Date(invite.createdAt).toISOString()}, my decision at ${decidedAt ? new Date(decidedAt).toISOString() : "never"}, matched: ${matchedIds.has(inviterId)}`,
    );
    pending.push({ id: inviterId, direction: invite.direction, message_content: invite.message_content });
  }

  console.error(`INVITES DEBUG: userId=${userId} final pending count=${pending.length}, ids=${pending.map((p) => p.id).join(",")}`);

  return pending;
}