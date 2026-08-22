import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { Image as ImageIcon, Check, ChevronLeft, Play, Pause, Crown } from "lucide-react";
import { RadioList, ChipGrid } from "@/components/SelectorControls";
import { RadiusSlider } from "@/components/DropdownControls";
import { AudioRecorderControl } from "@/components/AudioRecorderControl";
import { HeightInput } from "@/components/HeightInput";
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
  AUDIO_PROMPT_QUESTIONS,
} from "@/lib/preferenceOptions";
import {
  VAPING_OPTIONS,
  TATTOO_OPTIONS,
  PETS_OPTIONS,
  ACTIVITY_LEVEL_OPTIONS,
  NIGHTLIFE_OPTIONS,
} from "@/lib/lifestylePreferenceOptions";

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
  const [founderReveal, setFounderReveal] = useState<{ rank: number } | null>(null);

  const [name, setName] = useState("");
  const [gender, setGender] = useState("");
  const [birthday, setBirthday] = useState("");
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

  const [selectedPromptQuestion, setSelectedPromptQuestion] = useState<string | null>(null);
  const [customPromptDraft, setCustomPromptDraft] = useState("");
  const [isSavingAudio, setIsSavingAudio] = useState(false);
  const [audioSaved, setAudioSaved] = useState(false);
  const [savedAudioUrl, setSavedAudioUrl] = useState<string | null>(null);
  const [isPlayingSaved, setIsPlayingSaved] = useState(false);
  const savedAudioRef = useRef<HTMLAudioElement | null>(null);

  const [notifySparks, setNotifySparks] = useState(true);

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

  // The filename extension must match the blob's real format, not
  // assume web's audio/webm — native recordings (capacitor-voice-recorder)
  // come back as audio/aac or similar, and a mismatched extension is
  // exactly what produces an "unsupported format" rejection server-side.
  const audioExtensionFromMimeType = (mimeType: string): string => {
    const map: Record<string, string> = {
      "audio/webm": "webm",
      "audio/mp4": "m4a",
      "audio/aac": "aac",
      "audio/mpeg": "mp3",
      "audio/wav": "wav",
      "audio/x-wav": "wav",
      "audio/3gpp": "3gp",
    };
    return map[mimeType] ?? "webm";
  };

  const saveAudioPrompt = async (blob: Blob) => {
    if (!selectedPromptQuestion) return;
    setIsSavingAudio(true);
    try {
      const formData = new FormData();
      const extension = audioExtensionFromMimeType(blob.type);
      formData.append("audio", blob, `prompt.${extension}`);
      const uploadRes = await fetch("/api/prompts/audio-upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const uploadBody = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadBody.error ?? "Upload failed");

      const saveRes = await fetch("/api/prompts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ prompt_question: selectedPromptQuestion, audio_url: uploadBody.audio_url }),
      });
      if (!saveRes.ok) {
        const body = await saveRes.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to save prompt");
      }
      const savedPrompt = await saveRes.json();
      setSavedAudioUrl(savedPrompt.audio_url ?? uploadBody.audio_url);
      setAudioSaved(true);
      toast({ title: "Audio prompt saved" });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to save audio prompt.",
        variant: "destructive",
      });
    } finally {
      setIsSavingAudio(false);
    }
  };

  const toggleSavedPlayback = () => {
    if (!savedAudioUrl) return;
    if (isPlayingSaved) {
      savedAudioRef.current?.pause();
      setIsPlayingSaved(false);
      return;
    }
    if (!savedAudioRef.current) {
      savedAudioRef.current = new Audio(savedAudioUrl);
      savedAudioRef.current.onended = () => setIsPlayingSaved(false);
    }
    savedAudioRef.current.play();
    setIsPlayingSaved(true);
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
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to save profile");
      if (body.is_founder) {
        setFounderReveal({ rank: body.founder_rank });
      } else {
        setLocation("/discover");
      }
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to save your profile.",
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
          You're one of the first 112 people to join Deeply. You've earned the{" "}
          <span className="text-foreground font-semibold">Founders Badge</span> and{" "}
          <span className="text-foreground font-semibold">free ID verification</span> — no charge, ever.
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
              <div className="space-y-2">
                <label className="text-sm font-medium">I am a</label>
                <RadioList value={gender} onChange={setGender} options={GENDER_OPTIONS} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">My birthday</label>
                <Input
                  type="date"
                  value={birthday}
                  onChange={(e) => setBirthday(e.target.value)}
                  max={MAX_BIRTHDATE}
                  min={MIN_BIRTHDATE}
                  className="bg-card border-card-border h-12 rounded-xl"
                />
                <p className="text-xs text-muted-foreground">You must be 18 or older to use Deeply.</p>
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
          <StepShell step={step} onBack={goBack} onContinue={goNext} continueLabel={audioSaved ? "Continue" : "Skip for now"}>
            <h2 className="text-2xl font-['Syne'] font-bold mb-2">🎙️ Record an audio prompt.</h2>
            <p className="text-sm text-muted-foreground mb-6">Your voice helps people connect with you on a deeper level.</p>

            {!selectedPromptQuestion ? (
              <div className="space-y-2">
                <div className="flex gap-2 mb-1">
                  <Input
                    value={customPromptDraft}
                    onChange={(e) => setCustomPromptDraft(e.target.value)}
                    placeholder="Or write your own question..."
                    className="bg-card border-card-border h-11 rounded-xl text-sm"
                  />
                  <Button
                    onClick={() => {
                      if (customPromptDraft.trim()) {
                        setSelectedPromptQuestion(customPromptDraft.trim());
                        setCustomPromptDraft("");
                      }
                    }}
                    disabled={!customPromptDraft.trim()}
                    className="h-11 px-4 rounded-xl bg-gradient-accent border-0 shrink-0"
                  >
                    Use
                  </Button>
                </div>
                {AUDIO_PROMPT_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => setSelectedPromptQuestion(q)}
                    className="w-full text-left px-4 py-3 rounded-xl bg-card border border-card-border text-sm hover:border-primary/50 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="bg-card border border-card-border rounded-xl p-4">
                  <p className="text-sm font-medium">{selectedPromptQuestion}</p>
                  <button
                    onClick={() => {
                      setSelectedPromptQuestion(null);
                      setAudioSaved(false);
                      setSavedAudioUrl(null);
                    }}
                    className="text-xs text-muted-foreground mt-2 underline"
                  >
                    Choose a different question
                  </button>
                </div>

                {!audioSaved ? (
                  <AudioRecorderControl onSave={saveAudioPrompt} isSaving={isSavingAudio} />
                ) : (
                  <div className="flex items-center gap-3 bg-card border border-card-border rounded-xl p-3">
                    <button
                      onClick={toggleSavedPlayback}
                      className="w-10 h-10 rounded-full bg-gradient-accent flex items-center justify-center text-white shrink-0"
                    >
                      {isPlayingSaved ? <Pause size={16} /> : <Play size={16} />}
                    </button>
                    <p className="text-sm text-primary font-medium">✓ Saved — tap to listen</p>
                  </div>
                )}
              </div>
            )}
          </StepShell>
        )}

        {step === 22 && (
          <motion.div key={step} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex flex-col">
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <div className="text-5xl mb-6">🎉</div>
              <h1 className="text-3xl font-['Syne'] font-bold mb-3">You're all set!</h1>
              <p className="text-muted-foreground mb-6">Welcome to Deeply.</p>
              <p className="text-xs text-muted-foreground max-w-xs">💡 Tip: Add more photos and record an audio prompt to stand out.</p>
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
