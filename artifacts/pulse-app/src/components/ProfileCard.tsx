import { useState, useRef } from "react";
import { MapPin, Baby, Users, Cigarette, Wine, Mic, Play, Pause } from "lucide-react";
import { PhotoCarousel, type CarouselPhoto } from "@/components/PhotoCarousel";

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
  photos: CarouselPhoto[];
  personality_tags: string[];
  looking_for?: string | null;
  num_kids?: string | null;
  family_plans?: string | null;
  smoking_status?: string | null;
  drinking_status?: string | null;
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

export function ProfileCard({ profile, active = true }: { profile: ProfileCardData; active?: boolean }) {
  const photos = profile.photos.length > 0 ? profile.photos : [];
  const [playingPromptId, setPlayingPromptId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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
    (profile.audio_prompts?.length ?? 0) > 0;

  return (
    <div className="w-full h-full bg-card border border-card-border rounded-3xl overflow-hidden shadow-2xl relative">
      <div className="w-full h-full overflow-y-auto">
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
            <h2 className="text-2xl font-['Syne'] font-bold text-white flex items-end gap-2 leading-tight">
              {profile.name} <span className="text-base font-normal text-white/80">{profile.age}</span>
            </h2>
            {profile.city && (
              <div className="flex items-center gap-1 text-white/70 text-xs mt-0.5">
                <MapPin size={12} /> {profile.city}
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
            {(profile.num_kids || profile.family_plans || profile.smoking_status || profile.drinking_status) && (
              <div className="flex flex-wrap gap-2 mb-3">
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
                {profile.drinking_status && DRINKING_LABELS[profile.drinking_status] && (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary text-secondary-foreground text-xs font-medium">
                    <Wine size={13} className="shrink-0" /> {DRINKING_LABELS[profile.drinking_status]}
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
