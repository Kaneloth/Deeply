import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getUserIdFromToken } from "@/lib/tokenUtils";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ProfileCard, type ProfileCardData } from "@/components/ProfileCard";
import { X, Heart, MessageCircle, Star, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSparks } from "@/contexts/SparksContext";
import { useDiscoverControls } from "@/contexts/DiscoverControlsContext";
import { captureUserLocation } from "@/lib/captureLocation";

interface Candidate extends ProfileCardData {
  photo_url: string | null;
  integrity_score: number;
}

type SwipeDirection = "like" | "pass" | "super_like";

const EXIT_VARIANTS: Record<SwipeDirection, { x?: number; y?: number; opacity: number; rotate?: number; scale?: number }> = {
  like: { x: 400, opacity: 0, rotate: 20 },
  pass: { x: -400, opacity: 0, rotate: -20 },
  super_like: { y: -400, opacity: 0, scale: 1.05 },
};

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
      <ProfileCard profile={candidate} active={isTop} enablePullReveal={isTop} />
    </motion.div>
  );
}

import { MatchCelebration } from "@/components/MatchCelebration";
import { ScanWaveLoader } from "@/components/ScanWaveLoader";

let hasShownDiscoverScanWave = false;
const MIN_SCAN_WAVE_MS = 2000;

