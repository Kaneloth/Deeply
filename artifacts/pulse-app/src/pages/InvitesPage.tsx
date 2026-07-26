import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSparks } from "@/contexts/SparksContext";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PhotoCarousel } from "@/components/PhotoCarousel";
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

function InviteDetailOverlay({
  invite,
  onClose,
  onDecide,
  isActioning,
}: {
  invite: Invite;
  onClose: () => void;
  onDecide?: (direction: "like" | "pass") => void;
  isActioning?: boolean;
}) {
  const photos = invite.photos.length > 0 ? invite.photos : [];

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
          <PhotoCarousel photos={photos} name={invite.name} />

          {invite.super_liked && (
            <div className="absolute top-12 right-3 z-20 w-8 h-8 rounded-full bg-accent flex items-center justify-center shadow-lg">
              <Star size={16} className="fill-current text-white" />
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
          {onDecide ? (
            <>
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
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Waiting for them to respond</p>
          )}
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
  const [mode, setMode] = useState<"received" | "sent">("received");
  const [sent, setSent] = useState<Invite[] | null>(null);
  const [sentLoading, setSentLoading] = useState(false);

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

  const fetchSent = useCallback(async () => {
    setSentLoading(true);
    try {
      const res = await fetch("/api/discover/invites/sent", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load sent invites");
      setSent(body.sent ?? []);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to load sent invites.",
        variant: "destructive",
      });
    } finally {
      setSentLoading(false);
    }
  }, [token, toast]);

  const handleSwitchMode = (next: "received" | "sent") => {
    setMode(next);
    if (next === "sent" && sent === null) {
      fetchSent();
    }
  };

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
    <div className="min-h-full pb-6">
      <div
        className="sticky top-0 z-30 bg-background/90 backdrop-blur-xl border-b border-border px-4 pb-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <header className="flex items-center gap-3 mb-4 px-2">
          <Link href="/discover" className="w-10 h-10 flex items-center justify-center rounded-full bg-secondary text-foreground hover:bg-secondary/80 transition-colors">
            <ChevronLeft size={22} />
          </Link>
          <h1 className="text-2xl font-['Syne'] font-bold tracking-tight">Invites</h1>
        </header>

        <div className="flex gap-2 px-2">
          <button
            onClick={() => handleSwitchMode("received")}
            className={`flex-1 h-10 rounded-xl text-sm font-semibold transition-colors ${
              mode === "received" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
            }`}
          >
            Received
          </button>
          <button
            onClick={() => handleSwitchMode("sent")}
            className={`flex-1 h-10 rounded-xl text-sm font-semibold transition-colors ${
              mode === "sent" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
            }`}
          >
            Sent
          </button>
        </div>
      </div>

      <div className="px-4 pt-6">

      {mode === "sent" ? (
        sentLoading ? (
          <Skeleton className="h-40 w-full rounded-3xl" />
        ) : !sent || sent.length === 0 ? (
          <div className="flex flex-col items-center text-center px-4 mt-10">
            <div className="w-20 h-20 rounded-full bg-card border border-card-border flex items-center justify-center mb-6">
              <Heart className="text-muted-foreground" size={28} />
            </div>
            <h2 className="text-xl font-['Syne'] font-bold">No pending invites sent</h2>
            <p className="text-muted-foreground mt-2 max-w-[260px]">
              People you invite from Discover or Search who haven't matched back yet will show up here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {sent.map((invite) => (
              <button
                key={invite.id}
                onClick={() => setSelectedInvite(invite)}
                className="relative aspect-[3/4] bg-card border border-card-border rounded-2xl overflow-hidden"
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
                  <p className="text-white/70 text-xs">Pending</p>
                </div>
              </button>
            ))}
          </div>
        )
      ) : isLoading ? (
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
      </div>

      <AnimatePresence>
        {matchName && <MatchCelebration name={matchName} onContinue={() => setMatchName(null)} />}
      </AnimatePresence>

      {selectedInvite && (
        <InviteDetailOverlay
          invite={selectedInvite}
          onClose={() => setSelectedInvite(null)}
          onDecide={mode === "received" ? (direction) => handleDecide(selectedInvite, direction) : undefined}
          isActioning={acceptingId === selectedInvite.id}
        />
      )}
    </div>
  );
}
