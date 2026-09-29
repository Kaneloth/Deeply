import { useState, useRef } from "react";
import { MapPin, Baby, Users, Cigarette, Wine, Mic, Play, Pause, BadgeCheck, Camera, Wind, PenTool, PawPrint, Dumbbell, PartyPopper, Ruler, Crown, Search, Sparkles, GraduationCap, Languages, Heart, X } from "lucide-react";
import { AudioRecorderControl } from "@/components/AudioRecorderControl";
import { PhotoCarousel, type CarouselPhoto } from "@/components/PhotoCarousel";
import { TATTOO_OPTIONS, VAPING_OPTIONS, PETS_OPTIONS, ACTIVITY_LEVEL_OPTIONS, NIGHTLIFE_OPTIONS, cmToDisplay } from "@/lib/lifestylePreferenceOptions";
import { RELATIONSHIP_TYPES, LOVE_LANGUAGE_OPTIONS } from "@/lib/preferenceOptions";

// No is_expired flag here on purpose — the backend's attach-helper only
// ever includes a voice_question on a candidate at all when it's
// currently active. If it's present here, it's guaranteed replyable;
// there's nothing for the frontend to separately check.
export interface VoiceQuestionData {
  id: string;
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
  is_founder?: boolean;
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
  education?: string | null;
  languages_spoken?: string[];
  languages_other?: string | null;
  love_language?: string | null;
  dating_intentions?: string[];
  voice_question?: VoiceQuestionData | null;
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
// with the edit form on ProfilePage/PreferencesPage) rather than
// redefined by hand here, so these can never drift out of sync with
// the actual stored values. This replaces an earlier, hand-guessed
// version of RELATIONSHIP_TYPE_LABELS (built without access to the
// real RELATIONSHIP_TYPES options at the time) that was missing the
// "open" value entirely — its label, "Open to anything", never showed;
// the card fell back to displaying the raw stored value "open" as-is.
const toLabelMap = (options: { value: string; label: string }[]): Record<string, string> =>
  Object.fromEntries(options.map((o) => [o.value, o.label]));

const RELATIONSHIP_TYPE_LABELS = toLabelMap(RELATIONSHIP_TYPES);
const LOVE_LANGUAGE_LABELS = toLabelMap(LOVE_LANGUAGE_OPTIONS);
const VAPING_LABELS = toLabelMap(VAPING_OPTIONS);
const TATTOO_LABELS = toLabelMap(TATTOO_OPTIONS);
const PETS_LABELS = toLabelMap(PETS_OPTIONS);
const ACTIVITY_LEVEL_LABELS = toLabelMap(ACTIVITY_LEVEL_OPTIONS);
const NIGHTLIFE_LABELS = toLabelMap(NIGHTLIFE_OPTIONS);

/** A single small "fact" pill — used throughout the Lifestyle & Habits
 *  section below. Pulled out once rather than repeated inline for each
 *  of the ~10 possible facts, since they all share identical markup. */
function FactPill({ icon: Icon, children }: { icon: React.ComponentType<{ size?: number; className?: string }>; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary text-secondary-foreground text-xs font-medium">
      <Icon size={13} className="shrink-0" /> {children}
    </span>
  );
}

/** Small uppercase label + icon, used to head every category section
 *  below the photo. Same visual language as section headers already
 *  used elsewhere in the app (e.g. AdminDashboard's edit-profile form),
 *  applied here so the categories read as clearly distinct groups
 *  rather than one long undifferentiated block. */
function SectionHeader({ icon: Icon, label }: { icon: React.ComponentType<{ size?: number; className?: string }>; label: string }) {
  return (
    <div className="flex items-center gap-1.5 mb-2.5">
      <Icon size={14} className="text-primary shrink-0" />
      <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</h3>
    </div>
  );
}

export function ProfileCard({
  profile,
  active = true,
  canReplyToVoiceQuestion = false,
  onReplyToVoiceQuestion,
  swipeContext,
}: {
  profile: ProfileCardData;
  active?: boolean;
  /** Separate from swipeContext on purpose, even though both are
   *  currently only ever set on Discover — replying to a voice
   *  question and the swipe gesture are unrelated capabilities that
   *  just happen to share a page today. Search/Invites/MatchDetail
   *  still show and can PLAY a voice question if one is present —
   *  replying specifically is the Discover-only action, matching where
   *  this whole feature is meant to live. */
  canReplyToVoiceQuestion?: boolean;
  /** Only called when the recording is actually saved — the parent
   *  page owns the real API call (charging Sparks, handling a match,
   *  toasts, errors). ProfileCard only owns the recording UI itself and
   *  its own submitting/loading state while that call is in flight. */
  onReplyToVoiceQuestion?: (blob: Blob) => Promise<void>;
  /** 2026-09-27 — present only when this card is rendered inside
   *  DiscoverPage's SwipeCard. Every earlier version of this gesture
   *  split the decision across two independent handlers — Framer's own
   *  drag recognizer up in SwipeCard, and a second axis-lock down here
   *  for the pull-to-reveal-next-card peek — and the two were
   *  constantly racing each other for the same touch (confirmed
   *  on-device: a real horizontal swipe would get handed to Framer,
   *  then a fraction of a second later this component's own listener
   *  would also see the same touch stream and occasionally decide it
   *  was a pull, or the reverse). Splitting an axis-lock decision
   *  across two independent listeners is fundamentally unreliable no
   *  matter how carefully each one is tuned — only one of them can ever
   *  be "correct" for a given touch, and there's no way for either to
   *  know what the other decided.
   *
   *  So the fix is structural: SwipeCard now owns the ENTIRE gesture —
   *  it decides once, per touch, whether the movement is horizontal
   *  (the swipe-to-decide gesture) or vertical (scrolling this card's
   *  own content, or — only when already at the very top — peeking at
   *  the next card) — and drives everything imperatively from outside:
   *  this component's own scroll position (via the shared scrollRef)
   *  and its peek transform (via pullY). This component no longer runs
   *  any gesture recognition of its own; it just renders whatever
   *  state it's handed. Absent on every other page that renders this
   *  card (Search, Invites, MatchDetail) — there, this reverts to an
   *  ordinary natively-scrolling card, since there's no competing
   *  horizontal drag to arbitrate against in the first place. */
  swipeContext?: {
    scrollRef: React.RefObject<HTMLDivElement>;
    pullY: number;
  };
}) {
  const photos = profile.photos.length > 0 ? profile.photos : [];
  const [isPlayingVoiceQuestion, setIsPlayingVoiceQuestion] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Falls back to an ordinary local ref outside Discover (no swipeContext
  // provided), so this card still scrolls exactly as it always has on
  // Search/Invites/MatchDetail — nothing about those pages changes.
  const localScrollRef = useRef<HTMLDivElement>(null);
  const scrollRef = swipeContext?.scrollRef ?? localScrollRef;
  const pullY = swipeContext?.pullY ?? 0;
  const isPulling = pullY !== 0;

  const togglePlayVoiceQuestion = () => {
    if (!profile.voice_question) return;
    if (isPlayingVoiceQuestion) {
      audioRef.current?.pause();
      setIsPlayingVoiceQuestion(false);
      return;
    }
    const audio = new Audio(profile.voice_question.audio_url);
    audio.onended = () => setIsPlayingVoiceQuestion(false);
    audio.play();
    audioRef.current = audio;
    setIsPlayingVoiceQuestion(true);
  };

  const [showReplyRecorder, setShowReplyRecorder] = useState(false);
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);

  const handleSaveReply = async (blob: Blob) => {
    if (!onReplyToVoiceQuestion) return;
    setIsSubmittingReply(true);
    try {
      await onReplyToVoiceQuestion(blob);
      setShowReplyRecorder(false);
    } finally {
      // Not reset on the success path only — if the parent's own
      // handler throws (e.g. insufficient Sparks, a network error), the
      // modal should stay open with the recording still in place rather
      // than silently closing on a failed attempt.
      setIsSubmittingReply(false);
    }
  };

  // Grouped the same way the sections below are grouped, so this stays
  // easy to keep in sync with what's actually rendered — each boolean
  // corresponds to one section further down.
  const hasLifestyle =
    !!profile.height_cm ||
    !!profile.num_kids ||
    !!profile.family_plans ||
    !!profile.smoking_status ||
    !!profile.drinking_status ||
    !!profile.vaping_status ||
    !!profile.has_tattoos ||
    !!profile.pets ||
    !!profile.activity_level ||
    !!profile.nightlife_frequency;
  const hasInterests = profile.personality_tags?.length > 0;
  const hasBackground =
    !!profile.education ||
    (profile.languages_spoken?.length ?? 0) > 0 ||
    !!profile.languages_other ||
    !!profile.love_language ||
    (profile.dating_intentions?.length ?? 0) > 0;
  const hasDetails = !!profile.bio || hasLifestyle || hasInterests || hasBackground;

  const relationshipLabel = profile.looking_for ? RELATIONSHIP_TYPE_LABELS[profile.looking_for] ?? profile.looking_for : null;

  return (
    <div
      className="w-full h-full bg-card border border-card-border rounded-3xl overflow-hidden shadow-2xl relative"
      style={{
        transform: pullY !== 0 ? `translateY(${pullY}px) scale(${1 - Math.min(pullY, 100) / 800})` : undefined,
        opacity: pullY !== 0 ? Math.max(0.4, 1 - pullY / 150) : 1,
        transition: isPulling ? "none" : "transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.3s ease-out",
        // 2026-09-27 — always on, not toggled based on pullY. Without
        // this, the browser only promotes this element to its own GPU
        // compositing layer the moment `transform` first becomes
        // non-undefined (pullY going from 0 to nonzero), and demotes it
        // again the moment it returns to 0 — and that promote/demote
        // right at release is exactly what produced the brief visible
        // "blink" reported when a pull or an incomplete swipe springs
        // back to rest. Keeping the layer permanently allocated means
        // there's nothing left to (de)allocate at the exact instant the
        // spring-back animation starts.
        willChange: "transform",
      }}
    >
      <div
        ref={scrollRef}
        className="w-full h-full overflow-y-auto"
        // Only forced off when a parent SwipeCard is driving this card's
        // gestures — see the swipeContext comment above. Outside
        // Discover, this stays native (touch-action: auto), same as
        // it's always been.
        style={swipeContext ? { touchAction: "none" } : undefined}
      >
        {/* Photo — fills the entire card by default (edge to edge), so
            it's the only thing visible until the user scrolls down.
            Name/age/location/looking-for sit in a compact overlay
            strictly at the bottom edge, never in the middle of the
            image. */}
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
              {profile.is_founder && (
                <span
                  title="Founder"
                  className="inline-flex items-center gap-0.5 pl-1 pr-1.5 py-0.5 rounded-full bg-amber-500 text-white shrink-0 mb-0.5 ring-2 ring-black/10"
                >
                  <Crown size={11} strokeWidth={3} />
                  <span className="text-[10px] font-extrabold font-sans leading-none tracking-wide">FOUNDER</span>
                </span>
              )}
            </h2>
            {(profile.city || profile.distance_km != null) && (
              <div className="flex items-center gap-1 text-white/70 text-xs mt-0.5">
                <MapPin size={12} />
                {profile.city}
                {profile.city && profile.distance_km != null && " · "}
                {profile.distance_km != null && `${profile.distance_km} km away`}
              </div>
            )}
            {/* Looking-for row — icon instead of the words "Looking
                for" to save space, per design direction. Search (a
                magnifying glass in a circle) reads as "what they're
                looking for" without needing a text label of its own. */}
            {relationshipLabel && (
              <div className="flex items-center gap-1 text-white/70 text-xs mt-0.5">
                <Search size={12} />
                <span className="text-white/90 font-medium">{relationshipLabel}</span>
              </div>
            )}
            {/* Voice Question — moved here (grouped with the other
                at-a-glance info at the bottom) after it previously sat
                as its own separate floating element nearer the top,
                which competed with the photo itself for attention and
                looked disconnected from everything else on the card.
                pointer-events-auto opts back into clicks here, since
                the whole bottom-overlay container above is
                pointer-events-none (so taps normally pass through to
                the photo/carousel underneath it). */}
            {profile.voice_question && (
              <div className="flex items-center gap-2 mt-2 pointer-events-auto">
                <button
                  onClick={togglePlayVoiceQuestion}
                  className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full bg-black/50 backdrop-blur-sm text-white text-xs font-semibold"
                >
                  <span className="w-6 h-6 rounded-full bg-gradient-accent flex items-center justify-center shrink-0">
                    {isPlayingVoiceQuestion ? <Pause size={11} /> : <Play size={11} />}
                  </span>
                  Voice Question
                </button>
                {canReplyToVoiceQuestion && onReplyToVoiceQuestion && (
                  <button
                    onClick={() => setShowReplyRecorder(true)}
                    className="flex items-center gap-1.5 pl-2.5 pr-3 py-1.5 rounded-full bg-gradient-accent text-white text-xs font-semibold shrink-0"
                  >
                    <Mic size={13} /> Reply
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Details — below the fold, only reached by scrolling down past
            the photo. Bio comes first (the single most personal, most
            "them" detail), then everything else is grouped into
            clearly labeled, visually separated categories rather than
            one dense undifferentiated block of pills — each category
            gets its own icon + uppercase label and a light background
            tint so it reads as a distinct card even without a full
            border/shadow treatment, which would feel heavy stacked
            this many times in a row. */}
        {hasDetails && (
          <div className="w-full bg-card px-5 py-4 space-y-3">
            {profile.bio && (
              <div className="bg-secondary/40 rounded-2xl p-4">
                <SectionHeader icon={Users} label="About Me" />
                <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{profile.bio}</p>
              </div>
            )}

            {hasLifestyle && (
              <div className="bg-secondary/40 rounded-2xl p-4">
                <SectionHeader icon={Dumbbell} label="Lifestyle & Habits" />
                <div className="flex flex-wrap gap-2">
                  {profile.height_cm && <FactPill icon={Ruler}>{cmToDisplay(profile.height_cm, "cm")} cm</FactPill>}
                  {profile.num_kids && NUM_KIDS_LABELS[profile.num_kids] && <FactPill icon={Baby}>{NUM_KIDS_LABELS[profile.num_kids]}</FactPill>}
                  {profile.family_plans && FAMILY_PLANS_LABELS[profile.family_plans] && <FactPill icon={Users}>{FAMILY_PLANS_LABELS[profile.family_plans]}</FactPill>}
                  {profile.smoking_status && SMOKING_LABELS[profile.smoking_status] && <FactPill icon={Cigarette}>{SMOKING_LABELS[profile.smoking_status]}</FactPill>}
                  {profile.vaping_status && VAPING_LABELS[profile.vaping_status] && <FactPill icon={Wind}>{VAPING_LABELS[profile.vaping_status]}</FactPill>}
                  {profile.drinking_status && DRINKING_LABELS[profile.drinking_status] && <FactPill icon={Wine}>{DRINKING_LABELS[profile.drinking_status]}</FactPill>}
                  {profile.has_tattoos && TATTOO_LABELS[profile.has_tattoos] && <FactPill icon={PenTool}>{TATTOO_LABELS[profile.has_tattoos]}</FactPill>}
                  {profile.pets && PETS_LABELS[profile.pets] && <FactPill icon={PawPrint}>{PETS_LABELS[profile.pets]}</FactPill>}
                  {profile.activity_level && ACTIVITY_LEVEL_LABELS[profile.activity_level] && <FactPill icon={Dumbbell}>{ACTIVITY_LEVEL_LABELS[profile.activity_level]}</FactPill>}
                  {profile.nightlife_frequency && NIGHTLIFE_LABELS[profile.nightlife_frequency] && <FactPill icon={PartyPopper}>{NIGHTLIFE_LABELS[profile.nightlife_frequency]}</FactPill>}
                </div>
              </div>
            )}

            {hasInterests && (
              <div className="bg-secondary/40 rounded-2xl p-4">
                <SectionHeader icon={Sparkles} label="Interests" />
                <div className="flex flex-wrap gap-2">
                  {profile.personality_tags.map((tag) => (
                    <span key={tag} className="px-3 py-1.5 rounded-full bg-secondary text-secondary-foreground text-xs font-medium">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {hasBackground && (
              <div className="bg-secondary/40 rounded-2xl p-4">
                <SectionHeader icon={GraduationCap} label="More About Me" />
                <div className="flex flex-wrap gap-2">
                  {profile.education && <FactPill icon={GraduationCap}>{profile.education}</FactPill>}
                  {profile.languages_spoken && profile.languages_spoken.length > 0 && (
                    <FactPill icon={Languages}>{profile.languages_spoken.join(", ")}</FactPill>
                  )}
                  {profile.languages_other && <FactPill icon={Languages}>{profile.languages_other}</FactPill>}
                  {profile.love_language && LOVE_LANGUAGE_LABELS[profile.love_language] && (
                    <FactPill icon={Heart}>{LOVE_LANGUAGE_LABELS[profile.love_language]}</FactPill>
                  )}
                  {/* dating_intentions values ("Shared values", "Sense of
                      humor", etc.) are stored as already-human-readable
                      strings, not value/label pairs like every other
                      field here — DATING_INTENTIONS in preferenceOptions.ts
                      is a plain string array, so these display directly
                      with no label lookup needed. Each gets its own pill,
                      unlike languages_spoken's single joined pill — these
                      read as distinct, separate qualities (closer in
                      spirit to Interests above) rather than a short list
                      that reads fine run together. */}
                  {profile.dating_intentions?.map((intention) => (
                    <FactPill key={intention} icon={Heart}>{intention}</FactPill>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {showReplyRecorder && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => !isSubmittingReply && setShowReplyRecorder(false)}
          />
          <div className="fixed inset-x-6 top-1/2 -translate-y-1/2 z-50 bg-card border border-card-border rounded-2xl p-5 space-y-2 max-w-sm mx-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-accent flex items-center justify-center text-white shrink-0">
                  <Mic size={18} />
                </div>
                <h3 className="font-['Syne'] font-bold text-base">Reply with your voice</h3>
              </div>
              {!isSubmittingReply && (
                <button
                  onClick={() => setShowReplyRecorder(false)}
                  className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-muted-foreground shrink-0"
                >
                  <X size={15} />
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Your reply is sent as an invite — {profile.name} will hear it and can match with you.
            </p>
            <AudioRecorderControl
              onSave={handleSaveReply}
              isSaving={isSubmittingReply}
              saveLabel="Send Reply"
              maxDurationSeconds={30}
            />
          </div>
        </>
      )}
    </div>
  );
}