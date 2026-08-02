// New lifestyle fields + their "preference" counterparts (what someone
// wants in a partner, as opposed to what they themselves are). Kept in
// their own file rather than merged into preferenceOptions.ts, since
// that file's exact current contents aren't available to check against.

export const TATTOO_OPTIONS = [
  { value: "none", label: "No tattoos" },
  { value: "have_some", label: "Have a few" },
  { value: "have_many", label: "Covered in tattoos" },
  { value: "want_one", label: "Want one someday" },
];

export const VAPING_OPTIONS = [
  { value: "never", label: "Never vapes" },
  { value: "occasionally", label: "Vapes occasionally" },
  { value: "regularly", label: "Vapes regularly" },
  { value: "trying_to_quit", label: "Trying to quit vaping" },
];

export const PETS_OPTIONS = [
  { value: "have_dog", label: "Have a dog" },
  { value: "have_cat", label: "Have a cat" },
  { value: "have_other", label: "Have other pets" },
  { value: "want_pets", label: "Want pets someday" },
  { value: "no_pets", label: "No pets" },
  { value: "allergic", label: "Allergic to pets" },
];

export const ACTIVITY_LEVEL_OPTIONS = [
  { value: "sedentary", label: "Not very active" },
  { value: "lightly_active", label: "Lightly active" },
  { value: "active", label: "Active" },
  { value: "very_active", label: "Very active / athlete" },
];

export const NIGHTLIFE_OPTIONS = [
  { value: "never", label: "Never goes out" },
  { value: "rarely", label: "Rarely goes out" },
  { value: "sometimes", label: "Goes out sometimes" },
  { value: "often", label: "Often goes out" },
];

// Preference variants — same vocabulary, plus a leading "doesn't matter"
// option. Kept as separate constants (rather than prepending at render
// time everywhere) so every preference dropdown is guaranteed consistent.
const withNoPreference = (options: { value: string; label: string }[]) => [
  { value: "any", label: "Doesn't matter" },
  ...options,
];

export const TATTOO_PREFERENCE_OPTIONS = withNoPreference(TATTOO_OPTIONS);
export const VAPING_PREFERENCE_OPTIONS = withNoPreference(VAPING_OPTIONS);
export const PETS_PREFERENCE_OPTIONS = withNoPreference(PETS_OPTIONS);
export const ACTIVITY_LEVEL_PREFERENCE_OPTIONS = withNoPreference(ACTIVITY_LEVEL_OPTIONS);
export const NIGHTLIFE_PREFERENCE_OPTIONS = withNoPreference(NIGHTLIFE_OPTIONS);

// Height unit conversion helpers — canonical storage is always cm.
export type HeightUnit = "cm" | "in" | "ft";

export function cmToDisplay(cm: number, unit: HeightUnit): string {
  if (unit === "cm") return String(Math.round(cm));
  if (unit === "in") return (cm / 2.54).toFixed(1);
  // ft: format as feet'inches"
  const totalInches = cm / 2.54;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches % 12);
  return `${feet}'${inches}"`;
}

export function displayToCm(value: string, unit: HeightUnit): number | null {
  if (!value.trim()) return null;
  if (unit === "cm") {
    const n = parseFloat(value);
    return isNaN(n) ? null : Math.round(n);
  }
  if (unit === "in") {
    const n = parseFloat(value);
    return isNaN(n) ? null : Math.round(n * 2.54);
  }
  // ft: expect "5'10" or "5'10\"" format, or just feet as a plain number
  const match = value.match(/(\d+)\s*'?\s*(\d+)?/);
  if (!match) return null;
  const feet = parseInt(match[1], 10) || 0;
  const inches = parseInt(match[2] ?? "0", 10) || 0;
  return Math.round((feet * 12 + inches) * 2.54);
}
