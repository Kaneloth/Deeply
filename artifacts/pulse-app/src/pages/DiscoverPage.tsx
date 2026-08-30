import { useState, useEffect, useCallback, useRef, memo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getUserIdFromToken } from "@/lib/tokenUtils";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ProfileCard, type ProfileCardData } from "@/components/ProfileCard";
import { X, Heart, MessageCircle, Star, RotateCcw, Mic } from "lucide-react";
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
    onReplyToVoiceQuestion,
  }: {
    candidate: Candidate;
    isTop: boolean;
    isExiting: boolean;
    exitDirection: SwipeDirection | null;
    stackIndex: number;
    onReplyToVoiceQuestion: (targetId: string, blob: Blob) => Promise<void>;
  }) {
    return (
      <motion.div
        className="absolute inset-0"
        style={{ zIndex: 10 - stackIndex }}
        // Do not animate a card into place. Even a subtle scale transform
        // causes native WebViews to re-composite the card while the photo is
        // decoding, which looks like a brief blink/vibration after mount.
        // The card must be completely still until the user swipes it.
        initial={false}
        animate={
          isExiting && exitDirection
            ? EXIT_VARIANTS[exitDirection]
            : { scale: 1, opacity: 1, x: 0, y: 0, rotate: 0 }
        }
        transition={isExiting ? { duration: 0.3, ease: "easeOut" } : { duration: 0 }}
      >
        <ProfileCard
          profile={candidate}
          active={isTop}
          enablePullReveal={isTop}
          canReplyToVoiceQuestion={isTop}
          onReplyToVoiceQuestion={(blob) => onReplyToVoiceQuestion(candidate.id, blob)}
        />
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
  //
  // onReplyToVoiceQuestion is intentionally NOT in this comparison —
  // it's recreated in the parent on every render, but it's a thin
  // wrapper that only closes over candidate.id (passed fresh as an arg,
  // not captured) and calls straight into a useCallback'd handler in
  // the parent, so an older closure behaves identically to a newer one.
  // Including it would defeat this whole memo, re-rendering every card
  // on every parent render regardless of whether anything it actually
  // depends on changed.
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
let cachedCandidatesUserId: string | null = null;

export default function DiscoverPage() {
  const { token } = useAuth();
  const userId = getUserIdFromToken(token);
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { setControls } = useDiscoverControls();
  const [candidates, setCandidates] = useState<Candidate[]>(
    cachedCandidatesUserId === userId ? (cachedCandidates ?? []) : [],
  );
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
  const [isLoading, setIsLoading] = useState(cachedCandidatesUserId !== userId || cachedCandidates === null);
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

  // "Try it" nudge for Voice Question — shown only while the account
  // genuinely has no active question of its own yet (never recorded,
  // or it expired), the admin hasn't turned it off entirely
  // (voice_question_nudge_enabled), and the admin-configured cooldown
  // has elapsed since it was last dismissed. The cooldown is real
  // localStorage persistence, not an in-memory flag — an earlier
  // version of this lived only in module-level memory, which meant
  // "dismissed" only ever lasted until the next full app restart.
  // Someone who's simply not interested in this feature would have had
  // to dismiss it every single fresh app open, forever. A genuine
  // multi-day cooldown (admin-configurable, see
  // voice_question_nudge_cooldown_days) is what actually makes this a
  // bounded, natural reminder cadence instead of a permanent nag.
  const [hasActiveVoiceQuestion, setHasActiveVoiceQuestion] = useState<boolean | null>(null);
  const [voiceQuestionNudgeEnabled, setVoiceQuestionNudgeEnabled] = useState(true);
  const [voiceQuestionNudgeCooldownDays, setVoiceQuestionNudgeCooldownDays] = useState(3);
  const [voiceQuestionNudgeDismissed, setVoiceQuestionNudgeDismissed] = useState(false);
  // Real bug found in production: voiceQuestionNudgeEnabled starts as
  // `true` (its default) and only flips to the admin's actual setting
  // once /api/app-settings resolves — a network round trip. In that
  // window, if hasActiveVoiceQuestion had already resolved to false,
  // the bubble would render using the DEFAULT value, then immediately
  // disappear the instant the real (disabled) value arrived — a
  // flash-then-vanish, even though the admin correctly turned it off.
  // This flag means the bubble never renders at all until the real
  // setting is actually known, same fix shape as the onboarding guard's
  // "don't render on a stale/default value" fix earlier this session.
  const [voiceQuestionNudgeSettingsLoaded, setVoiceQuestionNudgeSettingsLoaded] = useState(false);

  const voiceQuestionNudgeStorageKey = `deeply_voice_question_nudge_dismissed_at_${userId}`;

  const dismissVoiceQuestionNudge = () => {
    localStorage.setItem(voiceQuestionNudgeStorageKey, String(Date.now()));
    setVoiceQuestionNudgeDismissed(true);
  };

  useEffect(() => {
    fetch("/api/voice-question/me", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        setHasActiveVoiceQuestion(!!body?.question && !body.question.is_expired);
      })
      .catch(() => {
        // Silent — worst case the nudge just doesn't show this load,
        // not worth a toast over.
      });

    // /api/app-settings already returns every app_settings key
    // unfiltered (same endpoint VerificationSection and others already
    // use for their own admin-configurable values) — both the boolean
    // toggle and the numeric cooldown come from this one call, no
    // separate economy-config request needed.
    fetch("/api/app-settings", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!body) return;
        // Absent (an admin who's never touched this new setting) must
        // mean "on" — this nudge already existed and worked with no
        // admin control at all until now, so doing nothing should
        // preserve exactly the behavior that was already there.
        setVoiceQuestionNudgeEnabled(body.voice_question_nudge_enabled !== false);
        if (typeof body.voice_question_nudge_cooldown_days === "number") {
          setVoiceQuestionNudgeCooldownDays(body.voice_question_nudge_cooldown_days);
        }

        const dismissedAtRaw = localStorage.getItem(voiceQuestionNudgeStorageKey);
        const cooldownDays =
          typeof body.voice_question_nudge_cooldown_days === "number" ? body.voice_question_nudge_cooldown_days : 3;
        if (dismissedAtRaw) {
          const dismissedAt = Number(dismissedAtRaw);
          const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
          setVoiceQuestionNudgeDismissed(!Number.isNaN(dismissedAt) && Date.now() - dismissedAt < cooldownMs);
        }
      })
      .catch(() => {
        // Silent — same reasoning as above; worst case the nudge just
        // uses its defaults (enabled, 3-day cooldown) for this load.
      })
      .finally(() => {
        // In .finally, not inside .then — must run on the success path
        // (including the `if (!body) return;` early exit above) AND on
        // a genuine fetch failure, so this can never get stuck at
        // false and permanently hide the nudge for the rest of the
        // session over one bad network blip.
        setVoiceQuestionNudgeSettingsLoaded(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

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
      cachedCandidatesUserId = userId;
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
      await refreshSparksBadge();
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

  const fetchQueue = useCallback(async (force = false) => {
    const isFirstLoadOfSession = !hasShownDiscoverScanWave;
    const hadCachedContent = cachedCandidatesUserId === userId && cachedCandidates !== null;
    if (!force && hadCachedContent) {
      setCandidates(cachedCandidates ?? []);
      setIsLoading(false);
      return;
    }
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
      cachedCandidatesUserId = userId;
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
  }, [token, toast, userId]);

  useEffect(() => {
    fetchQueue();
    fetchReshuffleStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

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

  // Uploads via the same shared endpoint the old audio prompts feature
  // used (still generic — it just uploads to storage and returns a
  // URL), then the actual reply call. Mirrors handleDecision above:
  // toast on error, refresh Sparks and remove the candidate from the
  // stack on success, show the match celebration if this reply
  // completed a mutual match. A voice reply is stored server-side as an
  // ordinary "like" swipe (see discover.ts), so removing the candidate
  // here keeps the frontend consistent with what the backend now
  // actually excludes them for — same reasoning as a normal swipe.
  //
  // setLastSwiped below makes Undo available afterward, exactly like a
  // normal swipe — /discover/undo is fully generic (it just finds "the
  // last swipe by this user" and doesn't care whether it came from a
  // like, a super like, or a voice reply), and undoing was never a
  // refund in this app anyway — it charges cost_undo_swipe again, same
  // as withdrawing an invite. If this reply already completed an
  // immediate mutual match, the backend's existing "can't undo a swipe
  // that already resulted in a match" guard applies exactly as it
  // already does for a normal swipe — no special-casing needed here.
  //
  // Deliberately re-throws after toasting: ProfileCard's recording
  // modal expects this promise to reject on failure so it can keep the
  // recording visible for a retry, but it doesn't show its own error
  // message — this is what surfaces one.
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
      setLastSwiped({ targetId, direction: "like" });

      const target = candidates.find((c) => c.id === targetId);
      setCandidates((prev) => {
        const next = prev.filter((c) => c.id !== targetId);
        cachedCandidates = next;
        return next;
      });

      if (replyBody.matched && target) {
        setMatchCelebration({ name: target.name, matchId: replyBody.matchId, photoUrl: target.photo_url ?? undefined });
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

      const sentTo = composeFor;
      setCandidates((prev) => {
        const next = prev.filter((c) => c.id !== sentTo.id);
        cachedCandidates = next;
        return next;
      });
      setComposeFor(null);
      setMessageText("");

      // This is now an invite with an attached message, not an
      // immediate match — see discover.ts's message-request handler for
      // the full reasoning. matched only comes back true in the rare
      // crossed-invites case (the target had already invited this user
      // first), which is a genuine mutual match right now — same
      // celebration flow as a normal match from a regular swipe.
      // Otherwise, just confirm the invite was sent; it now shows up in
      // Invites (Sent) until the other person accepts or declines it.
      if (body.matched && body.matchId) {
        setMatchCelebration({ name: sentTo.name, matchId: body.matchId, photoUrl: sentTo.photo_url ?? undefined });
      } else {
        toast({
          title: "Invite sent",
          description: `${sentTo.name} will see your message if they accept your invite.`,
        });
      }
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
      {voiceQuestionNudgeSettingsLoaded && voiceQuestionNudgeEnabled && hasActiveVoiceQuestion === false && !voiceQuestionNudgeDismissed && visibleCards.length > 0 && (
        <div className="flex items-center gap-3 bg-gradient-accent rounded-2xl p-3 mb-2 text-white shadow-lg shrink-0">
          <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center shrink-0">
            <Mic size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold leading-tight">Try a Voice Question</p>
            <p className="text-xs text-white/80 leading-tight">Ask something — replies count as invites</p>
          </div>
          <button
            onClick={() => setLocation("/profile")}
            className="px-3 py-1.5 rounded-full bg-white text-primary text-xs font-semibold shrink-0"
          >
            Try it
          </button>
          <button onClick={dismissVoiceQuestionNudge} className="text-white/70 shrink-0">
            <X size={16} />
          </button>
        </div>
      )}
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
            <Button variant="outline" className="mt-6" onClick={() => fetchQueue(true)}>
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
                onReplyToVoiceQuestion={handleReplyToVoiceQuestion}
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
