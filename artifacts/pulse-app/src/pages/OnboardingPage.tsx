import { useState, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, Square, Play, Pause, Image as ImageIcon, Bell, X, Check } from "lucide-react";
import { RadioList, ChipGrid } from "@/components/SelectorControls";
import {
  INTERESTS,
  DATING_INTENTIONS,
  RELATIONSHIP_TYPES,
  DISTANCE_OPTIONS,
  GENDER_OPTIONS,
  LOOKING_FOR_OPTIONS,
} from "@/lib/preferenceOptions";

const AUDIO_PROMPTS = [
  "What's your favorite travel memory?",
  "What does a perfect Sunday look like to you?",
  "What's something you're truly passionate about?",
  "What's the best advice you've ever received?",
  "Describe your ideal first date.",
  "What makes you laugh?",
  "What's a hidden talent you have?",
  "What's something you're currently learning?",
];

const TOTAL_STEPS = 11;

function StepShell({
  children,
  onContinue,
  continueLabel = "Continue",
  continueDisabled = false,
  step,
}: {
  children: React.ReactNode;
  onContinue: () => void;
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

  const [photoCount, setPhotoCount] = useState(0);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [selectedPromptQuestion, setSelectedPromptQuestion] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [isSavingAudio, setIsSavingAudio] = useState(false);
  const [audioSaved, setAudioSaved] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);

  const toggleIntention = (v: string) => {
    setIntentions((prev) => (prev.includes(v) ? prev.filter((i) => i !== v) : prev.length < 3 ? [...prev, v] : prev));
  };

  const toggleInterest = (v: string) => {
    setInterests((prev) => (prev.includes(v) ? prev.filter((i) => i !== v) : prev.length < 10 ? [...prev, v] : prev));
  };

  const goNext = () => setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));

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

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
        setRecordedBlob(blob);
        stream.getTracks().forEach((t) => t.stop());
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordedBlob(null);
      setAudioSaved(false);

      setTimeout(() => {
        if (mediaRecorderRef.current?.state === "recording") {
          mediaRecorderRef.current.stop();
          setIsRecording(false);
        }
      }, 30000);
    } catch {
      toast({
        title: "Microphone unavailable",
        description: "We couldn't access your microphone. You can add an audio prompt later from your Profile page.",
        variant: "destructive",
      });
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

  const togglePreview = () => {
    if (!recordedBlob) return;
    if (!audioPreviewRef.current) {
      audioPreviewRef.current = new Audio(URL.createObjectURL(recordedBlob));
      audioPreviewRef.current.onended = () => setIsPlayingPreview(false);
    }
    if (isPlayingPreview) {
      audioPreviewRef.current.pause();
      setIsPlayingPreview(false);
    } else {
      audioPreviewRef.current.play();
      setIsPlayingPreview(true);
    }
  };

  const saveAudioPrompt = async () => {
    if (!recordedBlob || !selectedPromptQuestion) return;
    setIsSavingAudio(true);
    try {
      const formData = new FormData();
      formData.append("audio", recordedBlob, "prompt.webm");
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

  const requestNotifications = async () => {
    try {
      if ("Notification" in window) {
        await Notification.requestPermission();
      }
    } catch {
      // Non-fatal — just continue either way.
    }
    goNext();
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
          onboarding_completed: true,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to save profile");
      setLocation("/discover");
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
                Deep connections begin with a <span className="text-transparent bg-clip-text bg-gradient-accent">spark.</span>
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
                <Input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} className="bg-card border-card-border h-12 rounded-xl" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">I'm looking for</label>
                <RadioList value={lookingForGender} onChange={setLookingForGender} options={LOOKING_FOR_OPTIONS} />
              </div>
            </div>
          </StepShell>
        )}

        {step === 2 && (
          <StepShell step={step} onContinue={goNext} continueDisabled={!city.trim()}>
            <h2 className="text-2xl font-['Syne'] font-bold mb-6">Where are you?</h2>
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-medium">City</label>
                <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Johannesburg" className="bg-card border-card-border h-12 rounded-xl" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Distance preference</label>
                <RadioList
                  value={String(distanceKm)}
                  onChange={(v) => setDistanceKm(Number(v))}
                  options={DISTANCE_OPTIONS.map((d) => ({ value: String(d), label: d === 999 ? "Anywhere" : `Within ${d} km` }))}
                />
              </div>
            </div>
          </StepShell>
        )}

        {step === 3 && (
          <StepShell step={step} onContinue={goNext} continueDisabled={!relationshipType}>
            <h2 className="text-2xl font-['Syne'] font-bold mb-6">What type of relationship are you looking for?</h2>
            <RadioList value={relationshipType} onChange={setRelationshipType} options={RELATIONSHIP_TYPES} />
          </StepShell>
        )}

        {step === 4 && (
          <StepShell step={step} onContinue={goNext} continueDisabled={intentions.length === 0}>
            <h2 className="text-2xl font-['Syne'] font-bold mb-2">What's most important to you in a connection?</h2>
            <p className="text-sm text-muted-foreground mb-6">Select up to 3.</p>
            <ChipGrid options={DATING_INTENTIONS} selected={intentions} onToggle={toggleIntention} max={3} />
          </StepShell>
        )}

        {step === 5 && (
          <StepShell step={step} onContinue={goNext} continueDisabled={interests.length === 0}>
            <h2 className="text-2xl font-['Syne'] font-bold mb-2">What do you love?</h2>
            <p className="text-sm text-muted-foreground mb-6">Select up to 10 interests.</p>
            <ChipGrid options={INTERESTS} selected={interests} onToggle={toggleInterest} max={10} />
          </StepShell>
        )}

        {step === 6 && (
          <StepShell step={step} onContinue={goNext} continueDisabled={!bio.trim()}>
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
          <StepShell step={step} onContinue={goNext} continueLabel={photoCount > 0 ? "Continue" : "Skip for now"}>
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

        {step === 8 && (
          <StepShell step={step} onContinue={goNext} continueLabel={audioSaved ? "Continue" : "Skip for now"}>
            <h2 className="text-2xl font-['Syne'] font-bold mb-2">🎙️ Record an audio prompt.</h2>
            <p className="text-sm text-muted-foreground mb-6">Your voice helps people connect with you on a deeper level.</p>

            {!selectedPromptQuestion ? (
              <div className="space-y-2">
                {AUDIO_PROMPTS.map((q) => (
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
              <div className="space-y-5">
                <div className="bg-card border border-card-border rounded-xl p-4">
                  <p className="text-sm font-medium">{selectedPromptQuestion}</p>
                  <button
                    onClick={() => {
                      setSelectedPromptQuestion(null);
                      setRecordedBlob(null);
                      setAudioSaved(false);
                    }}
                    className="text-xs text-muted-foreground mt-2 underline"
                  >
                    Choose a different question
                  </button>
                </div>

                <div className="flex flex-col items-center gap-4 py-6">
                  {!recordedBlob ? (
                    <button
                      onClick={isRecording ? stopRecording : startRecording}
                      className={`w-20 h-20 rounded-full flex items-center justify-center transition-colors ${
                        isRecording ? "bg-destructive" : "bg-gradient-accent"
                      }`}
                    >
                      {isRecording ? <Square size={26} className="text-white fill-current" /> : <Mic size={28} className="text-white" />}
                    </button>
                  ) : (
                    <div className="flex items-center gap-4">
                      <button onClick={togglePreview} className="w-14 h-14 rounded-full bg-secondary flex items-center justify-center">
                        {isPlayingPreview ? <Pause size={20} /> : <Play size={20} />}
                      </button>
                      <button
                        onClick={() => setRecordedBlob(null)}
                        className="w-14 h-14 rounded-full bg-card border border-card-border flex items-center justify-center text-muted-foreground"
                      >
                        <X size={18} />
                      </button>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {isRecording ? "Recording... (up to 30s)" : recordedBlob ? "Preview your recording, or discard and retry" : "Tap to record"}
                  </p>
                </div>

                {recordedBlob && !audioSaved && (
                  <Button onClick={saveAudioPrompt} disabled={isSavingAudio} className="w-full h-12 rounded-xl bg-gradient-accent border-0">
                    {isSavingAudio ? "Saving..." : "Save This Prompt"}
                  </Button>
                )}
                {audioSaved && <p className="text-sm text-primary text-center">✓ Saved</p>}
              </div>
            )}
          </StepShell>
        )}

        {step === 9 && (
          <StepShell step={step} onContinue={requestNotifications} continueLabel="Allow Notifications">
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-6">
                <Bell size={28} className="text-primary" />
              </div>
              <h2 className="text-2xl font-['Syne'] font-bold mb-6">Stay connected.</h2>
              <div className="space-y-3 text-left w-full max-w-xs">
                <p className="text-sm text-muted-foreground">💬 Someone messages you</p>
                <p className="text-sm text-muted-foreground">❤️ You get a new match</p>
                <p className="text-sm text-muted-foreground">🔥 Someone likes your profile</p>
                <p className="text-sm text-muted-foreground">🎁 Your free Sparks are granted</p>
              </div>
            </div>
          </StepShell>
        )}

        {step === 10 && (
          <motion.div key={step} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex flex-col">
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <div className="text-5xl mb-6">🎉</div>
              <h1 className="text-3xl font-['Syne'] font-bold mb-3">You're all set!</h1>
              <p className="text-muted-foreground mb-1">Welcome to Deeply.</p>
              <p className="text-muted-foreground mb-6">You have 300 free Sparks to get started.</p>
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
