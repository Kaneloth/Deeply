/** Decodes the user ID (the `sub` claim) out of a Supabase JWT
 *  client-side, without needing a network round-trip. Used to namespace
 *  localStorage "seen it once" flags per-account rather than per-browser
 *  — otherwise one account's dismissed one-time notice silently applies
 *  to every other account later signed into on the same device. */
export function getUserIdFromToken(token: string | null): string | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.sub ?? null;
  } catch {
    return null;
  }
}
