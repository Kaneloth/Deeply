import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Link } from "wouter";
import { motion, AnimatePresence, useMotionValue, useTransform, type PanInfo } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { X, Heart, Star, MapPin } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Candidate {
  id: string;
  name: string;
  age: number;
  bio: string | null;
  city: string | null;
  photo_url: string | null;
  personality_tags: string[];
  integrity_score: number;
}

type SwipeDirection = "like" | "pass" | "super_like";

function SwipeCard({
  candidate,
  onSwipe,
  isTop,
}: {
  candidate: Candidate;
  onSwipe: (direction: SwipeDirection) => void;
  isTop: boolean;
}) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-15, 15]);
  const likeOpacity = useTransform(x, [20, 120], [0, 1]);
  const passOpacity = useTransform(x, [-120, -20], [1, 0]);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x > 120) {
      onSwipe("like");
    } else if (info.offset.x < -120) {
      onSwipe("pass");
    }
  };

  return (
    <motion.div
      className="absolute inset-0"
      style={isTop ? { x, rotate } : undefined}
      drag={isTop ? "x" : false}
      dragConstraints={{ left: 0, right: 0 }}
      onDragEnd={isTop ? handleDragEnd : undefined}
      initial={{ scale: 0.95, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.2 }}
    >
      <div className="w-full h-full bg-card border border-card-border rounded-3xl overflow-hidden shadow-2xl relative flex flex-col">
        {/* Photo */}
        <div className="relative flex-1 min-h-[400px] w-full bg-muted overflow-hidden">
          {candidate.photo_url ? (
            <img src={candidate.photo_url} alt={candidate.name} className="w-full h-full object-cover" draggable={false} />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-card to-background">
              <span className="text-primary text-6xl font-bold font-['Syne'] opacity-20">
                {candidate.name?.[0]}
              </span>
            </div>
          )}

          {isTop && (
            <>
              <motion.div
                style={{ opacity: likeOpacity }}
                className="absolute top-8 left-8 border-4 border-primary text-primary font-['Syne'] font-extrabold text-3xl px-4 py-1 rounded-xl rotate-[-12deg]"
              >
                INVITE
              </motion.div>
              <motion.div
                style={{ opacity: passOpacity }}
                className="absolute top-8 right-8 border-4 border-muted-foreground text-muted-foreground font-['Syne'] font-extrabold text-3xl px-4 py-1 rounded-xl rotate-[12deg]"
              >
                PASS
              </motion.div>
            </>
          )}

          <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-card to-transparent" />

          <div className="absolute bottom-4 left-6 right-6">
            <h2 className="text-3xl font-['Syne'] font-bold text-white flex items-end gap-2">
              {candidate.name} <span className="text-xl font-normal text-white/80">{candidate.age}</span>
            </h2>
            {candidate.city && (
              <div className="flex items-center gap-1 text-white/70 text-sm mt-1">
                <MapPin size={14} /> {candidate.city}
              </div>
            )}
          </div>
        </div>

        {/* Details */}
        {(candidate.bio || candidate.personality_tags?.length > 0) && (
          <div className="p-5 shrink-0 max-h-[35%] overflow-y-auto">
            {candidate.personality_tags?.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {candidate.personality_tags.map((tag) => (
                  <span key={tag} className="px-3 py-1 rounded-full bg-secondary text-secondary-foreground text-xs font-medium">
                    {tag}
                  </span>
                ))}
              </div>
            )}
            {candidate.bio && <p className="text-sm text-muted-foreground">{candidate.bio}</p>}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function MatchCelebration({ name, onContinue }: { name: string; onContinue: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-background/95 backdrop-blur-md flex flex-col items-center justify-center px-6 text-center"
    >
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", damping: 12 }}
      >
        <div className="text-6xl mb-6">💥</div>
        <h1 className="text-4xl font-['Syne'] font-extrabold text-transparent bg-clip-text bg-gradient-accent mb-3">
          It's a Match!
        </h1>
        <p className="text-muted-foreground mb-10">
          You and {name} liked each other. Say hi!
        </p>
        <Button
          onClick={onContinue}
          className="w-full max-w-xs h-14 rounded-2xl bg-gradient-accent border-0 text-white font-bold text-lg shadow-[0_8px_20px_rgba(225,29,72,0.3)]"
        >
          Keep Swiping
        </Button>
      </motion.div>
    </motion.div>
  );
}

export default function DiscoverPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [matchName, setMatchName] = useState<string | null>(null);
  const [isSwiping, setIsSwiping] = useState(false);
  const [invitesCount, setInvitesCount] = useState<number>(0);

  const fetchInvitesCount = useCallback(async () => {
    try {
      const res = await fetch("/api/discover/invites/count", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const body = await res.json();
      setInvitesCount(body.count ?? 0);
    } catch {
      // Silent — non-critical background fetch.
    }
  }, [token]);

  const fetchQueue = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/discover/queue", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load profiles");
      setCandidates(body.candidates ?? []);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to load profiles.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [token, toast]);

  useEffect(() => {
    fetchQueue();
    fetchInvitesCount();
  }, [fetchQueue, fetchInvitesCount]);

  const handleSwipe = async (direction: SwipeDirection) => {
    if (isSwiping || candidates.length === 0) return;
    const target = candidates[0];
    setIsSwiping(true);

    // Optimistically pop the card so the UI feels instant.
    setCandidates((prev) => prev.slice(1));

    try {
      const res = await fetch("/api/discover/swipe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ targetId: target.id, direction }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to record swipe");

      if (body.matched) {
        setMatchName(target.name);
        fetchInvitesCount();
      }
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Something went wrong.",
        variant: "destructive",
      });
    } finally {
      setIsSwiping(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 pt-10 space-y-6">
        <Skeleton className="h-8 w-32 mx-2" />
        <Skeleton className="h-[500px] w-full rounded-3xl" />
      </div>
    );
  }

  const visibleCards = candidates.slice(0, 3);

  return (
    <div className="flex flex-col min-h-full pb-6 pt-10 px-4">
      <header className="flex justify-between items-center mb-6 px-2">
        <h1 className="text-2xl font-['Syne'] font-bold tracking-tight">Discover</h1>
        {invitesCount > 0 && (
          <Link
            href="/invites"
            className="flex items-center gap-1.5 bg-card/80 backdrop-blur border border-card-border px-3 py-1.5 rounded-full text-sm font-semibold text-primary hover:border-primary/50 transition-colors"
          >
            <Heart size={14} className="fill-current" />
            <span>{invitesCount} invite{invitesCount === 1 ? "" : "s"}</span>
          </Link>
        )}
      </header>

      <div className="flex-1 relative min-h-[500px]">
        {visibleCards.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
            <div className="w-20 h-20 rounded-full bg-card border border-card-border flex items-center justify-center mb-6">
              <span className="text-3xl">✨</span>
            </div>
            <h2 className="text-2xl font-['Syne'] font-bold text-foreground">You're all caught up</h2>
            <p className="text-muted-foreground mt-2 max-w-[260px]">
              No new profiles right now. Check back soon for more people to meet.
            </p>
            <Button variant="outline" className="mt-6" onClick={fetchQueue}>
              Refresh
            </Button>
          </div>
        ) : (
          <AnimatePresence>
            {visibleCards.map((candidate, i) => (
              <SwipeCard
                key={candidate.id}
                candidate={candidate}
                isTop={i === 0}
                onSwipe={handleSwipe}
              />
            ))}
          </AnimatePresence>
        )}
      </div>

      {visibleCards.length > 0 && (
        <div className="flex items-center justify-center gap-4 mt-6">
          <button
            onClick={() => handleSwipe("pass")}
            disabled={isSwiping}
            className="w-16 h-16 rounded-full bg-card border border-card-border flex items-center justify-center text-muted-foreground hover:border-destructive hover:text-destructive transition-colors shadow-lg active:scale-95"
          >
            <X size={28} />
          </button>
          <button
            onClick={() => handleSwipe("super_like")}
            disabled={isSwiping}
            className="w-12 h-12 rounded-full bg-card border border-card-border flex items-center justify-center text-accent hover:border-accent transition-colors shadow-lg active:scale-95"
          >
            <Star size={20} className="fill-current" />
          </button>
          <button
            onClick={() => handleSwipe("like")}
            disabled={isSwiping}
            className="w-16 h-16 rounded-full bg-gradient-accent flex items-center justify-center text-white shadow-[0_8px_20px_rgba(225,29,72,0.3)] active:scale-95 transition-transform"
          >
            <Heart size={28} className="fill-current" />
          </button>
        </div>
      )}

      <AnimatePresence>
        {matchName && (
          <MatchCelebration name={matchName} onContinue={() => setMatchName(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
