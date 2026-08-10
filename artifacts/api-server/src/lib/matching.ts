// ============================================================
// Discover matching algorithm — Phase 1 (hard filters + weighted
// scoring), the appropriate scope for the current user base size.
// Collaborative filtering / ML-based approaches only make sense at much
// larger scale (100k+ users) where there's enough behavioral data to
// train on; below that they'd just add complexity without benefit.
// ============================================================

// profiles.gender uses singular self-description values ("man",
// "woman"), while looking_for_gender uses different plural search-intent
// values ("men", "women") — these can't be compared directly.
const GENDER_TO_LOOKING_FOR: Record<string, string> = {
  man: "men",
  woman: "women",
  non_binary: "non_binary",
};

/** Does `candidateGender` satisfy `lookingFor`? Empty or "everyone"
 *  preferences always pass (no filter applied from this side). A
 *  candidate who selected "prefer_not_to_say" always passes too — we
 *  can't determine a mismatch, and hard-excluding someone for declining
 *  to specify felt punitive rather than useful. */
export function genderSatisfiesPreference(
  candidateGender: string | null | undefined,
  lookingFor: string | null | undefined,
): boolean {
  if (!lookingFor || lookingFor === "everyone") return true;
  if (!candidateGender || candidateGender === "prefer_not_to_say") return true;
  return GENDER_TO_LOOKING_FOR[candidateGender] === lookingFor;
}

export interface LifestyleFields {
  num_kids?: string | null;
  family_plans?: string | null;
  smoking_status?: string | null;
  vaping_status?: string | null;
  drinking_status?: string | null;
  nightlife_frequency?: string | null;
  has_tattoos?: string | null;
  pets?: string | null;
  activity_level?: string | null;
}

export const LIFESTYLE_FIELD_KEYS: (keyof LifestyleFields)[] = [
  "num_kids",
  "family_plans",
  "smoking_status",
  "vaping_status",
  "drinking_status",
  "nightlife_frequency",
  "has_tattoos",
  "pets",
  "activity_level",
];

/** True if `candidate` passes every lifestyle preference the viewer has
 *  explicitly flagged as a dealbreaker. A field only excludes anyone if
 *  BOTH: it's in the viewer's dealbreakers list, AND the viewer's
 *  preference for it is actually set to something specific (not "any").
 *  Non-dealbreaker preferences are never checked here — they only
 *  influence the soft score below, never exclude. This is deliberate:
 *  with a small user base, hard-filtering on every preference by
 *  default would shrink the pool to almost nothing. */
export function passesDealbreakers(
  candidate: LifestyleFields,
  viewerPrefs: LifestyleFields,
  dealbreakers: string[],
): boolean {
  for (const key of LIFESTYLE_FIELD_KEYS) {
    if (!dealbreakers.includes(key)) continue;
    const wanted = viewerPrefs[key];
    if (!wanted || wanted === "any") continue;
    if (candidate[key] !== wanted) return false;
  }
  return true;
}

/** True if `candidateAge` falls within the viewer's set age range
 *  (inclusive on both ends). Unlike lifestyle dealbreakers, age range is
 *  always enforced as a hard filter, never optional — every mainstream
 *  dating app treats this as a baseline expectation, not something a
 *  viewer has to explicitly opt into filtering on. A candidate with no
 *  computed age (missing birthday) is kept rather than excluded, since
 *  excluding for missing data would be punitive rather than useful. */
export function passesAgeRange(
  candidateAge: number | null | undefined,
  viewerPrefAgeMin: number | null | undefined,
  viewerPrefAgeMax: number | null | undefined,
): boolean {
  if (candidateAge == null) return true;
  const min = viewerPrefAgeMin ?? 18;
  const max = viewerPrefAgeMax ?? 99;
  return candidateAge >= min && candidateAge <= max;
}

interface CandidateForScoring extends LifestyleFields {
  relationship_type?: string | null;
  dating_intentions?: string[] | null;
  personality_tags?: string[] | null;
}

interface ViewerForScoring {
  relationship_type?: string | null;
  dating_intentions?: string[] | null;
  personality_tags?: string[] | null;
  dealbreakers: string[];
  pref_num_kids?: string | null;
  pref_family_plans?: string | null;
  pref_smoking_status?: string | null;
  pref_vaping_status?: string | null;
  pref_drinking_status?: string | null;
  pref_nightlife_frequency?: string | null;
  pref_has_tattoos?: string | null;
  pref_pets?: string | null;
  pref_activity_level?: string | null;
}

/** Soft compatibility score — never excludes anyone, only influences
 *  ordering. Weighted so a relationship-type match matters more than a
 *  single overlapping interest tag, but nothing here is a hard
 *  requirement; dealbreakers (above) are the only hard exclusion
 *  mechanism for these fields. Dealbreaker-flagged fields are skipped
 *  here to avoid double-counting — they already gated who's in the pool
 *  at all. */
export function computeCompatibilityScore(candidate: CandidateForScoring, viewer: ViewerForScoring): number {
  let score = 0;

  if (viewer.relationship_type && candidate.relationship_type === viewer.relationship_type) {
    score += 15;
  }

  const viewerIntentions = viewer.dating_intentions ?? [];
  const candidateIntentions = candidate.dating_intentions ?? [];
  score += viewerIntentions.filter((i) => candidateIntentions.includes(i)).length * 4;

  const viewerTags = viewer.personality_tags ?? [];
  const candidateTags = candidate.personality_tags ?? [];
  score += viewerTags.filter((t) => candidateTags.includes(t)).length * 3;

  for (const key of LIFESTYLE_FIELD_KEYS) {
    if (viewer.dealbreakers.includes(key)) continue;
    const wanted = viewer[`pref_${key}` as keyof ViewerForScoring] as string | null | undefined;
    if (!wanted || wanted === "any") continue;
    if (candidate[key] === wanted) score += 5;
  }

  return score;
}
