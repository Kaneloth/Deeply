import { readPersistentCache, writePersistentCache, registerCacheResetter } from "@/lib/persistentCache";

// Separate from MatchesPage's own list cache (cachedMatches) — this
// caches full individual match detail objects, keyed by matchId, shared
// between MatchDetailPage and ChatPage since both fetch and display the
// exact same shape from the same GET /api/matches/:matchId endpoint.
//
// Built specifically to soften the wait introduced by matches.ts's
// extended retry schedule (now up to ~10-13s worst case on a genuine
// inconsistency) — opening a match you've already visited before now
// shows the last-known-good data instantly while the fresh, slower
// fetch runs quietly in the background, rather than showing a loading
// skeleton for the full retry window every single time. A match's very
// first-ever open still has to wait, since there's nothing to show yet.
const MATCH_DETAIL_CACHE_KEY = "match_detail_cache";

let cachedMatchDetails: Record<string, unknown> =
  readPersistentCache<Record<string, unknown>>(MATCH_DETAIL_CACHE_KEY) ?? {};

registerCacheResetter(() => {
  cachedMatchDetails = {};
});

export function getCachedMatchDetail<T>(matchId: string): T | null {
  return (cachedMatchDetails[matchId] as T) ?? null;
}

export function updateMatchDetailCache<T>(matchId: string, match: T): void {
  cachedMatchDetails = { ...cachedMatchDetails, [matchId]: match };
  writePersistentCache(MATCH_DETAIL_CACHE_KEY, cachedMatchDetails);
}

export function removeMatchDetailCache(matchId: string): void {
  if (!(matchId in cachedMatchDetails)) return;
  const next = { ...cachedMatchDetails };
  delete next[matchId];
  cachedMatchDetails = next;
  writePersistentCache(MATCH_DETAIL_CACHE_KEY, cachedMatchDetails);
}
