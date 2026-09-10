import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { Image as ImageIcon, Check, ChevronLeft, Crown } from "lucide-react";
import { captureError } from "@/lib/sentry";
import { RadioList, ChipGrid } from "@/components/SelectorControls";
import { RadiusSlider } from "@/components/DropdownControls";
import { HeightInput } from "@/components/HeightInput";
import { PhoneVerificationFlow } from "@/components/PhoneVerificationFlow";
import {
  INTERESTS,
  DATING_INTENTIONS,
  RELATIONSHIP_TYPES,
  GENDER_OPTIONS,
  LOOKING_FOR_OPTIONS,
  NUM_KIDS_OPTIONS,
  FAMILY_PLANS_OPTIONS,
  SMOKING_OPTIONS,
  DRINKING_OPTIONS,
  LOVE_LANGUAGE_OPTIONS,
  EDUCATION_OPTIONS,
  LANGUAGES,
} from "@/lib/preferenceOptions";
import {
  VAPING_OPTIONS,
  TATTOO_OPTIONS,
  PETS_OPTIONS,
  ACTIVITY_LEVEL_OPTIONS,
  NIGHTLIFE_OPTIONS,
} from "@/lib/lifestylePreferenceOptions";

// Was 24 — the audio prompt step (old step 21) is removed entirely;
// that feature no longer exists (superseded by Voice Question, now
// recorded from the Profile page instead of during onboarding). Phone
// verification shifts from 22 to 21, Welcome from 23 to 22.
const TOTAL_STEPS = 23;

// Birthday picker bounds: must be at least 18, and a sane upper bound of
// 100 years old.
const today = new Date();
const MAX_BIRTHDATE = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate())
  .toISOString()
  .split("T")[0];
const MIN_BIRTHDATE = new Date(today.getFullYear() - 100, today.getMonth(), today.getDate())
  .toISOString()
  .split("T")[0];

// Youngest/oldest allowed birth YEAR specifically — used to build the
// year dropdown's own option list, so under-18 years are simply never
// selectable in the first place rather than only caught by validation
// after the fact. Note this alone isn't fully sufficient on its own:
// someone selecting exactly MAX_BIRTH_YEAR could still be under 18 if
// their birth month/day hasn't occurred yet this year (e.g. today is
// March, they select this year but a December day) — computeAge below
// is what catches that specific remaining edge case precisely.
const MAX_BIRTH_YEAR = today.getFullYear() - 18;
const MIN_BIRTH_YEAR = today.getFullYear() - 100;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Draft persistence key — this is the actual fix for "users avoid
// retrying once they see all their data has been deleted and have to
// start over." Nothing in this entire flow is saved to the backend
// until the single, final PUT at the very end (see handleComplete) —
// every answer up to that point lives only in this component's own
// React state. If that final submission ever fails, or the person
// gets redirected away for any reason before it succeeds, all of it
// was previously lost outright. Now it's mirrored to localStorage as
// they go, and restored automatically if they come back.
const ONBOARDING_DRAFT_KEY = "onboarding_draft_v1";

function computeAge(year: number, month: number, day: number): number {
  const dob = new Date(year, month - 1, day);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const hasHadBirthdayThisYear =
    now.getMonth() > dob.getMonth() || (now.getMonth() === dob.getMonth() && now.getDate() >= dob.getDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}

function StepShell({
  children,
  onContinue,
  onBack,
  continueLabel = "Continue",
  continueDisabled = false,
  step,
}: {
  children: React.ReactNode;
  onContinue: () => void;
  onBack?: () => void;
  continueLabel?: string;
  continueDisabled?: boolean;
  step: number;
}) {
  return (
    <motion.div
      key={step}
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.25 }}
      className="flex-1 flex flex-col"
    >
      {onBack && (
        <button
          onClick={onBack}
          className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-foreground mb-4 shrink-0"
        >
          <ChevronLeft size={18} />
        </button>
      )}
      <div className="flex-1 overflow-y-auto">{children}</div>
      <Button
        onClick={onContinue}
        disabled={continueDisabled}
        className="w-full h-14 rounded-xl text-lg font-semibold bg-gradient-accent border-0 mt-6 shrink-0 shadow-[0_4px_20px_rgba(225,29,72,0.3)]"
      >
        {continueLabel}
      </Button>
    </motion.div>
  );
}

