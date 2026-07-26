import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSparks } from "@/contexts/SparksContext";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, Star, Lock, Heart } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";

interface Invite {
  id: string;
  name: string;
  age: number;
  bio: string | null;
  city: string | null;
  photo_url: string | null;
  personality_tags: string[];
  super_liked: boolean;
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
  const [, setLocation] = useLocation();

  const [count, setCount] = useState<number | null>(null);
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [isLoadingCount, setIsLoadingCount] = useState(true);
  const [isRevealing, setIsRevealing] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [matchName, setMatchName] = useState<string | null>(null);

  const fetchCount = useCallback(async () => {
    setIsLoadingCount(true);
    try {
      const res = await fetch("/api/discover/invites/count", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load invites");
      setCount(body.count ?? 0);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to load invites.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingCount(false);
    }
  }, [token, toast]);

  useEffect(() => {
    fetchCount();
  }, [fetchCount]);

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
          description: "Recharge now or wait for your next monthly grant to see your invites.",
          variant: "destructive",
        });
        return;
      }

      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to reveal invites");
      setInvites(body.invites ?? []);
      refreshSparksBadge();
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

  const handleAccept = async (invite: Invite) => {
    setAcceptingId(invite.id);
    try {
      const res = await fetch("/api/discover/swipe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ targetId: invite.id, direction: "like" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to accept invite");

      setInvites((prev) => (prev ? prev.filter((i) => i.id !== invite.id) : prev));

      if (body.matched) {
        setMatchName(invite.name);
      }
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to accept invite.",
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

      {!invites ? (
        // Not revealed yet — show count teaser + reveal CTA
        <div className="flex flex-col items-center text-center px-4 mt-10">
          {isLoadingCount ? (
            <Skeleton className="h-40 w-full rounded-3xl" />
          ) : count === 0 ? (
            <>
              <div className="w-20 h-20 rounded-full bg-card border border-card-border flex items-center justify-center mb-6">
                <Heart className="text-muted-foreground" size={28} />
              </div>
              <h2 className="text-xl font-['Syne'] font-bold">No invites yet</h2>
              <p className="text-muted-foreground mt-2 max-w-[260px]">
                Keep swiping in Discover — when someone invites you to connect, they'll show up here.
              </p>
            </>
          ) : (
            <>
              <div className="relative w-full rounded-3xl overflow-hidden bg-card border border-card-border p-8 mb-6">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-accent/10" />
                <div className="relative z-10 flex flex-col items-center">
                  <Lock className="text-primary mb-4" size={32} />
                  <h2 className="text-4xl font-['Syne'] font-extrabold text-transparent bg-clip-text bg-gradient-accent">
                    {count}
                  </h2>
                  <p className="text-muted-foreground mt-1">
                    {count === 1 ? "person invited you" : "people invited you"}
                  </p>
                </div>
              </div>
              <Button
                onClick={handleReveal}
                disabled={isRevealing}
                className="w-full h-14 rounded-2xl bg-gradient-accent border-0 text-white font-bold text-lg shadow-[0_8px_20px_rgba(225,29,72,0.3)]"
              >
                {isRevealing ? "Revealing..." : "See Your Invites"}
              </Button>
            </>
          )}
        </div>
      ) : invites.length === 0 ? (
        <div className="flex flex-col items-center text-center px-4 mt-10">
          <div className="w-20 h-20 rounded-full bg-card border border-card-border flex items-center justify-center mb-6">
            <Heart className="text-muted-foreground" size={28} />
          </div>
          <h2 className="text-xl font-['Syne'] font-bold">All caught up</h2>
          <p className="text-muted-foreground mt-2 max-w-[260px]">
            You've seen everyone who's invited you so far.
          </p>
        </div>
      ) : (
        // Revealed — grid of profiles
        <div className="grid grid-cols-2 gap-3">
          {invites.map((invite) => (
            <div key={invite.id} className="bg-card border border-card-border rounded-2xl overflow-hidden">
              <div className="relative aspect-[3/4] bg-muted">
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
              </div>
              <button
                onClick={() => handleAccept(invite)}
                disabled={acceptingId === invite.id}
                className="w-full py-2.5 flex items-center justify-center gap-1.5 text-primary font-semibold text-sm hover:bg-secondary/50 transition-colors disabled:opacity-50"
              >
                <Heart size={14} className="fill-current" />
                {acceptingId === invite.id ? "..." : "Accept"}
              </button>
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {matchName && <MatchCelebration name={matchName} onContinue={() => setMatchName(null)} />}
      </AnimatePresence>
    </div>
  );
}
