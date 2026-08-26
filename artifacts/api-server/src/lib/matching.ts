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

// Maps each lifestyle field to the admin-configurable app_settings key
// that controls whether it's ALLOWED to hard-filter at all, platform-
// wide. This is deliberately separate from — and independent of — the
// per-user `dealbreakers` mechanism above: passesDealbreakers already
// lets an individual user opt a field into hard-filtering for
// themselves specifically. This map is the future-facing, admin-side
// switch: once the platform has enough users to safely narrow Discover
// pools, an admin flips ONE of these keys on and EVERY user's own
// preference for that field (set on their Preferences page, whether or
// not they ever touched "dealbreakers") starts being enforced as a real
// hard filter, with zero code changes needed at that point — see
// passesEnabledPreferenceFilters below. Kept as individual keys, one
// per field, rather than a single master switch, specifically so an
// admin can turn these on gradually and observe each one's effect on
// pool size before enabling the next, rather than committing to all of
// them simultaneously.
export const PREFERENCE_FILTER_SETTINGS_KEYS: Record<keyof LifestyleFields, string> = {
  num_kids: "filter_num_kids_enabled",
  family_plans: "filter_family_plans_enabled",
  smoking_status: "filter_smoking_enabled",
  vaping_status: "filter_vaping_enabled",
  drinking_status: "filter_drinking_enabled",
  nightlife_frequency: "filter_nightlife_enabled",
  has_tattoos: "filter_tattoos_enabled",
  pets: "filter_pets_enabled",
  activity_level: "filter_activity_level_enabled",
};

// Height gets its own settings key rather than reusing the shape above
// — it's a min/max RANGE preference (pref_height_min_cm/max_cm), not a
// single-value match like every other lifestyle field, so it needs its
// own check function (passesHeightRange below) rather than fitting into
// the generic per-field loop.
export const HEIGHT_FILTER_SETTINGS_KEY = "filter_height_enabled";

/** True if every lifestyle field the viewer has a specific preference
 *  set for (not "any"/empty) is satisfied by `candidate` — but ONLY for
 *  fields whose corresponding admin toggle (PREFERENCE_FILTER_SETTINGS_KEYS)
 *  is currently on. `enabledFilters` should be the live app_settings
 *  values, keyed by the SAME settings-key strings this file defines
 *  above — callers fetch these once per request the same way they
 *  already fetch dealbreakers_enabled/incognito_enabled elsewhere.
 *
 *  This intentionally does NOT check the viewer's `dealbreakers` array
 *  at all — that's a fully separate, independent hard-filter path
 *  (passesDealbreakers above), and a candidate must pass BOTH checks to
 *  stay in the pool. A field a user never dealbreaker'd can still
 *  exclude someone here, the moment an admin turns its platform-wide
 *  toggle on — that's the entire point: today, a set-but-not-flagged
 *  preference only ever influenced the soft score; once its toggle is
 *  on, it becomes a real requirement, with no code change needed at
 *  that point. */
export function passesEnabledPreferenceFilters(
  candidate: LifestyleFields,
  viewerPrefs: LifestyleFields,
  enabledFilters: Record<string, boolean>,
): boolean {
  for (const key of LIFESTYLE_FIELD_KEYS) {
    const settingsKey = PREFERENCE_FILTER_SETTINGS_KEYS[key];
    if (!enabledFilters[settingsKey]) continue;
    const wanted = viewerPrefs[key];
    if (!wanted || wanted === "any") continue;
    if (candidate[key] !== wanted) return false;
  }
  return true;
}

/** Height counterpart to passesAgeRange — but gated behind its own
 *  admin toggle (HEIGHT_FILTER_SETTINGS_KEY), unlike age range which is
 *  always enforced. Height preferences are currently informational/
 *  soft-scoring only; this is what will make them a real hard filter
 *  once the platform is ready, purely by an admin flipping one setting.
 *  Only applies when the viewer has actually set BOTH a min and a max
 *  — a partially-set range is treated as "no preference yet" rather
 *  than guessing at the missing bound. A candidate with no recorded
 *  height is kept rather than excluded, same reasoning as age range:
 *  excluding for missing data is punitive, not useful. */
export function passesHeightRange(
  candidateHeightCm: number | null | undefined,
  viewerPrefHeightMinCm: number | null | undefined,
  viewerPrefHeightMaxCm: number | null | undefined,
  enabledFilters: Record<string, boolean>,
): boolean {
  if (!enabledFilters[HEIGHT_FILTER_SETTINGS_KEY]) return true;
  if (candidateHeightCm == null) return true;
  if (viewerPrefHeightMinCm == null || viewerPrefHeightMaxCm == null) return true;
  return candidateHeightCm >= viewerPrefHeightMinCm && candidateHeightCm <= viewerPrefHeightMaxCm;
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
