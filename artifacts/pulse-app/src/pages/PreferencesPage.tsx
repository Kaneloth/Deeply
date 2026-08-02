import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/PageHeader";
import { ChipGrid } from "@/components/SelectorControls";
import { Dropdown, RadiusSlider } from "@/components/DropdownControls";
import { HeightInput } from "@/components/HeightInput";
import {
  DATING_INTENTIONS,
  RELATIONSHIP_TYPES,
  LOOKING_FOR_OPTIONS,
  NUM_KIDS_OPTIONS,
  FAMILY_PLANS_OPTIONS,
  SMOKING_OPTIONS,
  DRINKING_OPTIONS,
} from "@/lib/preferenceOptions";
import {
  TATTOO_PREFERENCE_OPTIONS,
  VAPING_PREFERENCE_OPTIONS,
  PETS_PREFERENCE_OPTIONS,
  ACTIVITY_LEVEL_PREFERENCE_OPTIONS,
} from "@/lib/lifestylePreferenceOptions";

// Preference variants of the "about me" dropdowns, adding a leading
// "doesn't matter" option — mirrors the same pattern used for the new
// lifestyle fields in lifestylePreferenceOptions.ts.
const withNoPreference = (options: { value: string; label: string }[]) => [
  { value: "any", label: "Doesn't matter" },
  ...options,
];
const NUM_KIDS_PREFERENCE_OPTIONS = withNoPreference(NUM_KIDS_OPTIONS);
const FAMILY_PLANS_PREFERENCE_OPTIONS = withNoPreference(FAMILY_PLANS_OPTIONS);
const SMOKING_PREFERENCE_OPTIONS = withNoPreference(SMOKING_OPTIONS);
const DRINKING_PREFERENCE_OPTIONS = withNoPreference(DRINKING_OPTIONS);

