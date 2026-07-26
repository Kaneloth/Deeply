import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Link, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { X, Heart, MessageCircle, MapPin } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Candidate {
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

type SwipeDirection = "like" | "pass" | "super_like";

const EXIT_VARIANTS: Record<SwipeDirection, { x?: number; y?: number; opacity: number; rotate?: number; scale?: number }> = {
  like: { x: 400, opacity: 0, rotate: 20 },
  pass: { x: -400, opacity: 0, rotate: -20 },
  super_like: { y: -400, opacity: 0, scale: 1.05 },
};

const PHOTO_DRAG_THRESHOLD_PCT = 20;

function SwipeCard({
  candidate,
  isTop,
  isExiting,
  exitDirection,
  stackIndex,
}: {
  candidate: Candidate;
  isTop: boolean;
  isExiting: boolean;
  exitDirection: SwipeDirection | null;
  stackIndex: number;
}) {
  const [photoIndex, setPhotoIndex] = useState(0);
  const [dragPercent, setDragPercent] = useState(0);
  const isDraggingPhoto = dragPercent !== 0;
  const photoContainerRef = useRef<HTMLDivElement>(null);
  const touchStateRef = useRef({ startX: 0, startY: 0, active: false, axisLocked: false, horizontal: false });
  const photos = candidate.photos.length > 0 ? candidate.photos : [];

  const goNext = () => setPhotoIndex((i) => Math.min(i + 1, Math.max(photos.length - 1, 0)));
  const goPrev = () => setPhotoIndex((i) => Math.max(i - 1, 0));

  // Photo browsing — a real filmstrip that tracks the finger 1:1 while
  // dragging (no spring/elastic snap-back-to-center like a generic drag
  // gesture), with edge resistance and a threshold-based snap on release.
  // This is a SEPARATE gesture from the invite/pass decision (button-only
  // below) — it can never trigger a match decision.
  const handleTouchStart = (e: React.TouchEvent) => {
    if (!isTop || photos.length <= 1) return;
    touchStateRef.current = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      active: true,
      axisLocked: false,
      horizontal: false,
    };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const t = touchStateRef.current;
    if (!t.active) return;

    const dx = e.touches[0].clientX - t.startX;
    const dy = e.touches[0].clientY - t.startY;

    if (!t.axisLocked) {
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      t.axisLocked = true;
      t.horizontal = Math.abs(dx) > Math.abs(dy);
    }

    if (!t.horizontal) return;
    e.preventDefault();

    const width = photoContainerRef.current?.getBoundingClientRect().width || 1;
    let pct = (dx / width) * 100;
    if (pct > 0 && photoIndex === 0) pct *= 0.15; // resistance at first photo
    if (pct < 0 && photoIndex === photos.length - 1) pct *= 0.15; // resistance at last photo
    setDragPercent(pct);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const t = touchStateRef.current;
    t.active = false;

    if (!t.axisLocked) {
      // Never moved enough to register as a drag — treat as a tap.
      const rect = photoContainerRef.current?.getBoundingClientRect();
      const tapX = e.changedTouches[0]?.clientX;
      if (rect && tapX !== undefined) {
        const relativeX = tapX - rect.left;
        if (relativeX < rect.width / 3) goPrev();
        else if (relativeX > (rect.width * 2) / 3) goNext();
      }
      setDragPercent(0);
      return;
    }

    if (!t.horizontal) {
      setDragPercent(0);
      return;
    }

    if (dragPercent < -PHOTO_DRAG_THRESHOLD_PCT && photoIndex < photos.length - 1) {
      setPhotoIndex((i) => i + 1);
    } else if (dragPercent > PHOTO_DRAG_THRESHOLD_PCT && photoIndex > 0) {
      setPhotoIndex((i) => i - 1);
    }
    setDragPercent(0);
  };

  const N = Math.max(photos.length, 1);
  const baseX = -(photoIndex / N) * 100;
  const dragX = (dragPercent / 100) * (100 / N);
  const stripX = baseX + dragX;

  return (
    <motion.div
      className="absolute inset-0"
      style={{ zIndex: 10 - stackIndex }}
      initial={{ scale: 0.95, opacity: 0 }}
      animate={
        isExiting && exitDirection
          ? EXIT_VARIANTS[exitDirection]
          : { scale: 1, opacity: 1, x: 0, y: 0, rotate: 0 }
      }
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      <div className="w-full h-full bg-card border border-card-border rounded-3xl overflow-hidden shadow-2xl relative flex flex-col">
        {/* Photo carousel */}
        <div className="relative flex-1 min-h-[400px] w-full bg-muted overflow-hidden">
          {photos.length > 1 && (
            <>
              <div className="absolute top-3 left-3 right-3 z-20 flex gap-1 pointer-events-none">
                {photos.map((_, idx) => (
                  <div key={idx} className="flex-1 h-1.5 rounded-full bg-white/40 overflow-hidden">
                    <div className={`h-full bg-white transition-all duration-200 ${idx <= photoIndex ? "w-full" : "w-0"}`} />
                  </div>
                ))}
              </div>
              <div className="absolute top-7 right-3 z-20 px-2 py-0.5 rounded-full bg-black/50 pointer-events-none">
                <span className="text-white text-xs font-semibold">
                  {photoIndex + 1} / {photos.length}
                </span>
              </div>
            </>
          )}

          {photos.length === 0 ? (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-card to-background">
              <span className="text-primary text-6xl font-bold font-['Syne'] opacity-20">
                {candidate.name?.[0]}
              </span>
            </div>
          ) : (
            <div
              ref={photoContainerRef}
              className="relative w-full h-full overflow-hidden"
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              style={{ touchAction: "pan-y" }}
            >
              <div
                className="absolute inset-0 flex h-full"
                style={{
                  width: `${N * 100}%`,
                  transform: `translateX(${stripX}%)`,
                  transition: isDraggingPhoto ? "none" : "transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
                }}
              >
                {photos.map((photo, idx) => (
                  <div key={photo.url} style={{ width: `${100 / N}%` }} className="h-full shrink-0">
                    {photo.media_type === "video" ? (
                      <video
                        src={photo.url}
                        className="w-full h-full object-cover"
                        autoPlay={idx === photoIndex}
                        muted
                        loop
                        playsInline
                      />
                    ) : (
                      <img
                        src={photo.url}
                        alt={candidate.name}
                        className="w-full h-full object-cover"
                        draggable={false}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-card to-transparent pointer-events-none" />

          <div className="absolute bottom-4 left-6 right-6 pointer-events-none z-10">
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
      className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-md flex flex-col items-center justify-center px-6 text-center"
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
          Keep Browsing
        </Button>
      </motion.div>
    </motion.div>
  );
}

export default function DiscoverPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [matchName, setMatchName] = useState<string | null>(null);
  const [isSwiping, setIsSwiping] = useState(false);
  const [invitesCount, setInvitesCount] = useState<number>(0);
  const [exiting, setExiting] = useState<{ id: string; direction: SwipeDirection } | null>(null);
  const [composeFor, setComposeFor] = useState<Candidate | null>(null);
  const [messageText, setMessageText] = useState("");
  const [isSendingMessage, setIsSendingMessage] = useState(false);

  const fetchInvitesCount = useCallback(async () => {
    try {
      const res = await fetch("/api/discover/invites", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const body = await res.json();
      setInvitesCount((body.revealed?.length ?? 0) + (body.new_count ?? 0));
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

  const handleDecision = async (direction: SwipeDirection) => {
    if (isSwiping || candidates.length === 0) return;
    const target = candidates[0];
    setIsSwiping(true);
    setExiting({ id: target.id, direction });

    const apiCall = fetch("/api/discover/swipe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ targetId: target.id, direction }),
    }).then(async (res) => {
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to record swipe");
      return body;
    });

    // Let the exit animation play before actually removing the card.
    await new Promise((resolve) => setTimeout(resolve, 300));
    setCandidates((prev) => prev.filter((c) => c.id !== target.id));
    setExiting(null);

    try {
      const body = await apiCall;
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

      setCandidates((prev) => prev.filter((c) => c.id !== composeFor.id));
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
                stackIndex={i}
                isExiting={exiting?.id === candidate.id}
                exitDirection={exiting?.id === candidate.id ? exiting.direction : null}
              />
            ))}
          </AnimatePresence>
        )}
      </div>

      {visibleCards.length > 0 && (
        <div className="flex items-center justify-center gap-4 mt-6">
          <button
            onClick={() => handleDecision("pass")}
            disabled={isSwiping}
            className="w-16 h-16 rounded-full bg-card border border-card-border flex items-center justify-center text-muted-foreground hover:border-destructive hover:text-destructive transition-colors shadow-lg active:scale-95"
          >
            <X size={28} />
          </button>
          <button
            onClick={() => {
              const top = candidates[0];
              if (top) setComposeFor(top);
            }}
            disabled={isSwiping}
            className="w-12 h-12 rounded-full bg-card border border-card-border flex items-center justify-center text-accent hover:border-accent transition-colors shadow-lg active:scale-95"
          >
            <MessageCircle size={20} />
          </button>
          <button
            onClick={() => handleDecision("like")}
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

      <AnimatePresence>
        {composeFor && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm flex items-end"
            onClick={() => {
              if (!isSendingMessage) {
                setComposeFor(null);
                setMessageText("");
              }
            }}
          >
            <motion.div
              initial={{ y: 100 }}
              animate={{ y: 0 }}
              exit={{ y: 100 }}
              transition={{ type: "spring", damping: 24 }}
              className="w-full max-w-[430px] mx-auto bg-card border-t border-card-border rounded-t-3xl p-6 pb-10"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="font-['Syne'] font-bold text-lg mb-1">Message {composeFor.name}</h3>
              <p className="text-xs text-muted-foreground mb-4">
                Send an opening message before you match.
              </p>
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
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