export default function DiscoverPage() {
  const { token } = useAuth();
  const userId = getUserIdFromToken(token);
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { setControls } = useDiscoverControls();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showScanWave, setShowScanWave] = useState(false);
  const [matchCelebration, setMatchCelebration] = useState<{ name: string; matchId: string; photoUrl?: string } | null>(null);
  const [isSwiping, setIsSwiping] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);
  const [exiting, setExiting] = useState<{ id: string; direction: SwipeDirection } | null>(null);
  const [composeFor, setComposeFor] = useState<Candidate | null>(null);
  const [messageText, setMessageText] = useState("");
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [reshuffleStatus, setReshuffleStatus] = useState<{ isFree: boolean; cost: number } | null>(null);
  const [isReshuffling, setIsReshuffling] = useState(false);

  const fetchReshuffleStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/discover/reshuffle-status", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const body = await res.json();
      setReshuffleStatus({ isFree: body.isFree, cost: body.cost });
    } catch {
      // Silent — non-critical, the button just won't know its state yet.
    }
  }, [token]);

  const handleReshuffle = async () => {
    setIsReshuffling(true);
    try {
      const res = await fetch("/api/discover/reshuffle", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to reshuffle");
      setCandidates(body.candidates ?? []);

      // Previously this only informed the user AFTER they'd already been
      // charged for a paid reshuffle — meaning the first (free) reshuffle
      // gave no warning at all about the cost structure, so the very
      // next tap could surprise-charge someone with no prior notice.
      // Now: the notice fires proactively, right when the free one gets
      // used, so the person knows in advance what a subsequent reshuffle
      // within the next 7 days will cost — before they ever get charged.
      // Uses body.cost (the live, admin-configured value the backend
      // just returned) rather than a hardcoded number, so this always
      // reflects whatever's actually set in the admin dashboard.
      if (body.wasFree) {
        if (!localStorage.getItem(`deeply_seen_reshuffle_cost_notice_${userId}`)) {
          localStorage.setItem(`deeply_seen_reshuffle_cost_notice_${userId}`, "1");
          toast({
            title: "Free reshuffle used",
            description: `Your next free reshuffle is available in 7 days. Reshuffling again before then costs ${body.cost} Sparks.`,
          });
        }
      }
      fetchReshuffleStatus();
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to reshuffle.",
        variant: "destructive",
      });
    } finally {
      setIsReshuffling(false);
    }
  };

  const fetchQueue = useCallback(async () => {
    const isFirstLoadOfSession = !hasShownDiscoverScanWave;
    if (isFirstLoadOfSession) {
      hasShownDiscoverScanWave = true;
      setShowScanWave(true);
    }
    setIsLoading(true);
    const startedAt = Date.now();
    try {
      const res = await fetch("/api/discover/queue", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load profiles");

      if (isFirstLoadOfSession) {
        const elapsed = Date.now() - startedAt;
        const remaining = MIN_SCAN_WAVE_MS - elapsed;
        if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
      }

      setCandidates(body.candidates ?? []);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to load profiles.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
      setShowScanWave(false);
    }
  }, [token, toast]);

  useEffect(() => {
    fetchQueue();
    fetchReshuffleStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    captureUserLocation(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Register this page's reshuffle state with the shared context on
  // every relevant change, so TopBar always displays current values —
  // and clear it on unmount, so navigating away from Discover makes
  // this control disappear from the header automatically, without
  // TopBar needing any route-checking logic of its own. Invites count
  // deliberately isn't part of this anymore — that badge now lives in
  // BottomNav, fetched independently there, since it needs to stay
  // accurate on every page, not just while Discover happens to be
  // mounted.
  useEffect(() => {
    setControls({ reshuffleStatus, isReshuffling, onReshuffle: handleReshuffle });
    return () => setControls(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reshuffleStatus, isReshuffling]);

  const { refresh: refreshSparksBadge } = useSparks();

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
      body: JSON.stringify({
        targetId: target.id,
        direction,
        clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    }).then(async (res) => {
      if (res.status === 402) {
        const body = await res.json();
        throw new Error(body.error ?? "Insufficient Sparks");
      }
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to record swipe");
      return body;
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    setCandidates((prev) => prev.filter((c) => c.id !== target.id));
    setExiting(null);

    try {
      const body = await apiCall;
      if (direction === "super_like" || body.sparksCharged) {
        refreshSparksBadge();
      }
      if (direction === "like" && body.sparksCharged && !localStorage.getItem(`deeply_seen_invite_quota_cost_notice_${userId}`)) {
        localStorage.setItem(`deeply_seen_invite_quota_cost_notice_${userId}`, "1");
        toast({ title: "5 Sparks used", description: "You've used today's 15 free invites — extra invites cost 5 Sparks each." });
      }
      if (body.matched) {
        setMatchCelebration({ name: target.name, matchId: body.matchId, photoUrl: target.photo_url ?? undefined });
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

  const handleUndo = async () => {
    if (isUndoing) return;
    setIsUndoing(true);
    try {
      const res = await fetch("/api/discover/undo", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 402) {
        const body = await res.json();
        toast({
          title: "You're out of Sparks",
          description: "Recharge now or wait for your next monthly grant to undo a swipe.",
          variant: "destructive",
        });
        return;
      }

      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to undo");

      if (body.restoredProfile) {
        setCandidates((prev) => [body.restoredProfile, ...prev]);
      }
      refreshSparksBadge();
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to undo swipe.",
        variant: "destructive",
      });
    } finally {
      setIsUndoing(false);
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
    if (showScanWave) {
      return <ScanWaveLoader />;
    }
    return (
      <div className="p-4 pt-10 space-y-6">
        <Skeleton className="h-8 w-32 mx-2" />
        <Skeleton className="h-[500px] w-full rounded-3xl" />
      </div>
    );
  }

  const visibleCards = candidates.slice(0, 3);

  return (
    <div className="flex flex-col h-full overflow-hidden px-2 pb-1 pt-2">
      <div className="flex-1 relative min-h-0">
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
        <div className="flex items-center justify-center gap-2.5 mt-2">
          <button
            onClick={handleUndo}
            disabled={isUndoing || isSwiping}
            className="w-9 h-9 rounded-full bg-card border border-card-border flex items-center justify-center text-amber-500 hover:border-amber-500 transition-colors shadow-lg active:scale-95 disabled:opacity-50"
          >
            <RotateCcw size={15} />
          </button>
          <button
            onClick={() => handleDecision("pass")}
            disabled={isSwiping}
            className="w-12 h-12 rounded-full bg-card border border-card-border flex items-center justify-center text-muted-foreground hover:border-destructive hover:text-destructive transition-colors shadow-lg active:scale-95"
          >
            <X size={20} />
          </button>
          <button
            onClick={() => {
              const top = candidates[0];
              if (top) setComposeFor(top);
            }}
            disabled={isSwiping}
            className="w-9 h-9 rounded-full bg-card border border-card-border flex items-center justify-center text-accent hover:border-accent transition-colors shadow-lg active:scale-95"
          >
            <MessageCircle size={16} />
          </button>
          <button
            onClick={() => handleDecision("like")}
            disabled={isSwiping}
            className="w-12 h-12 rounded-full bg-gradient-accent flex items-center justify-center text-white shadow-[0_8px_20px_rgba(225,29,72,0.3)] active:scale-95 transition-transform"
          >
            <Heart size={20} className="fill-current" />
          </button>
          <button
            onClick={() => handleDecision("super_like")}
            disabled={isSwiping}
            className="w-9 h-9 rounded-full bg-card border border-card-border flex items-center justify-center text-sky-400 hover:border-sky-400 transition-colors shadow-lg active:scale-95"
          >
            <Star size={15} className="fill-current" />
          </button>
        </div>
      )}

      <AnimatePresence>
        {matchCelebration && (
          <MatchCelebration
            name={matchCelebration.name}
            photoUrl={matchCelebration.photoUrl}
            onContinue={() => setMatchCelebration(null)}
            onMessage={() => setLocation(`/matches/${matchCelebration.matchId}/chat`)}
          />
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
