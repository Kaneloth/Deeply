import { useState, useRef, useEffect } from "react";
import { MapPin, Baby, Users, Cigarette, Wine, Mic, Play, Pause, BadgeCheck, Camera, Wind, PenTool, PawPrint, Dumbbell, PartyPopper, Ruler } from "lucide-react";
import { PhotoCarousel, type CarouselPhoto } from "@/components/PhotoCarousel";
import { TATTOO_OPTIONS, VAPING_OPTIONS, PETS_OPTIONS, ACTIVITY_LEVEL_OPTIONS, NIGHTLIFE_OPTIONS, cmToDisplay } from "@/lib/lifestylePreferenceOptions";

const PULL_REVEAL_THRESHOLD_PX = 50;

export interface AudioPromptData {
  id: string;
  prompt_question: string;
  audio_url: string;
  duration_seconds: number | null;
}

export interface ProfileCardData {
  id: string;
  name: string;
  age: number;
  bio: string | null;
  city: string | null;
  distance_km?: number | null;
  is_verified?: boolean;
  photo_verified?: boolean;
  photos: CarouselPhoto[];
  personality_tags: string[];
  looking_for?: string | null;
  num_kids?: string | null;
  family_plans?: string | null;
  smoking_status?: string | null;
  drinking_status?: string | null;
  vaping_status?: string | null;
  has_tattoos?: string | null;
  pets?: string | null;
  activity_level?: string | null;
  nightlife_frequency?: string | null;
  height_cm?: number | null;
  gender?: string | null;
  audio_prompts?: AudioPromptData[];
}

const NUM_KIDS_LABELS: Record<string, string> = {
  none: "No kids",
  one: "1 kid",
  two: "2 kids",
  three_plus: "3+ kids",
};

const FAMILY_PLANS_LABELS: Record<string, string> = {
  want_kids: "Wants kids",
  dont_want_kids: "Doesn't want kids",
  open_to_kids: "Open to kids",
  not_sure: "Not sure about kids",
};

const SMOKING_LABELS: Record<string, string> = {
  never: "Non-smoker",
  occasionally: "Smokes occasionally",
  regularly: "Smokes regularly",
  trying_to_quit: "Trying to quit smoking",
};

const DRINKING_LABELS: Record<string, string> = {
  never: "Doesn't drink",
  socially: "Drinks socially",
  regularly: "Drinks regularly",
};

// Converted from the imported options arrays (single source of truth
// with the edit form on ProfilePage) rather than redefined by hand here,
// so these can never drift out of sync with the actual stored values.
const toLabelMap = (options: { value: string; label: string }[]): Record<string, string> =>
  Object.fromEntries(options.map((o) => [o.value, o.label]));

const VAPING_LABELS = toLabelMap(VAPING_OPTIONS);
const TATTOO_LABELS = toLabelMap(TATTOO_OPTIONS);
const PETS_LABELS = toLabelMap(PETS_OPTIONS);
const ACTIVITY_LEVEL_LABELS = toLabelMap(ACTIVITY_LEVEL_OPTIONS);
const NIGHTLIFE_LABELS = toLabelMap(NIGHTLIFE_OPTIONS);

// NOT sourced from a shared options file (GENDER_OPTIONS wasn't
// available) — inferred from the value strings genderSatisfiesPreference
// uses elsewhere in this app ("man"/"woman"/"non_binary"/
// "prefer_not_to_say"). Worth confirming these match your actual
// GENDER_OPTIONS values if this ever displays incorrectly.
const GENDER_LABELS: Record<string, string> = {
  man: "Man",
  woman: "Woman",
  non_binary: "Non-binary",
  prefer_not_to_say: "Prefer not to say",
};