export default function PreferencesPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [profile, setProfile] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const fetchProfile = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/profile/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load preferences");
      setProfile(body);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to load preferences.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [token, toast]);

  // Run once on mount only — same reload-on-token-refresh fix as
  // Profile/Discover.
  useEffect(() => {
    fetchProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [lookingForGender, setLookingForGender] = useState("");
  const [distanceKm, setDistanceKm] = useState(25);
  const [relationshipType, setRelationshipType] = useState("");
  const [intentions, setIntentions] = useState<string[]>([]);
  const [prefNumKids, setPrefNumKids] = useState("");
  const [prefFamilyPlans, setPrefFamilyPlans] = useState("");
  const [prefSmokingStatus, setPrefSmokingStatus] = useState("");
  const [prefDrinkingStatus, setPrefDrinkingStatus] = useState("");
  const [prefVapingStatus, setPrefVapingStatus] = useState("");
  const [prefHasTattoos, setPrefHasTattoos] = useState("");
  const [prefPets, setPrefPets] = useState("");
  const [prefActivityLevel, setPrefActivityLevel] = useState("");
  const [prefHeightMinCm, setPrefHeightMinCm] = useState<number | null>(null);
  const [prefHeightMaxCm, setPrefHeightMaxCm] = useState<number | null>(null);

  const toggleIntention = (v: string) => {
    setIntentions((prev) => (prev.includes(v) ? prev.filter((i) => i !== v) : prev.length < 3 ? [...prev, v] : prev));
  };

  useEffect(() => {
    if (profile) {
      setLookingForGender(profile.looking_for_gender || "");
      setDistanceKm(profile.distance_km ?? 25);
      setRelationshipType(profile.relationship_type || "");
      setIntentions(profile.dating_intentions || []);
      setPrefNumKids(profile.pref_num_kids || "");
      setPrefFamilyPlans(profile.pref_family_plans || "");
      setPrefSmokingStatus(profile.pref_smoking_status || "");
      setPrefDrinkingStatus(profile.pref_drinking_status || "");
      setPrefVapingStatus(profile.pref_vaping_status || "");
      setPrefHasTattoos(profile.pref_has_tattoos || "");
      setPrefPets(profile.pref_pets || "");
      setPrefActivityLevel(profile.pref_activity_level || "");
      setPrefHeightMinCm(profile.pref_height_min_cm ?? null);
      setPrefHeightMaxCm(profile.pref_height_max_cm ?? null);
    }
  }, [profile]);

  const hasChanges = profile && (
    lookingForGender !== (profile.looking_for_gender || "") ||
    distanceKm !== (profile.distance_km ?? 25) ||
    relationshipType !== (profile.relationship_type || "") ||
    JSON.stringify(intentions) !== JSON.stringify(profile.dating_intentions || []) ||
    prefNumKids !== (profile.pref_num_kids || "") ||
    prefFamilyPlans !== (profile.pref_family_plans || "") ||
    prefSmokingStatus !== (profile.pref_smoking_status || "") ||
    prefDrinkingStatus !== (profile.pref_drinking_status || "") ||
    prefVapingStatus !== (profile.pref_vaping_status || "") ||
    prefHasTattoos !== (profile.pref_has_tattoos || "") ||
    prefPets !== (profile.pref_pets || "") ||
    prefActivityLevel !== (profile.pref_activity_level || "") ||
    prefHeightMinCm !== (profile.pref_height_min_cm ?? null) ||
    prefHeightMaxCm !== (profile.pref_height_max_cm ?? null)
  );

  const handleSave = async () => {
    if (!profile) return;
    setIsSaving(true);
    try {
      const res = await fetch("/api/profile/me", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          looking_for_gender: lookingForGender,
          distance_km: distanceKm,
          relationship_type: relationshipType,
          dating_intentions: intentions,
          pref_num_kids: prefNumKids,
          pref_family_plans: prefFamilyPlans,
          pref_smoking_status: prefSmokingStatus,
          pref_drinking_status: prefDrinkingStatus,
          pref_vaping_status: prefVapingStatus,
          pref_has_tattoos: prefHasTattoos,
          pref_pets: prefPets,
          pref_activity_level: prefActivityLevel,
          pref_height_min_cm: prefHeightMinCm,
          pref_height_max_cm: prefHeightMaxCm,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to save preferences");
      setProfile(body);
      toast({ title: "Preferences updated", description: "Your changes have been saved." });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to save preferences.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className="p-6 pt-12"><Skeleton className="h-8 w-40 mb-8" /><Skeleton className="h-64 w-full" /></div>;
  }

  return (
    <div className="min-h-full px-6 pb-6 pt-6 bg-background">
      <PageHeader title="Preferences" />
      <p className="text-sm text-muted-foreground -mt-4 mb-6">
        What you're looking for in a match — separate from your own profile.
      </p>

      <div className="space-y-6">
        <Dropdown label="Looking for" value={lookingForGender} onChange={setLookingForGender} options={LOOKING_FOR_OPTIONS} />
        <RadiusSlider valueKm={distanceKm} onChange={setDistanceKm} />
        <Dropdown label="Relationship type" value={relationshipType} onChange={setRelationshipType} options={RELATIONSHIP_TYPES} />

        <div className="space-y-3">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider pl-1">
            What matters most to you (up to 3)
          </h3>
          <ChipGrid options={DATING_INTENTIONS} selected={intentions} onToggle={toggleIntention} max={3} />
        </div>

        <div className="pt-2 border-t border-border/50">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider pl-1 mt-4 mb-4">
            Lifestyle preferences
          </h3>
        </div>

        <Dropdown label="Kids" value={prefNumKids} onChange={setPrefNumKids} options={NUM_KIDS_PREFERENCE_OPTIONS} />
        <Dropdown label="Family plans" value={prefFamilyPlans} onChange={setPrefFamilyPlans} options={FAMILY_PLANS_PREFERENCE_OPTIONS} />
        <Dropdown label="Smoking" value={prefSmokingStatus} onChange={setPrefSmokingStatus} options={SMOKING_PREFERENCE_OPTIONS} />
        <Dropdown label="Vaping" value={prefVapingStatus} onChange={setPrefVapingStatus} options={VAPING_PREFERENCE_OPTIONS} />
        <Dropdown label="Drinking" value={prefDrinkingStatus} onChange={setPrefDrinkingStatus} options={DRINKING_PREFERENCE_OPTIONS} />
        <Dropdown label="Tattoos" value={prefHasTattoos} onChange={setPrefHasTattoos} options={TATTOO_PREFERENCE_OPTIONS} />
        <Dropdown label="Pets" value={prefPets} onChange={setPrefPets} options={PETS_PREFERENCE_OPTIONS} />
        <Dropdown label="Physical activity" value={prefActivityLevel} onChange={setPrefActivityLevel} options={ACTIVITY_LEVEL_PREFERENCE_OPTIONS} />

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider pl-1">Height range</label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Min</p>
              <HeightInput valueCm={prefHeightMinCm} onChange={setPrefHeightMinCm} placeholder="No min" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Max</p>
              <HeightInput valueCm={prefHeightMaxCm} onChange={setPrefHeightMaxCm} placeholder="No max" />
            </div>
          </div>
        </div>
      </div>

      {hasChanges && (
        <div className="mt-8 pb-2">
          <Button
            className="w-full h-14 rounded-2xl bg-foreground text-background hover:bg-foreground/90 font-bold text-lg shadow-2xl"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      )}
    </div>
  );
}
