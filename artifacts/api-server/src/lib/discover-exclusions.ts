import { supabase } from "./supabase";
import { getBlockedUserIds } from "./blocks-helper";
import { getBlockedContactProfileIds } from "./blocked-contacts-helper";
import { getEconomyConfig } from "./economy-config";

// Unlike the earlier "just stop showing it" version of invite expiry,
// this actually deletes the swipes row once a like/super_like has gone
// unanswered past invite_expiry_days — freeing the sender to see that
// person in Discover again, which matters most for a small user base
// where permanently using up a candidate over one unanswered invite is
// a real cost. No scheduled/cron job exists in this codebase, so this
// runs lazily, right here, wherever a viewer's own candidate exclusions
// are computed — i.e. essentially every time they open Discover or
// Search. That's a deliberate, practical choice: the person whose
// activity would actually benefit from the cleanup (the original
// sender, now free to see someone new) is exactly the person whose own
// request triggers it. It only ever deletes the CURRENT viewer's own
// like/super_like rows — never touches "pass" (a pass is a decision,
// not an unanswered invite, and was never meant to expire) and never
// touches anyone else's swipes.
async function deleteExpiredInvites(
  userId: string,
  swipes: { target_id: string; direction: string; created_at: string }[],
): Promise<Set<string>> {
  const { invite_expiry_days: expiryDays } = await getEconomyConfig();
  const cutoffMs = Date.now() - expiryDays * 24 * 60 * 60 * 1000;

  const expiredTargetIds = swipes
    .filter((s) => (s.direction === "like" || s.direction === "super_like") && new Date(s.created_at).getTime() < cutoffMs)
    .map((s) => s.target_id);

  if (expiredTargetIds.length === 0) return new Set();

  const { error } = await supabase
    .from("swipes")
    .delete()
    .eq("swiper_id", userId)
    .in("target_id", expiredTargetIds)
    .in("direction", ["like", "super_like"]);

  if (error) {
    console.error(`INVITES DEBUG: failed to delete expired invites for userId=${userId}: ${error.message}`);
    // Deletion failed — don't treat them as gone for THIS request either,
    // since the row is still actually there. They'll simply get another
    // chance to expire on a future request.
    return new Set();
  }

  console.error(`INVITES DEBUG: expired invite(s) deleted for userId=${userId}: [${expiredTargetIds.join(",")}]`);
  return new Set(expiredTargetIds);
}

/** IDs to exclude from any discovery/search candidate list: the viewer
 *  themselves, anyone they've already swiped on, anyone they're already
 *  matched with, and anyone involved in a block relationship with them
 *  (either direction). The matches table is checked directly rather than
 *  relying solely on swipe history, since some paths (e.g.
 *  message-request) can create a match without necessarily recording a
 *  reciprocal swipe row for both users. */
