const CACHE_KEY_PREFIX = "deeply_cache:";

/** Reads a persisted cache entry, returning null if missing, corrupted,
 *  or if localStorage is unavailable for any reason (storage quota,
 *  privacy-mode edge cases, etc.) — callers already treat null as "no
 *  cache yet" everywhere, so this degrades gracefully to the normal
 *  loading-skeleton behavior rather than throwing. */
export function readPersistentCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY_PREFIX + key);
    if (raw == null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writePersistentCache<T>(key: string, value: T): void {
  try {
    localStorage.setItem(CACHE_KEY_PREFIX + key, JSON.stringify(value));
  } catch {
    // Non-fatal — worst case, the next app open just doesn't have this
    // one cached and falls back to the normal loading skeleton.
  }
}

/** Called on logout. Without this, a persisted cache from one account
 *  could briefly flash on screen for the NEXT person who logs into this
 *  device, before the real fetch overwrites it — the same class of risk
 *  AuthContext's queryClient.clear() already guards against for
 *  react-query's cache. This guards the equivalent risk for this
 *  separate, localStorage-based cache. */
export function clearAllPersistentCaches(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(CACHE_KEY_PREFIX)) keysToRemove.push(key);
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    // Non-fatal.
  }
}
