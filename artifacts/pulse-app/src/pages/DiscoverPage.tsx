import { useState, useEffect, useCallback, useRef, memo } from "react";
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

const SwipeCard = memo(
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
        // Do not fade the card itself. PhotoCarousel owns image readiness,
        // and stacking a card opacity animation on top of image decoding
        // produces a visible blink in native WebViews.
        initial={{ scale: 0.98, opacity: 1 }}
        animate={
          isExiting && exitDirection
            ? EXIT_VARIANTS[exitDirection]
            : { scale: 1, opacity: 1, x: 0, y: 0, rotate: 0 }
        }
        // Small per-card stagger on the initial mount only (never on
        // exit, so swipes still feel instant) — 3 stacked cards fading
        // in at the exact same instant, right when the page is also
        // busy handling several concurrent fetches, is exactly the kind
        // of simultaneous main-thread work that can make a JS-driven
        // animation stutter instead of animating smoothly. Spreading
        // them by a few dozen ms each reduces peak work at any single
        // frame without being visually noticeable as a delay.
        transition={{ duration: 0.3, ease: "easeOut", delay: isExiting ? 0 : stackIndex * 0.04 }}
      >
        <ProfileCard profile={candidate} active={isTop} enablePullReveal={isTop} />
      </motion.div>
    );
  },
  // Custom comparator — candidate is a brand-new object reference on
  // every fetch (JSON.parse always allocates fresh objects), even when
  // the underlying data hasn't actually changed at all. This app also
  // has several independent background polls (Sparks, notifications,
  // match indicator) that can trigger re-renders elsewhere in the tree.
  // Without this, any of those unrelated re-renders — or a background
  // stale-while-revalidate refresh landing identical data — could cause
  // this card to re-render and, if anything inside ProfileCard resets
  // state based on object identity rather than candidate.id, visually
  // "blink" for no real reason. Comparing by id (and the handful of
  // props that actually affect rendering) instead of reference stops
  // that cascade at this boundary regardless of what's happening deeper
  // inside ProfileCard.
  (prev, next) =>
    prev.candidate.id === next.candidate.id &&
    prev.isTop === next.isTop &&
    prev.isExiting === next.isExiting &&
    prev.exitDirection === next.exitDirection &&
    prev.stackIndex === next.stackIndex,
);

import { MatchCelebration } from "@/components/MatchCelebration";
import { ScanWaveLoader } from "@/components/ScanWaveLoader";

let hasShownDiscoverScanWave = false;
const MIN_SCAN_WAVE_MS = 2000;

// In-memory only — deliberately not persisted to localStorage, so this
// only survives within the same app session/process (a real app restart
// or web page reload both start fresh, same as hasShownDiscoverScanWave
// above). Lets a REVISIT to Discover show the last-seen queue instantly
// instead of a blank skeleton, while a fresh fetch quietly runs
// underneath and replaces it once ready. A lightweight stopgap for
// "every navigation feels like a cold load," short of a full migration
// to react-query's built-in stale-while-revalidate (this app already
// depends on @tanstack/react-query, just doesn't use it for data
// fetching yet).
//
// Known limitation: the cached queue can briefly include someone the
// user already swiped on since it was cached (e.g. swiped on Search,
// then revisited Discover) — self-corrects within a second or two once
// the background refresh lands, and any swipe still records correctly
// server-side regardless, but it's a real (small, transient) tradeoff
// of this shortcut worth knowing about.
let cachedCandidates: Candidate[] | null = null;

export default function DiscoverPage() {
  const { token } = useAuth();
  const userId = getUserIdFromToken(token);
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { setControls } = useDiscoverControls();
  const [candidates, setCandidates] = useState<Candidate[]>(cachedCandidates ?? []);
  // Always current, regardless of which closure of handleReshuffle
  // happens to be registered in DiscoverControlsContext at call time.
  // The registration effect below only re-runs when reshuffleStatus or
  // isReshuffling change — not on every candidates update — so the
  // registered onReshuffle callback can end up closing over a stale
  // (sometimes still-empty) candidates array. Reading from this ref
  // instead of the closed-over state sidesteps that staleness entirely:
  // whichever version of the callback actually executes always sees the
  // true current queue.
  const candidatesRef = useRef<Candidate[]>([]);
  useEffect(() => {
    candidatesRef.current = candidates;
  }, [candidates]);
  const [isLoading, setIsLoading] = useState(cachedCandidates === null);
  const [showScanWave, setShowScanWave] = useState(false);
  const [matchCelebration, setMatchCelebration] = useState<{ name: string; matchId: string; photoUrl?: string } | null>(null);
  const [isSwiping, setIsSwiping] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);
  // In-memory only, deliberately never persisted (no localStorage, no
  // server-side session concept) — this is what makes undo only possible
  // "in the same process": navigating away unmounts DiscoverPage and
  // this state is gone; closing the app ends the JS runtime entirely and
  // it's gone. Reopening/remounting always starts from null, with no way
  // to reconstruct what was last swiped. Overwritten on every new swipe,
  // so only ever the immediately preceding one is ever undoable.
  const [lastSwiped, setLastSwiped] = useState<{ targetId: string; direction: SwipeDirection } | null>(null);
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
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        // Read from candidatesRef, not the closed-over `candidates`
        // directly — handleReshuffle can be called via a stale closure
        // registered in DiscoverControlsContext (see candidatesRef
        // definition above), so relying on the closure's own view of
        // candidates was intermittently sending an empty exclusion list,
        // making the first reshuffle after mount silently no-op visually
        // while still consuming the free weekly reshuffle (or charging
        // Sparks) for it. The ref is always current regardless of which
        // closure executes.
        body: JSON.stringify({
          currentQueueIds: candidatesRef.current[0] ? [candidatesRef.current[0].id] : [],
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to reshuffle");
      const reshuffled = body.candidates ?? [];
      cachedCandidates = reshuffled;
      setCandidates(reshuffled);

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
    const hadCachedContent = cachedCandidates !== null;
    if (isFirstLoadOfSession) {
      hasShownDiscoverScanWave = true;
      setShowScanWave(true);
      setIsLoading(true);
    } else if (!hadCachedContent) {
      setIsLoading(true);
    }
    // else: cached content is already visible from initial state above —
    // leave isLoading as-is (false) and refresh silently underneath
    // rather than replacing it with a skeleton the user has already
    // gotten past.
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

      const freshCandidates = body.candidates ?? [];
      cachedCandidates = freshCandidates;
      setCandidates(freshCandidates);
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
    setCandidates((prev) => {
      const next = prev.filter((c) => c.id !== target.id);
      cachedCandidates = next;
      return next;
    });
    setExiting(null);

    try {
      const body = await apiCall;
      // Only recorded as undoable once the swipe is actually confirmed
      // saved server-side — if the API call below fails, there's nothing
      // real to undo yet, so lastSwiped stays whatever it was before.
      setLastSwiped({ targetId: target.id, direction });
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
    if (isUndoing || !lastSwiped) return;
    setIsUndoing(true);
    try {
      const res = await fetch("/api/discover/undo", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ targetId: lastSwiped.targetId }),
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
        setCandidates((prev) => {
          const next = [body.restoredProfile, ...prev];
          cachedCandidates = next;
          return next;
        });
      }
      // Only the single immediately-preceding swipe is ever undoable —
      // once used, there's nothing left to undo until another swipe
      // happens.
      setLastSwiped(null);
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

      setCandidates((prev) => {
        const next = prev.filter((c) => c.id !== composeFor.id);
        cachedCandidates = next;
        return next;
      });
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
            disabled={isUndoing || isSwiping || !lastSwiped}
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