export async function getExcludedCandidateIds(userId: string): Promise<string[]> {
  // These 5 queries are fully independent of each other's results, but
  // were previously awaited one after another — on every single
  // Discover/Search/Categories/Invites request. Running them concurrently
  // cuts this part's latency to roughly the slowest single query instead
  // of the sum of all four, which matters here specifically because this
  // function is called on nearly every page in the app.
  const [{ data: alreadySwiped }, { data: existingMatches }, blockedIds, { data: adminRows }, blockedContactIds] = await Promise.all([
    supabase.from("swipes").select("target_id, direction, created_at").eq("swiper_id", userId),
    supabase.from("matches").select("user1_id, user2_id").or(`user1_id.eq.${userId},user2_id.eq.${userId}`),
    getBlockedUserIds(userId),
    supabase.from("profiles").select("id").eq("is_admin", true),
    getBlockedContactProfileIds(userId),
  ]);

  const expiredIds = await deleteExpiredInvites(userId, alreadySwiped ?? []);

  const matchedPartnerIds = (existingMatches ?? []).map((m) =>
    m.user1_id === userId ? m.user2_id : m.user1_id,
  );
  const adminIds = (adminRows ?? []).map((a) => a.id);

  return [
    userId,
    ...(alreadySwiped?.map((s) => s.target_id).filter((id) => !expiredIds.has(id)) ?? []),
    ...matchedPartnerIds,
    ...blockedIds,
    ...adminIds,
    ...blockedContactIds,
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
  // Same fix as getExcludedCandidateIds above — these 5 queries don't
  // depend on each other, so run them concurrently rather than one after
  // another.
  const [{ data: allSwipes }, { data: existingMatches }, blockedIds, { data: adminRows }, blockedContactIds] = await Promise.all([
    supabase.from("swipes").select("target_id, direction, created_at").eq("swiper_id", userId),
    supabase.from("matches").select("user1_id, user2_id").or(`user1_id.eq.${userId},user2_id.eq.${userId}`),
    getBlockedUserIds(userId),
    supabase.from("profiles").select("id").eq("is_admin", true),
    getBlockedContactProfileIds(userId),
  ]);

  const expiredIds = await deleteExpiredInvites(userId, allSwipes ?? []);

  const pendingInvitedIds = (allSwipes ?? [])
    .filter((s) => (s.direction === "like" || s.direction === "super_like") && !expiredIds.has(s.target_id))
    .map((s) => s.target_id);
  const passedIds = (allSwipes ?? []).filter((s) => s.direction === "pass").map((s) => s.target_id);

  const matchedPartnerIds = (existingMatches ?? []).map((m) =>
    m.user1_id === userId ? m.user2_id : m.user1_id,
  );
  const adminIds = (adminRows ?? []).map((a) => a.id);

  return {
    hardExcluded: [userId, ...passedIds, ...matchedPartnerIds, ...blockedIds, ...adminIds, ...blockedContactIds],
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
// matched" and "INCLUDED as pending" repeatedly within seconds, with no
// unmatch or any real action happening in between. That inconsistency
// let an already-matched person spuriously reappear as a pending
// invite, complete with Accept/Decline buttons.
//
// An earlier version of this mitigation used an in-memory Map, but
// logs showed it only helping intermittently: it's scoped to a single
// serverless instance, and Netlify clearly spreads requests across many
// different instances (visible in the varying `hostname` per request in
// the function logs) — so the "remembered" match was very often on a
// different instance than the one handling the next request. This
// version stores it in the database instead (see
// migration_confirmed_pairs.sql), so every instance sees the same
// memory. Same "merge, don't replace" principle as before: once a match
// is genuinely observed for a viewer/partner pair, remember it for a
// bounded window so a subsequent lagged/inconsistent read can't
// un-match them. The TTL bounds the downside — a genuine unmatch is
// still reflected within a few minutes rather than the pair being stuck
// matched forever.
// TTL was originally 5 minutes, on the theory that a genuine unmatch
// should eventually be reflected even if this cache doesn't know about
// it. Production logs on 2026-08-23 proved this backfires: a gap of
// just 9.4 minutes between Monica's own invites checks (entirely
// plausible — backgrounding the app, switching screens) let the cache
// expire before her next read, which then landed wrong again with
// nothing left to rescue it. A short TTL trades a small amount of
// "unmatch reflected faster" for a real, recurring correctness bug.
//
// The better fix: matches.ts's DELETE /matches/:matchId now proactively
// clears this cache the moment a real unmatch happens (see
// forgetMatched below) — so correctness for real unmatches no longer
// depends on the TTL being short at all. That frees this TTL to be
// generous; it now exists purely as a safety bound for the rare case
// a match gets deleted some other way (e.g. directly in the database),
// not as the primary mechanism for reflecting unmatches.
const MATCHED_STICKY_TTL_MS = 24 * 60 * 60 * 1000;

// Exported so matches.ts can reinforce this same cache from its own
// successful reads — see that file's comment for why this needed to
// become a two-way relationship: this cache used to be populated only
// from getPendingInviterIds below, but the Alex/Monica case proved the
// `matches` table read itself is unreliable in matches.ts's own routes
// too (GET /matches and GET /matches/:matchId), independent of
// anything happening here.
export async function rememberMatched(viewerId: string, partnerIds: Iterable<string>): Promise<void> {
  const ids = [...partnerIds];
  if (ids.length === 0) return;
  const now = new Date().toISOString();
  const rows = ids.map((partnerId) => ({ viewer_id: viewerId, partner_id: partnerId, confirmed_at: now }));
  const { error } = await supabase
    .from("confirmed_matched_pairs")
    .upsert(rows, { onConflict: "viewer_id,partner_id" });
  if (error) {
    console.error(`INVITES DEBUG: failed to write sticky-matched cache for userId=${viewerId}: ${error.message}`);
  }
}

export async function getStickyMatched(viewerId: string): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - MATCHED_STICKY_TTL_MS).toISOString();
  const { data, error } = await supabase
    .from("confirmed_matched_pairs")
    .select("partner_id")
    .eq("viewer_id", viewerId)
    .gte("confirmed_at", cutoff);
  if (error) {
    console.error(`INVITES DEBUG: failed to read sticky-matched cache for userId=${viewerId}: ${error.message}`);
    return new Set();
  }
  return new Set((data ?? []).map((r) => r.partner_id as string));
}

/** Called from matches.ts's DELETE /matches/:matchId right after a real
 *  unmatch succeeds — this is what lets MATCHED_STICKY_TTL_MS above be
 *  generous rather than short: a genuine unmatch no longer needs to
 *  wait on TTL expiry to stop being incorrectly protected, since it's
 *  cleared immediately here instead. Clears both directions of the
 *  pair, since either person's own cache could independently be
 *  holding onto the stale "still matched" fact. */
export async function forgetMatched(userA: string, userB: string): Promise<void> {
  const { error } = await supabase
    .from("confirmed_matched_pairs")
    .delete()
    .or(
      `and(viewer_id.eq.${userA},partner_id.eq.${userB}),and(viewer_id.eq.${userB},partner_id.eq.${userA})`,
    );
  if (error) {
    console.error(`INVITES DEBUG: failed to clear sticky-matched cache for [${userA},${userB}]: ${error.message}`);
  }
}

// Same mitigation, same reasoning, now for `invite_reveals` — logging on
// 2026-08-23 showed the identical flapping pattern on this table too:
// the same viewer/target pair's revealed status vanishing and
// reappearing across reads seconds apart, with no action taken,
// causing an invite the user already paid to reveal to slide back into
// the "N new people invited you" banner. Exported so discover.ts's
// route handlers (both GET /discover/invites and POST
// /discover/invites/reveal, which both read this same table) can use
// it; POST also calls rememberRevealed() right after its own successful
// write, so this doesn't have to wait on a lagged read to know about
// its own just-completed reveal.
// A reveal is permanent — there's no "un-reveal" action anywhere in
// this app, so unlike the matched cache above, there's no real fact
// this TTL is meant to eventually catch up to. The 5-minute version of
// this was the direct cause of the exact same failure described above
// (Monica's revealed invites sliding back to "new" after a ~9-minute
// gap in polling). Kept as a long-but-finite bound rather than infinite
// purely as cheap insurance against this cache accumulating forever for
// accounts that stop being used.
const REVEALED_STICKY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function rememberRevealed(viewerId: string, targetIds: Iterable<string>): Promise<void> {
  const ids = [...targetIds];
  if (ids.length === 0) return;
  const now = new Date().toISOString();
  const rows = ids.map((targetId) => ({ viewer_id: viewerId, target_id: targetId, confirmed_at: now }));
  const { error } = await supabase
    .from("confirmed_revealed_pairs")
    .upsert(rows, { onConflict: "viewer_id,target_id" });
  if (error) {
    console.error(`INVITES DEBUG: failed to write sticky-revealed cache for userId=${viewerId}: ${error.message}`);
  }
}

export async function getStickyRevealed(viewerId: string): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - REVEALED_STICKY_TTL_MS).toISOString();
  const { data, error } = await supabase
    .from("confirmed_revealed_pairs")
    .select("target_id")
    .eq("viewer_id", viewerId)
    .gte("confirmed_at", cutoff);
  if (error) {
    console.error(`INVITES DEBUG: failed to read sticky-revealed cache for userId=${viewerId}: ${error.message}`);
    return new Set();
  }
  return new Set((data ?? []).map((r) => r.target_id as string));
}

