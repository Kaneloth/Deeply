import { useState, useEffect, useCallback, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { getUserIdFromToken } from "@/lib/tokenUtils";
import { useSparks } from "@/contexts/SparksContext";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ProfileCard } from "@/components/ProfileCard";
import { PageHeader } from "@/components/PageHeader";
import { TopBar } from "@/components/TopBar";
import { BottomNav } from "@/components/BottomNav";
import { MatchCelebration } from "@/components/MatchCelebration";
import { Search as SearchIcon, Heart, X, MessageCircle, SlidersHorizontal, Sparkles, ShieldCheck, Mic, MapPin, TrendingUp, ChevronLeft, Star, Gem, Flame, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { captureUserLocation } from "@/lib/captureLocation";

const PERSONALITY_TAGS = [
  "Sarcastic", "Curious", "Night Owl", "Coffee Snob",
  "Bookworm", "Dog Person", "Foodie", "Traveler",
  "Introvert", "Empath", "Creative", "Ambitious",
];

// Expanded to match everything ProfileCard.tsx's redesigned, categorized
// sections can display (Lifestyle & Habits, Interests, More About Me) —
// previously only carried a handful of summary fields, so a search
// result opened via ProfileDetailOverlay below showed almost none of
// what Discover/Invites/Match Detail now show for the same person. The
// backend (discover.ts's /discover/search and /discover/categories/:key)
// was updated alongside this to actually select and return these
// fields, including renaming relationship_type to looking_for to match
// ProfileCardData's existing prop name.
interface Result {
  id: string;
  name: string;
  age: number;
  bio: string | null;
  city: string | null;
  distance_km?: number | null;
  photo_url: string | null;
  photos: { url: string; media_type: "image" | "video" }[];
  personality_tags: string[];
  integrity_score: number;
  invite_pending?: boolean;
  is_verified?: boolean;
  is_founder?: boolean;
  photo_verified?: boolean;
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
  education?: string | null;
  languages_spoken?: string[];
  languages_other?: string | null;
  love_language?: string | null;
  dating_intentions?: string[];
}

interface Category {
  key: string;
  label: string;
  count: number;
  preview_photos: string[];
}

const CATEGORY_STYLE: Record<string, { icon: React.ReactNode; gradient: string }> = {
  new_here: { icon: <Sparkles size={18} />, gradient: "from-violet-500/30 to-fuchsia-500/30" },
  verified: { icon: <ShieldCheck size={18} />, gradient: "from-emerald-500/30 to-teal-500/30" },
  has_audio: { icon: <Mic size={18} />, gradient: "from-amber-500/30 to-orange-500/30" },
  near_you: { icon: <MapPin size={18} />, gradient: "from-sky-500/30 to-blue-500/30" },
  matches_vibe: { icon: <Heart size={18} />, gradient: "from-primary/30 to-accent/30" },
  popular: { icon: <TrendingUp size={18} />, gradient: "from-rose-500/30 to-pink-500/30" },
  rel_long_term: { icon: <Gem size={18} />, gradient: "from-indigo-500/30 to-violet-500/30" },
  rel_short_term: { icon: <Flame size={18} />, gradient: "from-orange-500/30 to-red-500/30" },
  rel_friendship: { icon: <Users size={18} />, gradient: "from-cyan-500/30 to-sky-500/30" },
};

// Purely a frontend presentation grouping — the backend returns one flat
// list of categories (see discover.ts's GET /discover/categories), in a
// fixed order that happens to already put the 3 relationship-type
// categories last. Grouping them here into labeled sections rather than
// one long undifferentiated grid keeps the general-purpose browse
// categories (New Here, Verified, etc.) visually distinct from the
// specific-intent ones (what someone is looking for) — same reasoning
// as AdminDashboard's NAV_GROUPS grouping its own nav sections. Any
// category key not listed in either group here still renders (via the
// "Explore" grid remaining the ungrouped fallback below) rather than
// silently disappearing if the backend ever adds a category this map
// doesn't know about yet.
const CATEGORY_GROUPS: { label: string; keys: string[] }[] = [
  { label: "Discover", keys: ["new_here", "verified", "has_audio", "near_you", "matches_vibe", "popular"] },
  { label: "Looking For", keys: ["rel_long_term", "rel_short_term", "rel_friendship"] },
];

/** Extracted from the single flat grid this used to be, so the same
 *  tile markup can be reused across however many labeled groups
 *  CATEGORY_GROUPS ends up rendering, without copy-pasting this block
 *  once per group. */
function renderCategoryTile(cat: Category, onOpen: (cat: Category) => void) {
  const style = CATEGORY_STYLE[cat.key] ?? { icon: <Sparkles size={18} />, gradient: "from-primary/20 to-accent/20" };
  return (
    <button
      key={cat.key}
      onClick={() => onOpen(cat)}
      disabled={cat.count === 0}
      className={`relative h-28 rounded-2xl overflow-hidden border border-card-border text-left disabled:opacity-40 disabled:pointer-events-none bg-gradient-to-br ${style.gradient}`}
    >
      {cat.preview_photos.length > 0 && (
        // Deliberately only the FIRST preview photo, full-bleed — not a
        // 3-way split collage of different people's faces. The category
        // grid is meant to tease "there are people in here," not reveal
        // who, which is the whole point of the swipe-stack behind it:
        // you shouldn't know who's coming next until you actually open
        // the category and start swiping.
        <div className="absolute inset-0">
          <img src={cat.preview_photos[0]} alt="" className="w-full h-full object-cover opacity-30" />
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/40 to-background/10" />
      <div className="relative z-10 h-full flex flex-col justify-between p-3">
        <div className="w-8 h-8 rounded-full bg-background/70 backdrop-blur flex items-center justify-center text-foreground">
          {style.icon}
        </div>
        <div>
          <p className="font-['Syne'] font-bold text-sm text-foreground leading-tight">{cat.label}</p>
          <p className="text-xs text-muted-foreground">{cat.count} {cat.count === 1 ? "person" : "people"}</p>
        </div>
      </div>
    </button>
  );
}

type SwipeDirection = "like" | "pass" | "super_like";

// Mirrors DiscoverPage.tsx's EXIT_VARIANTS exactly, for visual
// consistency between the two swipe-stack experiences in this app.
const EXIT_VARIANTS: Record<SwipeDirection, { x?: number; y?: number; opacity: number; rotate?: number; scale?: number }> = {
  like: { x: 400, opacity: 0, rotate: 20 },
  pass: { x: -400, opacity: 0, rotate: -20 },
  super_like: { y: -400, opacity: 0, scale: 1.05 },
};

/** Category/filter results swipe-stack card — deliberately mirrors
 *  DiscoverPage.tsx's SwipeCard as closely as possible, since the whole
 *  point of this change is that browsing a filter should feel like the
 *  same "you don't know who's next" experience as Discover itself,
 *  not a visually different mechanism that happens to also hide names.
 *  Kept as a separate component (rather than importing DiscoverPage's)
 *  since Result and Candidate are two independently-defined types even
 *  though their shapes overlap heavily, and this page has its own
 *  reply-to-voice-question wiring already built around Result. */
const ResultSwipeCard = memo(
  function ResultSwipeCard({
    result,
    isTop,
    isExiting,
    exitDirection,
    stackIndex,
    onReplyToVoiceQuestion,
  }: {
    result: Result;
    isTop: boolean;
    isExiting: boolean;
    exitDirection: SwipeDirection | null;
    stackIndex: number;
    onReplyToVoiceQuestion: (blob: Blob) => Promise<void>;
  }) {
    return (
      <motion.div
        className="absolute inset-0"
        style={{ zIndex: 10 - stackIndex }}
        // Same reasoning as DiscoverPage.tsx: no entry animation at all,
        // since even a subtle scale/opacity transform causes native
        // WebViews to re-composite the card while the photo is still
        // decoding, which reads as a brief blink right after mount.
        initial={false}
        animate={
          isExiting && exitDirection
            ? EXIT_VARIANTS[exitDirection]
            : { scale: 1, opacity: 1, x: 0, y: 0, rotate: 0 }
        }
        transition={isExiting ? { duration: 0.3, ease: "easeOut" } : { duration: 0 }}
      >
        <ProfileCard
          profile={result}
          active={isTop}
          enablePullReveal={isTop}
          canReplyToVoiceQuestion={isTop}
          onReplyToVoiceQuestion={onReplyToVoiceQuestion}
        />
      </motion.div>
    );
  },
  // Same custom comparator reasoning as DiscoverPage.tsx's SwipeCard —
  // result is a fresh object reference on every fetch, and this page
  // also has independent background polls (Sparks, notifications) that
  // could otherwise cause a pointless re-render/blink here.
  (prev, next) =>
    prev.result.id === next.result.id &&
    prev.isTop === next.isTop &&
    prev.isExiting === next.isExiting &&
    prev.exitDirection === next.exitDirection &&
    prev.stackIndex === next.stackIndex,
);

function ProfileDetailOverlay({
  profile,
  onClose,
  onSwipe,
  onMessage,
  onReplyToVoiceQuestion,
  isActioning,
}: {
  profile: Result;
  onClose: () => void;
  onSwipe: (direction: "like" | "pass" | "super_like") => void;
  onMessage: () => void;
  onReplyToVoiceQuestion: (blob: Blob) => Promise<void>;
  isActioning: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[100] bg-background flex flex-col">
      <div className="w-full max-w-[430px] mx-auto h-full flex flex-col overflow-hidden">
        <TopBar />

        <div className="flex-1 flex flex-col overflow-hidden px-4 pb-20 pt-4">
          <div className="flex-1 min-h-0 relative">
            <ProfileCard
              profile={profile}
              canReplyToVoiceQuestion
              onReplyToVoiceQuestion={onReplyToVoiceQuestion}
            />
            <button
              onClick={onClose}
              className="absolute top-3 left-3 z-20 w-8 h-8 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white border border-white/10"
            >
              <ChevronLeft size={16} />
            </button>
          </div>

          <div className="flex-none pt-3 flex items-center justify-center gap-3">
            <button
              onClick={() => onSwipe("pass")}
              disabled={isActioning}
              className="w-12 h-12 rounded-full bg-card border border-card-border flex items-center justify-center text-muted-foreground hover:border-destructive hover:text-destructive transition-colors shadow-lg active:scale-95"
            >
              <X size={20} />
            </button>
            <button
              onClick={onMessage}
              disabled={isActioning}
              className="w-9 h-9 rounded-full bg-card border border-card-border flex items-center justify-center text-accent hover:border-accent transition-colors shadow-lg active:scale-95"
            >
              <MessageCircle size={16} />
            </button>
            <button
              onClick={() => onSwipe("like")}
              disabled={isActioning}
              className="w-12 h-12 rounded-full bg-gradient-accent flex items-center justify-center text-white shadow-[0_8px_20px_rgba(225,29,72,0.3)] active:scale-95 transition-transform"
            >
              <Heart size={20} className="fill-current" />
            </button>
            <button
              onClick={() => onSwipe("super_like")}
              disabled={isActioning}
              className="w-9 h-9 rounded-full bg-card border border-card-border flex items-center justify-center text-sky-400 hover:border-sky-400 transition-colors shadow-lg active:scale-95"
            >
              <Star size={16} className="fill-current" />
            </button>
          </div>
        </div>

        <BottomNav />
      </div>
    </div>
  );
}

// In-memory only, same pattern as DiscoverPage.tsx's cachedCandidates.
import { readPersistentCache, writePersistentCache, registerCacheResetter } from "@/lib/persistentCache";
import { useRefetchOnAppResume } from "@/hooks/useRefetchOnAppResume";
import { usePullToRefresh } from "@/contexts/PullToRefreshContext";

const CATEGORIES_CACHE_KEY = "search_categories";
let cachedCategories: Category[] | null = readPersistentCache<Category[]>(CATEGORIES_CACHE_KEY);
function updateCategoriesCache(value: Category[]) {
  cachedCategories = value;
  writePersistentCache(CATEGORIES_CACHE_KEY, value);
}
registerCacheResetter(() => {
  cachedCategories = null;
});

export default function SearchPage() {
  const { token } = useAuth();
  const userId = getUserIdFromToken(token);
  const { refresh: refreshSparksBadge } = useSparks();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [name, setName] = useState("");
  const [minAge, setMinAge] = useState("");
  const [maxAge, setMaxAge] = useState("");
  const [city, setCity] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  const [results, setResults] = useState<Result[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [actioningId, setActioningId] = useState<string | null>(null);
  // Tracks which card in the CATEGORY swipe-stack is currently animating
  // out — separate from actioningId above, which the existing list-view
  // swipe buttons already use for their own disabled/loading state.
  const [exiting, setExiting] = useState<{ id: string; direction: SwipeDirection } | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<Result | null>(null);
  const [matchCelebration, setMatchCelebration] = useState<{ name: string; matchId: string; photoUrl?: string | null } | null>(null);
  const [composeFor, setComposeFor] = useState<Result | null>(null);
  const [messageText, setMessageText] = useState("");
  const [isSendingMessage, setIsSendingMessage] = useState(false);

  const [categories, setCategories] = useState<Category[]>(cachedCategories ?? []);
  const [categoriesLoading, setCategoriesLoading] = useState(cachedCategories === null);
  const [activeCategory, setActiveCategory] = useState<Category | null>(null);

  const fetchCategories = useCallback(async () => {
    if (cachedCategories === null) setCategoriesLoading(true);
    try {
      const res = await fetch("/api/discover/categories", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load categories");
      const fresh = body.categories ?? [];
      updateCategoriesCache(fresh);
      setCategories(fresh);
    } catch {
      // Silent — categories are a nice-to-have, not core functionality.
    } finally {
      setCategoriesLoading(false);
    }
  }, [token]);

  // Run once on mount only — same reload-on-token-refresh fix applied
  // elsewhere in the app (MatchesPage, DiscoverPage, MatchDetailPage).
  // fetchCategories is a useCallback keyed on `token`, and token gets a
  // new reference on every periodic background refresh — depending on
  // fetchCategories itself here was re-triggering this fetch (and the
  // resulting re-render of the whole page) on that same interval, which
  // is exactly the "page keeps refreshing every few seconds" symptom.
  useEffect(() => {
    fetchCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // See useRefetchOnAppResume for the full reasoning — catches a
  // background refresh that silently failed behind the cached instant
  // load.
  useRefetchOnAppResume(fetchCategories);
  // Refreshes the passive browse categories (New Here, Popular, etc.)
  // — a name/filter search is a deliberate user action with its own
  // Search button, not something a pull gesture should silently re-run.
  // Disabled while selectedProfile's ProfileDetailOverlay or
  // composeFor's message sheet is open — both are in-page, fixed-
  // position overlays rendered on top of this same page rather than
  // separate routes, so this page never actually unmounts while either
  // is showing (unlike e.g. MatchDetailPage, a real route, which
  // unmounts MatchesPage and automatically clears its handler this same
  // way). Without this, a downward drag to scroll ProfileCard's own
  // inner content back up inside the overlay would still reach
  // AppShell's gesture handler and be misread as a pull-to-refresh —
  // see usePullToRefresh's own comment on the `enabled` param for the
  // full history of why this is the fix, not a smarter gesture handler.
  usePullToRefresh(fetchCategories, !selectedProfile && !composeFor);

  // Capture device location here too, not just on Discover — otherwise
  // anyone who opens Search before ever visiting Discover has no
  // latitude/longitude on file yet, so no distance can be computed for
  // them anywhere in the app, even though search results themselves may
  // well have location data. Mount-once, silent, non-blocking — same
  // pattern as DiscoverPage.
  useEffect(() => {
    captureUserLocation(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCategory = async (category: Category) => {
    setActiveCategory(category);
    setIsSearching(true);
    try {
      const res = await fetch(`/api/discover/categories/${category.key}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load results");
      setResults(body.results ?? []);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to load results.",
        variant: "destructive",
      });
    } finally {
      setIsSearching(false);
    }
  };

  const closeCategory = () => {
    setActiveCategory(null);
    setResults(null);
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setActiveCategory(null);
    setIsSearching(true);
    try {
      const params = new URLSearchParams();
      if (name.trim()) params.set("name", name.trim());
      if (minAge) params.set("min_age", minAge);
      if (maxAge) params.set("max_age", maxAge);
      if (city.trim()) params.set("city", city.trim());
      if (selectedTags.length > 0) params.set("tags", selectedTags.join(","));

      const res = await fetch(`/api/discover/search?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Search failed");
      setResults(body.results ?? []);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Search failed.",
        variant: "destructive",
      });
    } finally {
      setIsSearching(false);
    }
  };

  const handleSwipe = async (
    targetId: string,
    direction: "like" | "pass" | "super_like",
    // Only used by the category swipe-stack view below — the existing
    // list view never sets this, and behaves exactly as it always has.
    // When true, sets `exiting` first so ResultSwipeCard can play its
    // exit animation, then waits for it to finish before actually
    // removing the card from `results` — same 300ms pattern as
    // DiscoverPage.tsx's handleDecision.
    animateExit = false,
  ) => {
    setActioningId(targetId);
    if (animateExit) setExiting({ id: targetId, direction });
    try {
      const res = await fetch("/api/discover/swipe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          targetId,
          direction,
          clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });

      if (res.status === 402) {
        toast({
          title: "You're out of Sparks",
          description: "Recharge now or wait for your next monthly grant to send more invites today.",
          variant: "destructive",
        });
        if (animateExit) setExiting(null);
        return;
      }

      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to record swipe");

      const swipedProfile = results?.find((r) => r.id === targetId) ?? selectedProfile;

      if (animateExit) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      setResults((prev) => (prev ? prev.filter((r) => r.id !== targetId) : prev));
      setSelectedProfile((prev) => (prev?.id === targetId ? null : prev));
      if (animateExit) setExiting(null);

      if (direction === "like" && body.sparksCharged) {
        if (!localStorage.getItem(`deeply_seen_invite_quota_cost_notice_${userId}`)) {
          localStorage.setItem(`deeply_seen_invite_quota_cost_notice_${userId}`, "1");
          toast({ title: "5 Sparks used", description: "You've used today's 15 free invites — extra invites cost 5 Sparks each." });
        }
        refreshSparksBadge();
      }
      if (direction === "super_like") {
        refreshSparksBadge();
      }

      if (body.matched) {
        setMatchCelebration({
          name: swipedProfile?.name ?? "them",
          matchId: body.matchId,
          photoUrl: swipedProfile?.photo_url,
        });
      }
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Something went wrong.",
        variant: "destructive",
      });
      if (animateExit) setExiting(null);
    } finally {
      setActioningId(null);
    }
  };

  // Same pattern as handleSwipe above (and DiscoverPage's equivalent) —
  // upload via the shared endpoint, call the reply route, refresh
  // Sparks, remove the candidate, celebrate a match if this reply
  // completed one. A voice reply is stored server-side as an ordinary
  // "like" swipe, so it's undoable exactly like any other swipe would
  // be from here (this page doesn't currently have its own undo
  // affordance, matching handleSwipe's existing behavior above).
  //
  // Re-throws after toasting: ProfileCard's recording modal expects
  // this promise to reject on failure so it keeps the recording visible
  // for a retry, but doesn't show its own error message — this does.
  const handleReplyToVoiceQuestion = async (targetId: string, blob: Blob) => {
    try {
      const formData = new FormData();
      formData.append("audio", blob, "voice-reply.webm");
      const uploadRes = await fetch("/api/prompts/audio-upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const uploadBody = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadBody.error ?? "Upload failed");

      const replyRes = await fetch(`/api/discover/voice-question/${targetId}/reply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ audio_url: uploadBody.audio_url }),
      });
      const replyBody = await replyRes.json().catch(() => ({}));
      if (!replyRes.ok) throw new Error(replyBody.error ?? "Failed to send your reply");

      refreshSparksBadge();

      const repliedProfile = results?.find((r) => r.id === targetId) ?? selectedProfile;
      setResults((prev) => (prev ? prev.filter((r) => r.id !== targetId) : prev));
      setSelectedProfile((prev) => (prev?.id === targetId ? null : prev));

      if (replyBody.matched && repliedProfile) {
        setMatchCelebration({
          name: repliedProfile.name ?? "them",
          matchId: replyBody.matchId,
          photoUrl: repliedProfile.photo_url,
        });
      } else {
        toast({ title: "Reply sent", description: "Your voice reply was sent as an invite." });
      }
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to send your reply.",
        variant: "destructive",
      });
      throw err;
    }
  };

  const handleSendPreMatchMessage = async () => {
    if (!composeFor || !messageText.trim() || isSendingMessage) return;
    setIsSendingMessage(true);
    try {
      const res = await fetch("/api/discover/message-request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ targetId: composeFor.id, content: messageText.trim() }),
      });

      if (res.status === 402) {
        toast({
          title: "You're out of Sparks",
          description: "Recharge now or wait for your next monthly grant to send this message.",
          variant: "destructive",
        });
        return;
      }

      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to send message");

      setResults((prev) => (prev ? prev.filter((r) => r.id !== composeFor.id) : prev));
      setSelectedProfile((prev) => (prev?.id === composeFor.id ? null : prev));
      setComposeFor(null);
      setMessageText("");
      setLocation(`/matches/${body.matchId}/chat`);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to send message.",
        variant: "destructive",
      });
    } finally {
      setIsSendingMessage(false);
    }
  };

  return (
    <div className="min-h-full px-4 pb-6 pt-6">
      <PageHeader title="Search" />

      {results === null && (
        <div className="mb-6 space-y-6">
          {categoriesLoading ? (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-2">Explore</h2>
              <div className="grid grid-cols-2 gap-3">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-28 rounded-2xl" />
                ))}
              </div>
            </div>
          ) : categories.length === 0 ? null : (
            <>
              {CATEGORY_GROUPS.map((group) => {
                const groupCategories = categories.filter((cat) => group.keys.includes(cat.key));
                if (groupCategories.length === 0) return null;
                return (
                  <div key={group.label}>
                    <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-2">
                      {group.label}
                    </h2>
                    <div className="grid grid-cols-2 gap-3">
                      {groupCategories.map((cat) => renderCategoryTile(cat, openCategory))}
                    </div>
                  </div>
                );
              })}
              {/* Fallback for any category key the backend might ever add
                  that isn't listed in CATEGORY_GROUPS yet — shown under
                  the existing "Explore" heading rather than silently
                  disappearing from the page. */}
              {(() => {
                const groupedKeys = new Set(CATEGORY_GROUPS.flatMap((g) => g.keys));
                const ungrouped = categories.filter((cat) => !groupedKeys.has(cat.key));
                if (ungrouped.length === 0) return null;
                return (
                  <div>
                    <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-2">Explore</h2>
                    <div className="grid grid-cols-2 gap-3">
                      {ungrouped.map((cat) => renderCategoryTile(cat, openCategory))}
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </div>
      )}

      {activeCategory && (
        <div className="flex items-center gap-2 mb-4 px-2">
          <button
            onClick={closeCategory}
            className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <h2 className="font-['Syne'] font-bold text-lg">{activeCategory.label}</h2>
        </div>
      )}

      {!activeCategory && (
        <form onSubmit={handleSearch} className="space-y-3 mb-6">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Search by name..."
                className="bg-card border-card-border pl-10 h-12 rounded-xl"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-12 w-12 rounded-xl shrink-0 border-card-border bg-card p-0"
              onClick={() => setShowFilters((v) => !v)}
            >
              <SlidersHorizontal size={18} className={showFilters ? "text-primary" : "text-muted-foreground"} />
            </Button>
          </div>

          {showFilters && (
            <div className="bg-card border border-card-border rounded-2xl p-4 space-y-4">
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs font-medium text-muted-foreground">Min age</label>
                  <Input
                    type="number"
                    value={minAge}
                    onChange={(e) => setMinAge(e.target.value)}
                    placeholder="18"
                    className="bg-background border-card-border h-10 mt-1"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs font-medium text-muted-foreground">Max age</label>
                  <Input
                    type="number"
                    value={maxAge}
                    onChange={(e) => setMaxAge(e.target.value)}
                    placeholder="99"
                    className="bg-background border-card-border h-10 mt-1"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">City</label>
                <Input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g. Cape Town"
                  className="bg-background border-card-border h-10 mt-1"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block">Interests</label>
                <div className="flex flex-wrap gap-2">
                  {PERSONALITY_TAGS.map((tag) => {
                    const isSelected = selectedTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTag(tag)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                          isSelected
                            ? "bg-primary border-primary text-primary-foreground"
                            : "bg-background border-card-border text-muted-foreground hover:border-muted-foreground/50"
                        }`}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          <Button type="submit" disabled={isSearching} className="w-full h-12 rounded-xl bg-gradient-accent border-0 text-white font-semibold">
            {isSearching ? "Searching..." : "Search"}
          </Button>
        </form>
      )}

      {results === null ? (
        <div className="flex flex-col items-center text-center px-4 mt-6 text-muted-foreground">
          <SearchIcon size={28} className="mb-4 opacity-40" />
          <p className="max-w-[240px] text-sm">Search by name, or use filters to narrow down by age, city, or interests.</p>
        </div>
      ) : isSearching ? (
        activeCategory ? (
          // Single card-shaped skeleton for the swipe-stack, matching
          // DiscoverPage.tsx's own loading skeleton — not the 3-row
          // list skeleton below, which would look like the wrong kind
          // of content is about to load.
          <Skeleton className="h-[65vh] w-full rounded-3xl" />
        ) : (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-2xl" />
            ))}
          </div>
        )
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center text-center px-4 mt-6 text-muted-foreground">
          <p className="text-sm">{activeCategory ? "No one here right now." : "No profiles match your search."}</p>
        </div>
      ) : activeCategory ? (
        // Category/filter results: a swipe-stack, same mystery-browse
        // experience as Discover — you see the top card only, never
        // the full lineup of who's in this category before you get
        // there. Name search below keeps the list view, since looking
        // for a specific known person isn't a "browse and be
        // surprised" interaction in the first place.
        (() => {
          const visibleCards = results.slice(0, 3);
          return (
            <div className="flex flex-col">
              <div className="relative h-[65vh]">
                <AnimatePresence>
                  {visibleCards.map((r, i) => (
                    <ResultSwipeCard
                      key={r.id}
                      result={r}
                      isTop={i === 0}
                      stackIndex={i}
                      isExiting={exiting?.id === r.id}
                      exitDirection={exiting?.id === r.id ? exiting.direction : null}
                      onReplyToVoiceQuestion={(blob) => handleReplyToVoiceQuestion(r.id, blob)}
                    />
                  ))}
                </AnimatePresence>
              </div>

              <div className="flex items-center justify-center gap-2.5 mt-3">
                <button
                  onClick={() => handleSwipe(results[0].id, "pass", true)}
                  disabled={actioningId === results[0]?.id}
                  className="w-12 h-12 rounded-full bg-card border border-card-border flex items-center justify-center text-muted-foreground hover:border-destructive hover:text-destructive transition-colors shadow-lg active:scale-95"
                >
                  <X size={20} />
                </button>
                <button
                  onClick={() => setComposeFor(results[0])}
                  disabled={actioningId === results[0]?.id}
                  className="w-9 h-9 rounded-full bg-card border border-card-border flex items-center justify-center text-accent hover:border-accent transition-colors shadow-lg active:scale-95"
                >
                  <MessageCircle size={16} />
                </button>
                <button
                  onClick={() => handleSwipe(results[0].id, "like", true)}
                  disabled={actioningId === results[0]?.id}
                  className="w-12 h-12 rounded-full bg-gradient-accent flex items-center justify-center text-white shadow-[0_8px_20px_rgba(225,29,72,0.3)] active:scale-95 transition-transform"
                >
                  <Heart size={20} className="fill-current" />
                </button>
                <button
                  onClick={() => handleSwipe(results[0].id, "super_like", true)}
                  disabled={actioningId === results[0]?.id}
                  className="w-9 h-9 rounded-full bg-card border border-card-border flex items-center justify-center text-sky-400 hover:border-sky-400 transition-colors shadow-lg active:scale-95"
                >
                  <Star size={15} className="fill-current" />
                </button>
              </div>
            </div>
          );
        })()
      ) : (
        <div className="space-y-3">
          {results.map((r) => (
            <div
              key={r.id}
              onClick={() => {
                setSelectedProfile(r);
                fetch("/api/profile-views", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({ viewedId: r.id }),
                }).catch(() => {});
              }}
              className="flex items-center gap-3 p-3 rounded-2xl bg-card border border-card-border cursor-pointer hover:border-primary/40 transition-colors active:scale-[0.99]"
            >
              <div className="w-16 h-16 rounded-xl bg-muted overflow-hidden shrink-0">
                {r.photo_url ? (
                  <img src={r.photo_url} alt={r.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-accent/20">
                    <span className="text-primary font-bold font-['Syne']">{r.name?.[0]}</span>
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold truncate">
                  {r.name}, {r.age}
                </h3>
                {(r.city || r.distance_km != null) && (
                  <p className="text-xs text-muted-foreground truncate">
                    {r.city}
                    {r.city && r.distance_km != null && " · "}
                    {r.distance_km != null && `${r.distance_km} km away`}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSwipe(r.id, "pass");
                  }}
                  disabled={actioningId === r.id}
                  className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors"
                >
                  <X size={16} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setComposeFor(r);
                  }}
                  disabled={actioningId === r.id}
                  className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-accent hover:border-accent transition-colors"
                >
                  <MessageCircle size={16} />
                </button>
                {r.invite_pending ? (
                  <span className="flex items-center gap-1.5 px-3 h-9 rounded-full bg-secondary text-xs font-medium text-muted-foreground whitespace-nowrap">
                    <Heart size={13} className="fill-current opacity-60" />
                    Invite sent
                  </span>
                ) : (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSwipe(r.id, "like");
                      }}
                      disabled={actioningId === r.id}
                      className="w-9 h-9 rounded-full bg-gradient-accent flex items-center justify-center text-white"
                    >
                      <Heart size={16} className="fill-current" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSwipe(r.id, "super_like");
                      }}
                      disabled={actioningId === r.id}
                      className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-sky-400 hover:text-sky-300 transition-colors"
                    >
                      <Star size={16} className="fill-current" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedProfile && (
        <ProfileDetailOverlay
          profile={selectedProfile}
          onClose={() => setSelectedProfile(null)}
          onSwipe={(direction) => handleSwipe(selectedProfile.id, direction)}
          onMessage={() => setComposeFor(selectedProfile)}
          onReplyToVoiceQuestion={(blob) => handleReplyToVoiceQuestion(selectedProfile.id, blob)}
          isActioning={actioningId === selectedProfile.id}
        />
      )}

      {composeFor && (
        <div
          className="fixed inset-0 z-[110] bg-background/80 backdrop-blur-sm flex items-end"
          onClick={() => {
            if (!isSendingMessage) {
              setComposeFor(null);
              setMessageText("");
            }
          }}
        >
          <div
            className="w-full max-w-[430px] mx-auto bg-card border-t border-card-border rounded-t-3xl p-6 pb-10"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-['Syne'] font-bold text-lg mb-1">Message {composeFor.name}</h3>
            <p className="text-xs text-muted-foreground mb-4">Send an opening message before you match.</p>
            <Textarea
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              placeholder={`Say hi to ${composeFor.name}...`}
              className="bg-background border-card-border min-h-[100px] resize-none rounded-xl"
              autoFocus
            />
            <div className="flex gap-3 mt-4">
              <Button
                variant="outline"
                className="flex-1 h-12 rounded-xl"
                onClick={() => {
                  setComposeFor(null);
                  setMessageText("");
                }}
                disabled={isSendingMessage}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 h-12 rounded-xl bg-gradient-accent border-0 text-white font-semibold"
                onClick={handleSendPreMatchMessage}
                disabled={!messageText.trim() || isSendingMessage}
              >
                {isSendingMessage ? "Sending..." : "Send"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {matchCelebration && (
        <MatchCelebration
          name={matchCelebration.name}
          photoUrl={matchCelebration.photoUrl}
          onContinue={() => setMatchCelebration(null)}
          onMessage={() => setLocation(`/matches/${matchCelebration.matchId}/chat`)}
        />
      )}
    </div>
  );
}
