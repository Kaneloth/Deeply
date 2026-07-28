/** Computes a person's current age from their birthday. Returns null if
 *  no birthday is available. */
export function calculateAge(birthday: string | null): number | null {
  if (!birthday) return null;
  const birthDate = new Date(birthday);
  if (isNaN(birthDate.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

/** Attaches a computed `age` to a profile-like object, preferring a real
 *  birthday when present and falling back to the legacy stored `age`
 *  column for older test accounts that predate the birthday field. */
export function withComputedAge<T extends { birthday?: string | null; age?: number | null }>(
  profile: T,
): T & { age: number | null } {
  const computed = calculateAge(profile.birthday ?? null);
  return { ...profile, age: computed ?? profile.age ?? null };
}

export function withComputedAges<T extends { birthday?: string | null; age?: number | null }>(
  profiles: T[],
): (T & { age: number | null })[] {
  return profiles.map(withComputedAge);
}