// Same underlying mechanism as the matched/revealed caches above,
// applied to discover.ts's reshuffle-free-vs-paid check — a rapid
// sequence of reshuffle taps hits the identical read-after-write lag:
// each tap's read of profiles.last_free_reshuffle_at can fail to see
// the PREVIOUS tap's own just-written update (especially likely here
// since taps can be only a second or two apart), making that tap
// incorrectly re-evaluate isFree=true and skip charging Sparks for it.
// Observed directly: 4 rapid reshuffles, only 2 correctly charged.
//
// Unlike the matched cache, there's no "un-reshuffle" action that would
// ever need this fact to reverse — once a free reshuffle happens, that
// timestamp only ever moves forward. So no TTL is needed here at all:
// this is a single upserted row per user (never appended), not a
// growing log, so there's no accumulation concern to bound either.
export async function rememberReshuffleTimestamp(userId: string, timestampIso: string): Promise<void> {
  const { error } = await supabase
    .from("confirmed_reshuffle_timestamps")
    .upsert({ user_id: userId, last_free_reshuffle_at: timestampIso }, { onConflict: "user_id" });
  if (error) {
    console.error(`RESHUFFLE DEBUG: failed to write sticky-reshuffle cache for userId=${userId}: ${error.message}`);
  }
}

export async function getStickyReshuffleTimestamp(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("confirmed_reshuffle_timestamps")
    .select("last_free_reshuffle_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error(`RESHUFFLE DEBUG: failed to read sticky-reshuffle cache for userId=${userId}: ${error.message}`);
    return null;
  }
  return data?.last_free_reshuffle_at ?? null;
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

  // This query previously had no error handling — data would silently
  // become `undefined` on any failure (timeout, rate limit, etc. — and
  // this function runs on nearly every Invites/Discover page load, so
  // it's under real concurrent load) and `existingMatches ?? []` would
  // quietly treat that as "you have zero matches", making a genuinely
  // matched person look like a new pending invite. This exact query is
  // the one the original handoff notes said had already been hardened
  // this way — it evidently didn't survive the later revert to the
  // stable baseline. Restoring it: on failure, return no pending
  // invites rather than risk showing someone already matched as
  // actionable (Accept/Decline) again.
  const { data: existingMatches, error: matchesError } = await supabase
    .from("matches")
    .select("user1_id, user2_id")
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`);

  if (matchesError) {
    console.error(
      `INVITES DEBUG: matches query FAILED for userId=${userId}: ${matchesError.message} — returning no pending invites rather than risk showing an already-matched person as new`,
    );
    return [];
  }

  const matchedIds = new Set(
    (existingMatches ?? []).map((m) => (m.user1_id === userId ? m.user2_id : m.user1_id)),
  );

  // Remember whatever this read genuinely found, then union in anything
  // remembered from a recent prior read — see the comment above
  // rememberMatched/getStickyMatched for why. Logged separately so it's
  // visible whenever this actually changes the outcome (i.e. this read
  // alone would have gotten it wrong). Both are independent DB calls,
  // so run them concurrently rather than one after another.
  const [, stickyMatched] = await Promise.all([
    rememberMatched(userId, matchedIds),
    getStickyMatched(userId),
  ]);
  const stickyAdditions: string[] = [];
  for (const partnerId of stickyMatched) {
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

  // Read-only visibility filter — never deletes the underlying swipes
  // row, never touches Sparks. That's deliberate: the manual-withdraw
  // route (POST/DELETE on /discover/invites/sent/:targetId) is the only
  // path that actually removes an invite and charges cost_undo_swipe;
  // this only stops an unreplied invite from continuing to show up as
  // pending/actionable once it's old enough. Because the swipe row
  // stays, the sender still correctly won't see this person reappear in
  // Discover (getExcludedCandidateIds/getCandidateExclusionSets both
  // exclude anyone already swiped on, regardless of pending/expired
  // status) — expiry changes visibility, not history.
  const { invite_expiry_days: expiryDays } = await getEconomyConfig();
  const expiryCutoffMs = Date.now() - expiryDays * 24 * 60 * 60 * 1000;

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
    if (invite.createdAt < expiryCutoffMs) {
      console.error(
        `INVITES DEBUG: ${inviterId} excluded — invite expired (sent ${new Date(invite.createdAt).toISOString()}, cutoff is ${expiryDays} days)`,
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