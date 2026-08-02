import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
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
import { Search as SearchIcon, Heart, X, MessageCircle, SlidersHorizontal, Sparkles, ShieldCheck, Mic, MapPin, TrendingUp, ChevronLeft, Star } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const PERSONALITY_TAGS = [
  "Sarcastic", "Curious", "Night Owl", "Coffee Snob",
  "Bookworm", "Dog Person", "Foodie", "Traveler",
  "Introvert", "Empath", "Creative", "Ambitious",
];

interface Result {
  id: string;
  name: string;
  age: number;
  bio: string | null;
  city: string | null;
  photo_url: string | null;
  photos: { url: string; media_type: "image" | "video" }[];
  personality_tags: string[];
  integrity_score: number;
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
};

function ProfileDetailOverlay({
  profile,
  onClose,
  onSwipe,
  onMessage,
  isActioning,
}: {
  profile: Result;
  onClose: () => void;
  onSwipe: (direction: "like" | "pass" | "super_like") => void;
  onMessage: () => void;
  isActioning: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[100] bg-background flex flex-col">
      <div className="w-full max-w-[430px] mx-auto h-full flex flex-col overflow-hidden">
        <TopBar />

        <div className="flex-1 flex flex-col overflow-hidden px-4 pb-20 pt-4">
          <div className="flex-1 min-h-0 relative">
            <ProfileCard profile={profile} />
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

export default function SearchPage() {
  const { token } = useAuth();
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
  const [selectedProfile, setSelectedProfile] = useState<Result | null>(null);
  const [matchCelebration, setMatchCelebration] = useState<{ name: string; matchId: string; photoUrl?: string | null } | null>(null);
  const [composeFor, setComposeFor] = useState<Result | null>(null);
  const [messageText, setMessageText] = useState("");
  const [isSendingMessage, setIsSendingMessage] = useState(false);

  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<Category | null>(null);

  const fetchCategories = useCallback(async () => {
    setCategoriesLoading(true);
    try {
      const res = await fetch("/api/discover/categories", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load categories");
      setCategories(body.categories ?? []);
    } catch {
      // Silent — categories are a nice-to-have, not core functionality.
    } finally {
      setCategoriesLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

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

  const handleSwipe = async (targetId: string, direction: "like" | "pass" | "super_like") => {
    setActioningId(targetId);
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
        return;
      }

      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to record swipe");

      const swipedProfile = results?.find((r) => r.id === targetId) ?? selectedProfile;
      setResults((prev) => (prev ? prev.filter((r) => r.id !== targetId) : prev));
      setSelectedProfile((prev) => (prev?.id === targetId ? null : prev));

      if (direction === "like" && body.sparksCharged) {
        if (!localStorage.getItem("deeply_seen_invite_quota_cost_notice")) {
          localStorage.setItem("deeply_seen_invite_quota_cost_notice", "1");
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
    } finally {
      setActioningId(null);
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
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-2">Explore</h2>
          {categoriesLoading ? (
            <div className="grid grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-28 rounded-2xl" />
              ))}
            </div>
          ) : categories.length === 0 ? null : (
            <div className="grid grid-cols-2 gap-3">
              {categories.map((cat) => {
                const style = CATEGORY_STYLE[cat.key] ?? { icon: <Sparkles size={18} />, gradient: "from-primary/20 to-accent/20" };
                return (
                  <button
                    key={cat.key}
                    onClick={() => openCategory(cat)}
                    disabled={cat.count === 0}
                    className={`relative h-28 rounded-2xl overflow-hidden border border-card-border text-left disabled:opacity-40 disabled:pointer-events-none bg-gradient-to-br ${style.gradient}`}
                  >
                    {/* Preview photo collage */}
                    {cat.preview_photos.length > 0 && (
                      <div className="absolute inset-0 flex">
                        {cat.preview_photos.slice(0, 3).map((url, i) => (
                          <div key={i} className="flex-1 relative">
                            <img src={url} alt="" className="w-full h-full object-cover opacity-30" />
                          </div>
                        ))}
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
              })}
            </div>
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
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center text-center px-4 mt-6 text-muted-foreground">
          <p className="text-sm">{activeCategory ? "No one here right now." : "No profiles match your search."}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {results.map((r) => (
            <div
              key={r.id}
              onClick={() => {
                setSelectedProfile(r);
                // Fire-and-forget — a deliberate open of the full profile
                // view counts as a "view" for the profile-views feature.
                // Not awaited: no need to block opening the overlay on it.
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
                {r.city && <p className="text-xs text-muted-foreground truncate">{r.city}</p>}
              </div>
              <div className="flex gap-2 shrink-0">
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
