import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSparks } from "@/contexts/SparksContext";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, Star, Lock, Heart, X, MapPin } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";

interface Invite {
  id: string;
  name: string;
  age: number;
  bio: string | null;
  city: string | null;
  photo_url: string | null;
  photos: { url: string; media_type: "image" | "video" }[];
  personality_tags: string[];
  super_liked: boolean;
}

const PHOTO_DRAG_THRESHOLD_PCT = 20;

function InviteDetailOverlay({
  invite,
  onClose,
  onDecide,
  isActioning,
}: {
  invite: Invite;
  onClose: () => void;
  onDecide: (direction: "like" | "pass") => void;
  isActioning: boolean;
}) {
  const [photoIndex, setPhotoIndex] = useState(0);
  const [dragPercent, setDragPercent] = useState(0);
  const isDraggingPhoto = dragPercent !== 0;
  const photoContainerRef = useRef<HTMLDivElement>(null);
  const touchStateRef = useRef({ startX: 0, startY: 0, active: false, axisLocked: false, horizontal: false });
  const photos = invite.photos.length > 0 ? invite.photos : [];

  const goNext = () => setPhotoIndex((i) => Math.min(i + 1, Math.max(photos.length - 1, 0)));
  const goPrev = () => setPhotoIndex((i) => Math.max(i - 1, 0));

  const handleTouchStart = (e: React.TouchEvent) => {
    if (photos.length <= 1) return;
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
    if (pct > 0 && photoIndex === 0) pct *= 0.15;
    if (pct < 0 && photoIndex === photos.length - 1) pct *= 0.15;
    setDragPercent(pct);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const t = touchStateRef.current;
    t.active = false;

    if (!t.axisLocked) {
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
    <div className="fixed inset-0 z-[100] bg-background flex flex-col">
      <div className="w-full max-w-[430px] mx-auto flex-1 flex flex-col overflow-hidden relative">
        <button
          onClick={onClose}
          className="absolute top-12 left-4 z-30 w-10 h-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white border border-white/10"
        >
          <ChevronLeft size={24} />
        </button>

        <div className="relative h-[55%] min-h-[350px] w-full bg-muted overflow-hidden shrink-0">
          {photos.length > 1 && (
            <>
              <div className="absolute top-12 left-16 right-3 z-20 flex gap-1 pointer-events-none">
                {photos.map((_, idx) => (
                  <div key={idx} className="flex-1 h-1.5 rounded-full bg-white/40 overflow-hidden">
                    <div className={`h-full bg-white transition-all duration-200 ${idx <= photoIndex ? "w-full" : "w-0"}`} />
                  </div>
                ))}
              </div>
              <div className="absolute top-[4.5rem] right-3 z-20 px-2 py-0.5 rounded-full bg-black/50 pointer-events-none">
                <span className="text-white text-xs font-semibold">
                  {photoIndex + 1} / {photos.length}
                </span>
              </div>
            </>
          )}

          {invite.super_liked && (
            <div className="absolute top-12 right-3 z-20 w-8 h-8 rounded-full bg-accent flex items-center justify-center shadow-lg">
              <Star size={16} className="fill-current text-white" />
            </div>
          )}

          {photos.length === 0 ? (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-card to-background">
              <span className="text-primary text-6xl font-bold font-['Syne'] opacity-20">{invite.name?.[0]}</span>
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
                      <img src={photo.url} alt={invite.name} className="w-full h-full object-cover" draggable={false} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent pointer-events-none" />
          <div className="absolute bottom-4 left-6 right-6 pointer-events-none">
            <h2 className="text-3xl font-['Syne'] font-bold text-white flex items-end gap-2">
              {invite.name} <span className="text-xl font-normal text-white/80">{invite.age}</span>
            </h2>
            {invite.city && (
              <div className="flex items-center gap-1 text-white/70 text-sm mt-1">
                <MapPin size={14} /> {invite.city}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {invite.personality_tags?.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {invite.personality_tags.map((tag) => (
                <span key={tag} className="px-3 py-1.5 bg-secondary text-secondary-foreground rounded-full text-sm font-medium">
                  {tag}
                </span>
              ))}
            </div>
          )}
          {invite.bio && <p className="text-sm text-muted-foreground leading-relaxed">{invite.bio}</p>}
        </div>

        <div className="flex-none p-6 pt-3 flex items-center justify-center gap-6">
          <button
            onClick={() => onDecide("pass")}
            disabled={isActioning}
            className="flex-1 h-14 rounded-2xl bg-card border border-card-border flex items-center justify-center gap-2 text-muted-foreground hover:border-destructive hover:text-destructive transition-colors font-semibold"
          >
            <X size={20} />
            Decline
          </button>
          <button
            onClick={() => onDecide("like")}
            disabled={isActioning}
            className="flex-1 h-14 rounded-2xl bg-gradient-accent text-white flex items-center justify-center gap-2 font-semibold shadow-[0_8px_20px_rgba(225,29,72,0.3)]"
          >
            <Heart size={20} className="fill-current" />
            Accept
          </button>
        </div>
      </div>
    </div>
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
      <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", damping: 12 }}>
        <div className="text-6xl mb-6">💥</div>
        <h1 className="text-4xl font-['Syne'] font-extrabold text-transparent bg-clip-text bg-gradient-accent mb-3">
          It's a Match!
        </h1>
        <p className="text-muted-foreground mb-10">You and {name} connected. Say hi!</p>
        <Button onClick={onContinue} className="w-full max-w-xs h-14 rounded-2xl bg-gradient-accent border-0 text-white font-bold text-lg">
          Continue
        </Button>
      </motion.div>
    </motion.div>
  );
}

export default function InvitesPage() {
  const { token } = useAuth();
  const { refresh: refreshSparksBadge } = useSparks();
  const { toast } = useToast();

  const [revealed, setRevealed] = useState<Invite[]>([]);
  const [newCount, setNewCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRevealing, setIsRevealing] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [matchName, setMatchName] = useState<string | null>(null);
  const [selectedInvite, setSelectedInvite] = useState<Invite | null>(null);

  const fetchInvites = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/discover/invites", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load invites");
      setRevealed(body.revealed ?? []);
      setNewCount(body.new_count ?? 0);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to load invites.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [token, toast]);

  useEffect(() => {
    fetchInvites();
  }, [fetchInvites]);

  const handleReveal = async () => {
    setIsRevealing(true);
    try {
      const res = await fetch("/api/discover/invites/reveal", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 402) {
        toast({
          title: "You're out of Sparks",
          description: "Recharge now or wait for your next monthly grant to see your new invites.",
          variant: "destructive",
        });
        return;
      }

      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to reveal invites");
      setRevealed(body.invites ?? []);
      setNewCount(0);
      if (body.balance !== null) {
        refreshSparksBadge();
      }
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to reveal invites.",
        variant: "destructive",
      });
    } finally {
      setIsRevealing(false);
    }
  };

  const handleDecide = async (invite: Invite, direction: "like" | "pass") => {
    setAcceptingId(invite.id);
    try {
      const res = await fetch("/api/discover/swipe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ targetId: invite.id, direction }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to record decision");

      setRevealed((prev) => prev.filter((i) => i.id !== invite.id));
      setSelectedInvite((prev) => (prev?.id === invite.id ? null : prev));

      if (body.matched) {
        setMatchName(invite.name);
      }
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to record decision.",
        variant: "destructive",
      });
    } finally {
      setAcceptingId(null);
    }
  };

  return (
    <div className="min-h-full pb-6 pt-10 px-4">
      <header className="flex items-center gap-3 mb-6 px-2">
        <Link href="/discover" className="w-10 h-10 flex items-center justify-center rounded-full bg-secondary text-foreground hover:bg-secondary/80 transition-colors">
          <ChevronLeft size={22} />
        </Link>
        <h1 className="text-2xl font-['Syne'] font-bold tracking-tight">Invites</h1>
      </header>

      {isLoading ? (
        <Skeleton className="h-40 w-full rounded-3xl" />
      ) : (
        <>
          {newCount > 0 && (
            <div className="relative w-full rounded-3xl overflow-hidden bg-card border border-card-border p-6 mb-6">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-accent/10" />
              <div className="relative z-10 flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                  <Lock className="text-primary" size={20} />
                </div>
                <div className="flex-1">
                  <p className="font-['Syne'] font-bold text-foreground">
                    {newCount} new {newCount === 1 ? "person" : "people"} invited you
                  </p>
                  <p className="text-xs text-muted-foreground">Reveal to see who</p>
                </div>
                <Button
                  onClick={handleReveal}
                  disabled={isRevealing}
                  className="h-10 px-4 rounded-xl bg-gradient-accent border-0 text-white font-semibold text-sm shrink-0"
                >
                  {isRevealing ? "..." : "Reveal"}
                </Button>
              </div>
            </div>
          )}

          {revealed.length === 0 && newCount === 0 ? (
            <div className="flex flex-col items-center text-center px-4 mt-10">
              <div className="w-20 h-20 rounded-full bg-card border border-card-border flex items-center justify-center mb-6">
                <Heart className="text-muted-foreground" size={28} />
              </div>
              <h2 className="text-xl font-['Syne'] font-bold">No invites yet</h2>
              <p className="text-muted-foreground mt-2 max-w-[260px]">
                Keep swiping in Discover — when someone invites you to connect, they'll show up here.
              </p>
            </div>
          ) : revealed.length > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              {revealed.map((invite) => (
                <div key={invite.id} className="bg-card border border-card-border rounded-2xl overflow-hidden">
                  <button
                    onClick={() => setSelectedInvite(invite)}
                    className="relative aspect-[3/4] bg-muted w-full block"
                  >
                    {invite.photo_url ? (
                      <img src={invite.photo_url} alt={invite.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-card to-background">
                        <span className="text-primary text-3xl font-bold font-['Syne'] opacity-20">{invite.name?.[0]}</span>
                      </div>
                    )}
                    {invite.super_liked && (
                      <div className="absolute top-2 right-2 w-7 h-7 rounded-full bg-accent flex items-center justify-center shadow-lg">
                        <Star size={14} className="fill-current text-white" />
                      </div>
                    )}
                    <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-black/70 to-transparent" />
                    <div className="absolute bottom-2 left-3 right-3">
                      <p className="text-white font-semibold text-sm truncate">
                        {invite.name}, {invite.age}
                      </p>
                    </div>
                  </button>
                  <div className="flex border-t border-card-border">
                    <button
                      onClick={() => handleDecide(invite, "pass")}
                      disabled={acceptingId === invite.id}
                      className="flex-1 py-2.5 flex items-center justify-center gap-1.5 text-muted-foreground font-semibold text-sm hover:bg-secondary/50 hover:text-destructive transition-colors disabled:opacity-50 border-r border-card-border"
                    >
                      <X size={14} />
                      Decline
                    </button>
                    <button
                      onClick={() => handleDecide(invite, "like")}
                      disabled={acceptingId === invite.id}
                      className="flex-1 py-2.5 flex items-center justify-center gap-1.5 text-primary font-semibold text-sm hover:bg-secondary/50 transition-colors disabled:opacity-50"
                    >
                      <Heart size={14} className="fill-current" />
                      {acceptingId === invite.id ? "..." : "Accept"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}

      <AnimatePresence>
        {matchName && <MatchCelebration name={matchName} onContinue={() => setMatchName(null)} />}
      </AnimatePresence>

      {selectedInvite && (
        <InviteDetailOverlay
          invite={selectedInvite}
          onClose={() => setSelectedInvite(null)}
          onDecide={(direction) => handleDecide(selectedInvite, direction)}
          isActioning={acceptingId === selectedInvite.id}
        />
      )}
    </div>
  );
}