export default function OnboardingPage() {
  const { token } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [step, setStep] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [founderReveal, setFounderReveal] = useState<{ rank: number; cap: number } | null>(null);

  const [name, setName] = useState("");
  const [gender, setGender] = useState("");
  const [birthDay, setBirthDay] = useState("");
  const [birthMonth, setBirthMonth] = useState("");
  const [birthYear, setBirthYear] = useState("");
  // Deliberately still exists as a derived value, not raw state — this
  // is what actually gets submitted, and what continueDisabled below
  // still checks. It only ever gets a value once all three pieces are
  // chosen AND the precise combination is confirmed to be 18+ — the
  // remaining edge case computeAge exists for (selecting exactly
  // MAX_BIRTH_YEAR but a birth month/day that hasn't happened yet this
  // year) means "all three fields filled" alone isn't sufficient.
  const birthday = (() => {
    if (!birthDay || !birthMonth || !birthYear) return "";
    if (computeAge(Number(birthYear), Number(birthMonth), Number(birthDay)) < 18) return "";
    return `${birthYear}-${birthMonth.padStart(2, "0")}-${birthDay.padStart(2, "0")}`;
  })();
  const showUnder18Warning =
    birthDay && birthMonth && birthYear && computeAge(Number(birthYear), Number(birthMonth), Number(birthDay)) < 18;
  // Resets the day back to empty rather than silently keeping a now-
  // invalid value (e.g. 31 selected, then month changed to February) —
  // forces an explicit re-pick instead of quietly substituting a
  // different day the person never actually chose for this combination.
  useEffect(() => {
    if (birthDay && birthMonth && birthYear) {
      const maxDay = new Date(Number(birthYear), Number(birthMonth), 0).getDate();
      if (Number(birthDay) > maxDay) setBirthDay("");
    }
  }, [birthMonth, birthYear, birthDay]);
  const [lookingForGender, setLookingForGender] = useState("");

  const [city, setCity] = useState("");
  const [distanceKm, setDistanceKm] = useState<number>(25);

  const [relationshipType, setRelationshipType] = useState("");
  const [intentions, setIntentions] = useState<string[]>([]);
  const [interests, setInterests] = useState<string[]>([]);
  const [bio, setBio] = useState("");

  const [numKids, setNumKids] = useState("");
  const [familyPlans, setFamilyPlans] = useState("");
  const [smokingStatus, setSmokingStatus] = useState("");
  const [vapingStatus, setVapingStatus] = useState("");
  const [drinkingStatus, setDrinkingStatus] = useState("");
  const [nightlifeFrequency, setNightlifeFrequency] = useState("");
  const [hasTattoos, setHasTattoos] = useState("");
  const [pets, setPets] = useState("");
  const [heightCm, setHeightCm] = useState<number | null>(null);
  const [activityLevel, setActivityLevel] = useState("");
  const [loveLanguage, setLoveLanguage] = useState("");
  const [education, setEducation] = useState("");
  const [languagesSpoken, setLanguagesSpoken] = useState<string[]>([]);
  const [languagesOther, setLanguagesOther] = useState("");

  const [photoCount, setPhotoCount] = useState(0);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [notifySparks, setNotifySparks] = useState(true);

  const [referralCode, setReferralCode] = useState("");
  const [referralCheck, setReferralCheck] = useState<{ status: "idle" | "checking" | "valid" | "invalid"; referrerName?: string }>({
    status: "idle",
  });
  // Defaults to false (hidden) until the actual setting loads — a brief
  // flash of a field that then disappears would be worse than a brief
  // moment where it's simply not there yet.
  const [referralProgramEnabled, setReferralProgramEnabled] = useState(false);
  const hasRestoredDraftRef = useRef(false);

  // Draft persistence — this is the actual fix for "users avoid

  // Runs once, and must run before the save-effect below ever fires
  // with the initial, empty state — otherwise that first save would
  // immediately overwrite a real, previously-saved draft with nothing,
  // before it even had a chance to be read back.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(ONBOARDING_DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw);
        if (draft.step !== undefined) setStep(draft.step);
        if (draft.name !== undefined) setName(draft.name);
        if (draft.gender !== undefined) setGender(draft.gender);
        if (draft.birthDay !== undefined) setBirthDay(draft.birthDay);
        if (draft.birthMonth !== undefined) setBirthMonth(draft.birthMonth);
        if (draft.birthYear !== undefined) setBirthYear(draft.birthYear);
        if (draft.lookingForGender !== undefined) setLookingForGender(draft.lookingForGender);
        if (draft.city !== undefined) setCity(draft.city);
        if (draft.distanceKm !== undefined) setDistanceKm(draft.distanceKm);
        if (draft.relationshipType !== undefined) setRelationshipType(draft.relationshipType);
        if (draft.intentions !== undefined) setIntentions(draft.intentions);
        if (draft.interests !== undefined) setInterests(draft.interests);
        if (draft.bio !== undefined) setBio(draft.bio);
        if (draft.numKids !== undefined) setNumKids(draft.numKids);
        if (draft.familyPlans !== undefined) setFamilyPlans(draft.familyPlans);
        if (draft.smokingStatus !== undefined) setSmokingStatus(draft.smokingStatus);
        if (draft.vapingStatus !== undefined) setVapingStatus(draft.vapingStatus);
        if (draft.drinkingStatus !== undefined) setDrinkingStatus(draft.drinkingStatus);
        if (draft.nightlifeFrequency !== undefined) setNightlifeFrequency(draft.nightlifeFrequency);
        if (draft.hasTattoos !== undefined) setHasTattoos(draft.hasTattoos);
        if (draft.pets !== undefined) setPets(draft.pets);
        if (draft.heightCm !== undefined) setHeightCm(draft.heightCm);
        if (draft.activityLevel !== undefined) setActivityLevel(draft.activityLevel);
        if (draft.loveLanguage !== undefined) setLoveLanguage(draft.loveLanguage);
        if (draft.education !== undefined) setEducation(draft.education);
        if (draft.languagesSpoken !== undefined) setLanguagesSpoken(draft.languagesSpoken);
        if (draft.languagesOther !== undefined) setLanguagesOther(draft.languagesOther);
        if (draft.notifySparks !== undefined) setNotifySparks(draft.notifySparks);
        if (draft.referralCode !== undefined) setReferralCode(draft.referralCode);
      }
    } catch {
      // Corrupted/unparseable draft — ignore and start fresh rather
      // than crash onboarding itself over a bad localStorage value.
    } finally {
      hasRestoredDraftRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hasRestoredDraftRef.current) return;
    const draft = {
      step, name, gender, birthDay, birthMonth, birthYear, lookingForGender,
      city, distanceKm, relationshipType, intentions, interests, bio,
      numKids, familyPlans, smokingStatus, vapingStatus, drinkingStatus,
      nightlifeFrequency, hasTattoos, pets, heightCm, activityLevel,
      loveLanguage, education, languagesSpoken, languagesOther,
      notifySparks, referralCode,
    };
    try {
      localStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Storage full/unavailable — non-critical, just skip this save.
    }
  }, [
    step, name, gender, birthDay, birthMonth, birthYear, lookingForGender,
    city, distanceKm, relationshipType, intentions, interests, bio,
    numKids, familyPlans, smokingStatus, vapingStatus, drinkingStatus,
    nightlifeFrequency, hasTattoos, pets, heightCm, activityLevel,
    loveLanguage, education, languagesSpoken, languagesOther,
    notifySparks, referralCode,
  ]);

  // Runs once on mount — whether to even show the referral code field
  // at all depends on this admin-controlled flag (same on/off pattern
  // as Incognito and Dealbreakers in AdminDashboard.tsx).
  useEffect(() => {
    fetch("/api/app-settings", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (body) setReferralProgramEnabled(body.referral_program_enabled !== false); // defaults on, matching the backend's own default
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced live validation as the person types — catches an invalid
  // or self-entered code immediately rather than only discovering it
  // after finishing the entire rest of onboarding. Deliberately doesn't
  // block continuing past this step either way (see continueDisabled
  // below, which never depends on this) — an unresolved or invalid code
  // just means no referral gets credited, never a hard stop.
  useEffect(() => {
    const trimmed = referralCode.trim();
    if (!trimmed) {
      setReferralCheck({ status: "idle" });
      return;
    }
    setReferralCheck({ status: "checking" });
    const timeoutId = setTimeout(() => {
      fetch(`/api/profile/referral/validate?code=${encodeURIComponent(trimmed)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => (res.ok ? res.json() : { valid: false }))
        .then((body) => {
          setReferralCheck(body.valid ? { status: "valid", referrerName: body.referrer_name } : { status: "invalid" });
        })
        .catch(() => setReferralCheck({ status: "invalid" }));
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [referralCode, token]);

  // Pre-fill whatever name already exists — currently only possible via
  // Google sign-in, which auto-populates it from Google's own profile
  // data without the person ever confirming it themselves. The Name
  // field below is always shown regardless (email signup no longer
  // collects a name at all — see AuthPage.tsx), so this only saves a
  // Google user from re-typing a name that's very likely already
  // correct, while still giving them the chance to see and edit it
  // before continuing. Runs once on mount; token doesn't change
  // mid-onboarding in any way relevant here.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/profile/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const body = await res.json();
        if (cancelled) return;
        if (body.name && typeof body.name === "string" && body.name.trim()) {
          setName(body.name);
        }
      } catch {
        // Non-fatal — the field just starts empty, same as any
        // email-signup user.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleIntention = (v: string) => {
    setIntentions((prev) => (prev.includes(v) ? prev.filter((i) => i !== v) : prev.length < 3 ? [...prev, v] : prev));
  };
  const toggleInterest = (v: string) => {
    setInterests((prev) => (prev.includes(v) ? prev.filter((i) => i !== v) : prev.length < 10 ? [...prev, v] : prev));
  };
  const toggleLanguage = (v: string) => {
    setLanguagesSpoken((prev) => (prev.includes(v) ? prev.filter((i) => i !== v) : prev.length < 5 ? [...prev, v] : prev));
  };

  const goNext = () => setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  const goBack = () => setStep((s) => Math.max(s - 1, 0));

  const handlePhotoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setIsUploadingPhoto(true);
    try {
      const formData = new FormData();
      formData.append("photo", file);
      const res = await fetch("/api/profile/me/photos", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Upload failed");
      setPhotoCount((c) => c + 1);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to upload photo.",
        variant: "destructive",
      });
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const handleComplete = async () => {
    setIsSaving(true);
    try {
      const res = await fetch("/api/profile/me", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name,
          gender,
          birthday,
          looking_for_gender: lookingForGender,
          city,
          distance_km: distanceKm,
          relationship_type: relationshipType,
          dating_intentions: intentions,
          personality_tags: interests,
          bio,
          num_kids: numKids,
          family_plans: familyPlans,
          smoking_status: smokingStatus,
          vaping_status: vapingStatus,
          drinking_status: drinkingStatus,
          nightlife_frequency: nightlifeFrequency,
          has_tattoos: hasTattoos,
          pets,
          height_cm: heightCm,
          activity_level: activityLevel,
          // Default every lifestyle preference to "doesn't matter" —
          // onboarding only ever asks about the user themselves for
          // these, never what they want in a partner, so without this
          // the Preferences page would show them all as blank/unset
          // until the user visits it manually. They can narrow any of
          // these down later; this just gives a sensible starting point
          // rather than nothing at all.
          pref_num_kids: "any",
          pref_family_plans: "any",
          pref_smoking_status: "any",
          pref_vaping_status: "any",
          pref_drinking_status: "any",
          pref_nightlife_frequency: "any",
          pref_has_tattoos: "any",
          pref_pets: "any",
          pref_activity_level: "any",
          love_language: loveLanguage,
          education,
          languages_spoken: languagesSpoken,
          languages_other: languagesOther,
          notify_sparks: notifySparks,
          onboarding_completed: true,
          ...(referralCode.trim() ? { referral_code_entered: referralCode.trim() } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to save profile");
      if (body.is_founder) {
        setFounderReveal({ rank: body.founder_rank, cap: body.founder_cap });
      } else {
        setLocation("/discover");
      }
      // Cleared only on genuine success — the draft's whole purpose is
      // to survive exactly the failure case below, so it must still be
      // there if this didn't actually work.
      try {
        localStorage.removeItem(ONBOARDING_DRAFT_KEY);
      } catch {
        // Non-critical either way.
      }
    } catch (err) {
      // Reported to Sentry specifically so this is actually visible
      // going forward, rather than only discoverable weeks later as
      // another incomplete profile quietly sitting in the admin
      // dashboard with no way to tell "this hit the bug" apart from
      // "this person just abandoned onboarding normally." Every prior
      // instance of this exact bug was only ever found this same
      // way — this closes that gap.
      captureError(err, {
        context: "OnboardingPage.handleComplete",
        message: err instanceof Error ? err.message : String(err),
      });
      toast({
        title: "Something went wrong saving your profile",
        description:
          (err instanceof Error ? err.message : "Failed to save your profile.") +
          " Your answers have been saved on this device — please try again, or contact support if this keeps happening.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (founderReveal) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center p-6 text-center bg-background relative">
        <div className="absolute top-0 right-0 w-[200px] h-[200px] bg-primary/10 blur-[80px] rounded-full pointer-events-none" />
        <div className="w-16 h-16 rounded-full bg-gradient-accent flex items-center justify-center mb-6">
          <Crown size={28} className="text-white" />
        </div>
        <h1 className="text-3xl font-['Syne'] font-bold mb-3">You're a Founder!</h1>
        <p className="text-muted-foreground max-w-xs">
          You're one of the first {founderReveal.cap} people to join Deeply. You've earned the{" "}
          <span className="text-foreground font-semibold">Founders Badge</span>,{" "}
          <span className="text-foreground font-semibold">free ID verification</span> — no charge, ever —{" "}
          and <span className="text-foreground font-semibold">double monthly Sparks</span>, for as long as you're on Deeply.
        </p>
        <Button
          onClick={() => setLocation("/discover")}
          className="w-full h-14 rounded-xl text-lg font-semibold bg-gradient-accent border-0 mt-8 shadow-[0_4px_20px_rgba(225,29,72,0.3)]"
        >
          Continue
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col p-6 w-full bg-background relative pt-12 pb-8">
      <div className="absolute top-0 right-0 w-[200px] h-[200px] bg-primary/10 blur-[80px] rounded-full pointer-events-none" />

      {step > 0 && step < TOTAL_STEPS - 1 && (
        <div className="flex gap-1 mb-8 z-10 shrink-0">
          {Array.from({ length: TOTAL_STEPS - 2 }).map((_, i) => (
            <div key={i} className={`flex-1 h-1 rounded-full ${i <= step - 1 ? "bg-primary" : "bg-secondary"}`} />
          ))}
        </div>
      )}

      <AnimatePresence mode="wait">
        {step === 0 && (
          <StepShell step={step} onContinue={goNext} continueLabel="Get Started">
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 rounded-full bg-gradient-accent flex items-center justify-center mb-6">
                <span className="text-3xl">⚡</span>
              </div>
              <h1 className="text-3xl font-['Syne'] font-bold text-foreground tracking-tight">
                Deep connections begin with a <span className="text-primary">spark.</span>
              </h1>
              <p className="text-muted-foreground mt-4 max-w-xs">
                Find people who share your values — without the noise.
              </p>
            </div>
          </StepShell>
        )}

        {step === 1 && (
          <StepShell
            step={step}
            onBack={goBack}
            onContinue={goNext}
            continueDisabled={!name.trim() || !gender || !birthday || !lookingForGender}
          >
            <h2 className="text-2xl font-['Syne'] font-bold mb-6">Tell us about yourself.</h2>
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-medium">Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="bg-card border-card-border h-12 rounded-xl" />
              </div>
              {referralProgramEnabled && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Referral code (optional)</label>
                  <Input
                    value={referralCode}
                    onChange={(e) => setReferralCode(e.target.value)}
                    placeholder="DLY-1234ABC"
                    className="bg-card border-card-border h-12 rounded-xl uppercase"
                  />
                  {referralCheck.status === "valid" && (
                    <p className="text-xs text-green-600">
                      ✅ Valid code{referralCheck.referrerName ? ` from ${referralCheck.referrerName}` : ""} — they'll earn Sparks once you finish setting up your profile.
                    </p>
                  )}
                  {referralCheck.status === "invalid" && (
                    <p className="text-xs text-destructive">That code doesn't look right — double-check it, or leave this blank.</p>
                  )}
                </div>
              )}
              <div className="space-y-2">
                <label className="text-sm font-medium">I am a</label>
                <RadioList value={gender} onChange={setGender} options={GENDER_OPTIONS} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">My birthday</label>
                {/* Three separate pickers, not a single native date
                    input — deliberately. The native picker's own `max`
                    was set to exactly the youngest allowed date, and
                    browsers/WebViews typically open a date picker
                    already showing that max value when nothing's been
                    chosen yet — meaning "just tap confirm without
                    navigating" landed on exactly age 18 every time,
                    which is confirmed to be exactly what was happening
                    at scale. Three separate, empty-by-default dropdowns
                    have no single "just accept it" action available —
                    each one requires its own deliberate choice, and the
                    year dropdown's own option list never includes an
                    under-18 year at all, rather than only validating
                    after the fact. */}
                <div className="grid grid-cols-3 gap-2">
                  <select
                    value={birthDay}
                    onChange={(e) => setBirthDay(e.target.value)}
                    className="bg-card border border-card-border h-12 rounded-xl px-2 text-sm"
                  >
                    <option value="">Day</option>
                    {Array.from(
                      {
                        length:
                          birthMonth && birthYear
                            ? new Date(Number(birthYear), Number(birthMonth), 0).getDate()
                            : 31,
                      },
                      (_, i) => i + 1,
                    ).map((d) => (
                      <option key={d} value={String(d)}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <select
                    value={birthMonth}
                    onChange={(e) => setBirthMonth(e.target.value)}
                    className="bg-card border border-card-border h-12 rounded-xl px-2 text-sm"
                  >
                    <option value="">Month</option>
                    {MONTH_NAMES.map((name, i) => (
                      <option key={name} value={String(i + 1)}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={birthYear}
                    onChange={(e) => setBirthYear(e.target.value)}
                    className="bg-card border border-card-border h-12 rounded-xl px-2 text-sm"
                  >
                    <option value="">Year</option>
                    {Array.from({ length: MAX_BIRTH_YEAR - MIN_BIRTH_YEAR + 1 }, (_, i) => MAX_BIRTH_YEAR - i).map((y) => (
                      <option key={y} value={String(y)}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
                {showUnder18Warning ? (
                  <p className="text-xs text-destructive">
                    That date makes you younger than 18 — Deeply is for adults only. Please double-check your birth year.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">You must be 18 or older to use Deeply.</p>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">I'm looking for</label>
                <RadioList value={lookingForGender} onChange={setLookingForGender} options={LOOKING_FOR_OPTIONS} />
              </div>
            </div>
          </StepShell>
        )}

        {step === 2 && (
          <StepShell step={step} onBack={goBack} onContinue={goNext} continueDisabled={!city.trim()}>
            <h2 className="text-2xl font-['Syne'] font-bold mb-6">Where are you?</h2>
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-medium">City</label>
                <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Johannesburg" className="bg-card border-card-border h-12 rounded-xl" />
              </div>
              <RadiusSlider valueKm={distanceKm} onChange={setDistanceKm} />
            </div>
          </StepShell>
        )}

        {step === 3 && (
          <StepShell step={step} onBack={goBack} onContinue={goNext} continueDisabled={!relationshipType}>
            <h2 className="text-2xl font-['Syne'] font-bold mb-6">What type of relationship are you looking for?</h2>
            <RadioList value={relationshipType} onChange={setRelationshipType} options={RELATIONSHIP_TYPES} />
          </StepShell>
        )}

        {step === 4 && (
          <StepShell step={step} onBack={goBack} onContinue={goNext} continueDisabled={intentions.length === 0}>
            <h2 className="text-2xl font-['Syne'] font-bold mb-2">What's most important to you in a connection?</h2>
            <p className="text-sm text-muted-foreground mb-6">Select up to 3.</p>
            <ChipGrid options={DATING_INTENTIONS} selected={intentions} onToggle={toggleIntention} max={3} />
          </StepShell>
        )}

        {step === 5 && (
          <StepShell step={step} onBack={goBack} onContinue={goNext} continueDisabled={interests.length === 0}>
            <h2 className="text-2xl font-['Syne'] font-bold mb-2">What do you love?</h2>
            <p className="text-sm text-muted-foreground mb-6">Select up to 10 interests.</p>
            <ChipGrid options={INTERESTS} selected={interests} onToggle={toggleInterest} max={10} />
          </StepShell>
        )}

        {step === 6 && (
          <StepShell step={step} onBack={goBack} onContinue={goNext} continueDisabled={!bio.trim()}>
            <h2 className="text-2xl font-['Syne'] font-bold mb-2">Write a short bio.</h2>
            <p className="text-sm text-muted-foreground mb-6">Tell people who you are — and what you're looking for.</p>
            <Textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Share something real..."
              className="bg-card border-card-border min-h-[140px] resize-none rounded-xl p-4"
            />
            <p className="text-xs text-muted-foreground mt-3">⚠️ Tip: Profiles with a bio get 3x more matches.</p>
          </StepShell>
        )}

        {step === 7 && (
          <StepShell step={step} onBack={goBack} onContinue={goNext} continueLabel={numKids ? "Continue" : "Skip for now"}>
            <h2 className="text-2xl font-['Syne'] font-bold mb-6">Do you have kids?</h2>
            <RadioList value={numKids} onChange={setNumKids} options={NUM_KIDS_OPTIONS} />
          </StepShell>
        )}

        {step === 8 && (
          <StepShell step={step} onBack={goBack} onContinue={goNext} continueLabel={familyPlans ? "Continue" : "Skip for now"}>
            <h2 className="text-2xl font-['Syne'] font-bold mb-6">What are your family plans?</h2>
            <RadioList value={familyPlans} onChange={setFamilyPlans} options={FAMILY_PLANS_OPTIONS} />
          </StepShell>
        )}

        {step === 9 && (
          <StepShell step={step} onBack={goBack} onContinue={goNext} continueLabel={smokingStatus ? "Continue" : "Skip for now"}>
            <h2 className="text-2xl font-['Syne'] font-bold mb-6">Do you smoke?</h2>
            <RadioList value={smokingStatus} onChange={setSmokingStatus} options={SMOKING_OPTIONS} />
          </StepShell>
        )}

        {step === 10 && (
          <StepShell step={step} onBack={goBack} onContinue={goNext} continueLabel={vapingStatus ? "Continue" : "Skip for now"}>
            <h2 className="text-2xl font-['Syne'] font-bold mb-6">Do you vape?</h2>
            <RadioList value={vapingStatus} onChange={setVapingStatus} options={VAPING_OPTIONS} />
          </StepShell>
        )}

        {step === 11 && (
          <StepShell step={step} onBack={goBack} onContinue={goNext} continueLabel={drinkingStatus ? "Continue" : "Skip for now"}>
            <h2 className="text-2xl font-['Syne'] font-bold mb-6">Do you drink?</h2>
            <RadioList value={drinkingStatus} onChange={setDrinkingStatus} options={DRINKING_OPTIONS} />
          </StepShell>
        )}

        {step === 12 && (
          <StepShell step={step} onBack={goBack} onContinue={goNext} continueLabel={nightlifeFrequency ? "Continue" : "Skip for now"}>
            <h2 className="text-2xl font-['Syne'] font-bold mb-2">Do you go clubbing or out at night?</h2>
            <p className="text-sm text-muted-foreground mb-6">How often do you hit clubs or night outs?</p>
            <RadioList value={nightlifeFrequency} onChange={setNightlifeFrequency} options={NIGHTLIFE_OPTIONS} />
          </StepShell>
        )}

        {step === 13 && (
          <StepShell step={step} onBack={goBack} onContinue={goNext} continueLabel={hasTattoos ? "Continue" : "Skip for now"}>
            <h2 className="text-2xl font-['Syne'] font-bold mb-6">Do you have any tattoos?</h2>
            <RadioList value={hasTattoos} onChange={setHasTattoos} options={TATTOO_OPTIONS} />
          </StepShell>
        )}

        {step === 14 && (
          <StepShell step={step} onBack={goBack} onContinue={goNext} continueLabel={pets ? "Continue" : "Skip for now"}>
            <h2 className="text-2xl font-['Syne'] font-bold mb-6">Do you have pets?</h2>
            <RadioList value={pets} onChange={setPets} options={PETS_OPTIONS} />
          </StepShell>
        )}

        {step === 15 && (
          <StepShell step={step} onBack={goBack} onContinue={goNext} continueLabel={heightCm ? "Continue" : "Skip for now"}>
            <h2 className="text-2xl font-['Syne'] font-bold mb-6">How tall are you?</h2>
            <HeightInput valueCm={heightCm} onChange={setHeightCm} />
          </StepShell>
        )}

        {step === 16 && (
          <StepShell step={step} onBack={goBack} onContinue={goNext} continueLabel={activityLevel ? "Continue" : "Skip for now"}>
            <h2 className="text-2xl font-['Syne'] font-bold mb-6">How active are you?</h2>
            <RadioList value={activityLevel} onChange={setActivityLevel} options={ACTIVITY_LEVEL_OPTIONS} />
          </StepShell>
        )}

        {step === 17 && (
          <StepShell step={step} onBack={goBack} onContinue={goNext} continueLabel={loveLanguage ? "Continue" : "Skip for now"}>
            <h2 className="text-2xl font-['Syne'] font-bold mb-6">What's your love language?</h2>
            <RadioList value={loveLanguage} onChange={setLoveLanguage} options={LOVE_LANGUAGE_OPTIONS} />
          </StepShell>
        )}

        {step === 18 && (
          <StepShell step={step} onBack={goBack} onContinue={goNext} continueLabel={education ? "Continue" : "Skip for now"}>
            <h2 className="text-2xl font-['Syne'] font-bold mb-6">Highest level of education?</h2>
            <RadioList value={education} onChange={setEducation} options={EDUCATION_OPTIONS} />
          </StepShell>
        )}

        {step === 19 && (
          <StepShell step={step} onBack={goBack} onContinue={goNext} continueLabel={languagesSpoken.length > 0 ? "Continue" : "Skip for now"}>
            <h2 className="text-2xl font-['Syne'] font-bold mb-2">What languages do you speak?</h2>
            <p className="text-sm text-muted-foreground mb-6">Select up to 5.</p>
            <ChipGrid options={LANGUAGES} selected={languagesSpoken} onToggle={toggleLanguage} max={5} />
            {languagesSpoken.includes("Other") && (
              <div className="space-y-2 mt-4">
                <label className="text-sm font-medium">Other language(s)</label>
                <Input
                  value={languagesOther}
                  onChange={(e) => setLanguagesOther(e.target.value)}
                  placeholder="e.g. Portuguese, Mandarin"
                  className="bg-card border-card-border h-12 rounded-xl"
                />
              </div>
            )}
          </StepShell>
        )}

        {step === 20 && (
          <StepShell step={step} onBack={goBack} onContinue={goNext} continueLabel={photoCount > 0 ? "Continue" : "Skip for now"}>
            <h2 className="text-2xl font-['Syne'] font-bold mb-2">📸 Photos & Video</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Add up to 8 photos and a 5-second clip from your Profile page any time. Adding at least one now helps people recognize you right away.
            </p>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {Array.from({ length: photoCount }).map((_, i) => (
                <div key={i} className="aspect-square rounded-xl bg-secondary flex items-center justify-center">
                  <Check size={20} className="text-primary" />
                </div>
              ))}
              <button
                onClick={() => photoInputRef.current?.click()}
                disabled={isUploadingPhoto}
                className="aspect-square rounded-xl border-2 border-dashed border-card-border flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors disabled:opacity-50"
              >
                {isUploadingPhoto ? (
                  <span className="text-xs">Uploading...</span>
                ) : (
                  <>
                    <ImageIcon size={20} />
                    <span className="text-xs">Add</span>
                  </>
                )}
              </button>
            </div>
            <input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePhotoSelected} className="hidden" />
            {photoCount > 0 && <p className="text-xs text-primary">{photoCount} photo{photoCount === 1 ? "" : "s"} added</p>}
          </StepShell>
        )}

        {step === 21 && (
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.25 }}
            className="flex-1 flex flex-col"
          >
            <button
              onClick={goBack}
              className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-foreground mb-4 shrink-0"
            >
              <ChevronLeft size={18} />
            </button>
            <div className="flex-1 overflow-y-auto">
              <PhoneVerificationFlow onVerified={() => goNext()} onSkip={goNext} />
            </div>
          </motion.div>
        )}

        {step === 22 && (
          <motion.div key={step} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex flex-col">
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <div className="text-5xl mb-6">🎉</div>
              <h1 className="text-3xl font-['Syne'] font-bold mb-3">You're all set!</h1>
              <p className="text-muted-foreground mb-6">Welcome to Deeply.</p>
              <p className="text-xs text-muted-foreground max-w-xs">💡 Tip: Add more photos and record a Voice Question from your profile to stand out.</p>
            </div>
            <Button
              onClick={handleComplete}
              disabled={isSaving}
              className="w-full h-14 rounded-xl text-lg font-semibold bg-gradient-accent border-0 mt-6 shadow-[0_4px_20px_rgba(225,29,72,0.3)]"
            >
              {isSaving ? "Saving..." : "Start Exploring"}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