export function ProfileCard({
  profile,
  active = true,
  enablePullReveal = false,
}: {
  profile: ProfileCardData;
  active?: boolean;
  /** Opt-in only — makes sense on Discover, where another card is
   *  already stacked underneath this one. Elsewhere (Search, Invites,
   *  MatchDetail) there's nothing to reveal, so this stays off by
   *  default. */
  enablePullReveal?: boolean;
}) {
  const photos = profile.photos.length > 0 ? profile.photos : [];
  const [playingPromptId, setPlayingPromptId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Pull-down-to-reveal-next-card. Only claims the gesture when: the
  // drag is downward AND the scroll container is already at the very
  // top — otherwise this is either a normal scroll-back-up, or a
  // horizontal photo swipe (which PhotoCarousel's own touch handling
  // already deals with independently; this never interferes with that,
  // since it only acts on vertical-down-at-top drags).
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pullY, setPullY] = useState(0);
  const isPulling = pullY !== 0;
  const pullStateRef = useRef({ startY: 0, active: false, axisLocked: false, isPullGesture: false });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !active || !enablePullReveal) return;

    const onMove = (e: TouchEvent) => {
      const s = pullStateRef.current;
      if (!s.active) return;

      const dy = e.touches[0].clientY - s.startY;

      if (!s.axisLocked) {
        if (Math.abs(dy) < 8) return;
        s.axisLocked = true;
        s.isPullGesture = dy > 0 && el.scrollTop <= 0;
      }

      if (!s.isPullGesture) return;
      e.preventDefault();
      const eased = dy < PULL_REVEAL_THRESHOLD_PX ? dy : PULL_REVEAL_THRESHOLD_PX + (dy - PULL_REVEAL_THRESHOLD_PX) * 0.35;
      setPullY(eased);
    };

    el.addEventListener("touchmove", onMove, { passive: false });
    return () => el.removeEventListener("touchmove", onMove);
  }, [active, enablePullReveal]);

  const handlePullTouchStart = (e: React.TouchEvent) => {
    if (!active || !enablePullReveal) return;
    pullStateRef.current = { startY: e.touches[0].clientY, active: true, axisLocked: false, isPullGesture: false };
  };

  const handlePullTouchEnd = () => {
    pullStateRef.current.active = false;
    // Always springs back — this is a peek, not a decision. The card
    // underneath is only ever previewed, never actually swiped away by
    // this gesture.
    setPullY(0);
  };

  const togglePlayPrompt = (prompt: AudioPromptData) => {
    if (playingPromptId === prompt.id) {
      audioRef.current?.pause();
      setPlayingPromptId(null);
      return;
    }
    audioRef.current?.pause();
    const audio = new Audio(prompt.audio_url);
    audio.onended = () => setPlayingPromptId(null);
    audio.play();
    audioRef.current = audio;
    setPlayingPromptId(prompt.id);
  };

  const hasDetails =
    profile.personality_tags?.length > 0 ||
    !!profile.bio ||
    !!profile.num_kids ||
    !!profile.family_plans ||
    !!profile.smoking_status ||
    !!profile.drinking_status ||
    !!profile.vaping_status ||
    !!profile.has_tattoos ||
    !!profile.pets ||
    !!profile.activity_level ||
    !!profile.nightlife_frequency ||
    !!profile.height_cm ||
    !!profile.gender ||
    (profile.audio_prompts?.length ?? 0) > 0;

  return (
    <div
      className="w-full h-full bg-card border border-card-border rounded-3xl overflow-hidden shadow-2xl relative"
      style={{
        transform: pullY !== 0 ? `translateY(${pullY}px) scale(${1 - Math.min(pullY, 100) / 800})` : undefined,
        opacity: pullY !== 0 ? Math.max(0.4, 1 - pullY / 150) : 1,
        transition: isPulling ? "none" : "transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.3s ease-out",
      }}
    >
      <div
        ref={scrollRef}
        className="w-full h-full overflow-y-auto"
        onTouchStart={handlePullTouchStart}
        onTouchEnd={handlePullTouchEnd}
      >
        {/* Photo — fills the entire card by default (edge to edge), so
            it's the only thing visible until the user scrolls down.
            Name/age/location sit in a compact overlay strictly at the
            bottom edge, never in the middle of the image. */}
        <div className="relative w-full h-full min-h-full bg-muted">
          <PhotoCarousel photos={photos} name={profile.name} active={active} />

          <div
            className="absolute bottom-0 left-0 right-0 h-32 pointer-events-none"
            style={{
              background:
                "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.65) 30%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0.12) 78%, rgba(0,0,0,0) 100%)",
            }}
          />
          <div className="absolute bottom-3 left-4 right-4 pointer-events-none z-10">
            <h2 className="text-2xl font-['Syne'] font-bold text-white flex items-end gap-1.5 leading-tight">
              {profile.name} <span className="text-base font-normal text-white/80">{profile.age}</span>
              {profile.is_verified ? (
                <span
                  title="ID Verified"
                  className="inline-flex items-center gap-0.5 pl-1 pr-1.5 py-0.5 rounded-full bg-sky-500 text-white shrink-0 mb-0.5 ring-2 ring-black/10"
                >
                  <BadgeCheck size={11} strokeWidth={3} />
                  <span className="text-[10px] font-extrabold font-sans leading-none tracking-wide">ID</span>
                </span>
              ) : profile.photo_verified ? (
                <span
                  title="Photo Verified"
                  className="inline-flex items-center justify-center w-[17px] h-[17px] rounded-full bg-emerald-500 shrink-0 mb-1 ring-2 ring-black/10"
                >
                  <Camera size={10} className="text-white" strokeWidth={2.75} />
                </span>
              ) : null}
            </h2>
            {(profile.city || profile.distance_km != null) && (
              <div className="flex items-center gap-1 text-white/70 text-xs mt-0.5">
                <MapPin size={12} />
                {profile.city}
                {profile.city && profile.distance_km != null && " · "}
                {profile.distance_km != null && `${profile.distance_km} km away`}
              </div>
            )}
            {profile.looking_for && (
              <div className="text-white/70 text-xs mt-0.5">
                Looking for: <span className="text-white/90 font-medium">{profile.looking_for}</span>
              </div>
            )}
          </div>
        </div>

        {/* Details — below the fold, only reached by scrolling down past
            the photo. */}
        {hasDetails && (
          <div className="w-full bg-card px-5 py-4">
            {profile.audio_prompts && profile.audio_prompts.length > 0 && (
              <div className="space-y-2 mb-3">
                {profile.audio_prompts.map((prompt) => (
                  <button
                    key={prompt.id}
                    onClick={() => togglePlayPrompt(prompt)}
                    className="w-full flex items-center gap-3 bg-secondary/60 border border-card-border rounded-xl p-3 text-left"
                  >
                    <div className="w-9 h-9 rounded-full bg-gradient-accent flex items-center justify-center text-white shrink-0">
                      {playingPromptId === prompt.id ? <Pause size={15} /> : <Play size={15} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wide">
                        <Mic size={10} /> Audio prompt
                      </div>
                      <p className="text-sm font-medium line-clamp-2 leading-snug">{prompt.prompt_question}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {(profile.num_kids || profile.family_plans || profile.smoking_status || profile.drinking_status || profile.vaping_status || profile.has_tattoos || profile.pets || profile.activity_level || profile.nightlife_frequency || profile.height_cm || profile.gender) && (
              <div className="flex flex-wrap gap-2 mb-3">
                {profile.gender && GENDER_LABELS[profile.gender] && (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary text-secondary-foreground text-xs font-medium">
                    {GENDER_LABELS[profile.gender]}
                  </span>
                )}
                {profile.height_cm && (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary text-secondary-foreground text-xs font-medium">
                    <Ruler size={13} className="shrink-0" /> {cmToDisplay(profile.height_cm, "cm")} cm
                  </span>
                )}
                {profile.num_kids && NUM_KIDS_LABELS[profile.num_kids] && (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary text-secondary-foreground text-xs font-medium">
                    <Baby size={13} className="shrink-0" /> {NUM_KIDS_LABELS[profile.num_kids]}
                  </span>
                )}
                {profile.family_plans && FAMILY_PLANS_LABELS[profile.family_plans] && (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary text-secondary-foreground text-xs font-medium">
                    <Users size={13} className="shrink-0" /> {FAMILY_PLANS_LABELS[profile.family_plans]}
                  </span>
                )}
                {profile.smoking_status && SMOKING_LABELS[profile.smoking_status] && (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary text-secondary-foreground text-xs font-medium">
                    <Cigarette size={13} className="shrink-0" /> {SMOKING_LABELS[profile.smoking_status]}
                  </span>
                )}
                {profile.vaping_status && VAPING_LABELS[profile.vaping_status] && (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary text-secondary-foreground text-xs font-medium">
                    <Wind size={13} className="shrink-0" /> {VAPING_LABELS[profile.vaping_status]}
                  </span>
                )}
                {profile.drinking_status && DRINKING_LABELS[profile.drinking_status] && (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary text-secondary-foreground text-xs font-medium">
                    <Wine size={13} className="shrink-0" /> {DRINKING_LABELS[profile.drinking_status]}
                  </span>
                )}
                {profile.has_tattoos && TATTOO_LABELS[profile.has_tattoos] && (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary text-secondary-foreground text-xs font-medium">
                    <PenTool size={13} className="shrink-0" /> {TATTOO_LABELS[profile.has_tattoos]}
                  </span>
                )}
                {profile.pets && PETS_LABELS[profile.pets] && (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary text-secondary-foreground text-xs font-medium">
                    <PawPrint size={13} className="shrink-0" /> {PETS_LABELS[profile.pets]}
                  </span>
                )}
                {profile.activity_level && ACTIVITY_LEVEL_LABELS[profile.activity_level] && (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary text-secondary-foreground text-xs font-medium">
                    <Dumbbell size={13} className="shrink-0" /> {ACTIVITY_LEVEL_LABELS[profile.activity_level]}
                  </span>
                )}
                {profile.nightlife_frequency && NIGHTLIFE_LABELS[profile.nightlife_frequency] && (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary text-secondary-foreground text-xs font-medium">
                    <PartyPopper size={13} className="shrink-0" /> {NIGHTLIFE_LABELS[profile.nightlife_frequency]}
                  </span>
                )}
              </div>
            )}
            {profile.personality_tags?.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {profile.personality_tags.map((tag) => (
                  <span key={tag} className="px-3 py-1 rounded-full bg-secondary text-secondary-foreground text-xs font-medium">
                    {tag}
                  </span>
                ))}
              </div>
            )}
            {profile.bio && <p className="text-sm text-muted-foreground leading-relaxed">{profile.bio}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
