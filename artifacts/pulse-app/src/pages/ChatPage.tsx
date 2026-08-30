import { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { getUserIdFromToken } from "@/lib/tokenUtils";
import { useSparks } from "@/contexts/SparksContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Send, Undo2, Eye, CheckCheck, Smile, ImagePlus, X, MoreVertical, UserX, Flag, Copy, Trash2, Reply, Loader2, Lock, Clock, HeartCrack } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { EmojiPicker } from "@/components/EmojiPicker";
import ReactionPicker from "emoji-picker-react";
import { ReportBlockModal } from "@/components/ReportBlockModal";
import { MediaPicker } from "@/components/MediaPicker";
import { evictMatchFromCache } from "./MatchesPage";
import { getCachedMatchDetail, updateMatchDetailCache, removeMatchDetailCache } from "@/lib/matchDetailCache";
import { readPersistentCache, writePersistentCache, registerCacheResetter } from "@/lib/persistentCache";

interface MatchedUser {
  id: string;
  name: string;
  photo_url: string | null;
}

// Chat-unlock status — see the backend's chat-unlock-helper.ts for the
// full state machine this reflects. "locked": neither side has sent a
// message yet. "awaiting_reply": one side has paid their half and is
// waiting on the other, within the 48h window. "unlocked": fully open,
// free to keep chatting. "missed_connection": the 48h window passed
// with no reply — the original sender was refunded, and the recipient
// can still revive it (at full cost) by replying anyway.
type ChatUnlockStatus = "locked" | "awaiting_reply" | "unlocked" | "missed_connection";

interface Match {
  id: string;
  matched_user: MatchedUser | null;
  message_count: number;
  created_at: string;
  chat_unlock_status?: ChatUnlockStatus;
  chat_unlock_initiator_id?: string | null;
  chat_unlock_initiated_at?: string | null;
}

interface Reaction {
  emoji: string;
  count: number;
  reactedByMe: boolean;
}

interface ReplyPreview {
  id: string;
  content: string;
  sender_id: string;
  message_type: string;
  is_unsent: boolean;
}

interface Message {
  id: string;
  // Keep the rendered bubble's identity stable while an optimistic message
  // changes from its temporary id to the server id. This prevents native
  // WebViews from remounting stickers/GIFs immediately after sending.
  // Purely a client-side concept — the backend never returns this field,
  // which is exactly why fetchMessages below has to explicitly re-attach
  // it after every poll, not just after the initial send reconciliation.
  renderKey?: string;
  match_id: string;
  sender_id: string;
  content: string;
  message_type: "text" | "sticker" | "gif";
  media_url: string | null;
  is_read: boolean;
  is_unsent: boolean;
  sent_at: string;
  reactions: Reaction[];
  reply_to: ReplyPreview | null;
}

// Local to this page (unlike the shared match-detail cache in
// matchDetailCache.ts) — only ChatPage needs cached message history.
// Same motivation: opening a chat you've already been in before shows
// the last-known messages instantly instead of starting from a
// genuinely empty list while the first fetch (subject to the same
// backend retry delays as everything else) resolves. The existing
// merge-not-replace logic in fetchMessages below already protects
// against a lagged poll dropping a just-confirmed real message — this
// only changes what's shown before the very first fetch of a session
// completes, not the ongoing polling behavior.
const MESSAGES_CACHE_KEY = "chat_messages_cache";
let cachedMessagesByMatch: Record<string, Message[]> =
  readPersistentCache<Record<string, Message[]>>(MESSAGES_CACHE_KEY) ?? {};
registerCacheResetter(() => {
  cachedMessagesByMatch = {};
});
function updateMessagesCache(matchId: string, messages: Message[]) {
  cachedMessagesByMatch = { ...cachedMessagesByMatch, [matchId]: messages };
  writePersistentCache(MESSAGES_CACHE_KEY, cachedMessagesByMatch);
}
function removeMessagesCache(matchId: string) {
  if (!(matchId in cachedMessagesByMatch)) return;
  const next = { ...cachedMessagesByMatch };
  delete next[matchId];
  cachedMessagesByMatch = next;
  writePersistentCache(MESSAGES_CACHE_KEY, cachedMessagesByMatch);
}

// Raw characters for the compact row we build ourselves (exact-fit, no
// wasted space).
const QUICK_REACT_EMOJIS = ["❤️", "😂", "😮", "😢", "👍", "🔥"];

const CHAT_UNLOCK_EXPIRY_MS = 48 * 60 * 60 * 1000;

// 24-hour, no leading zero on the hour (0:05, 9:41, 23:59) — matches
// what was asked for specifically, rather than a locale-dependent
// Intl.DateTimeFormat that could zero-pad or use 12-hour time depending
// on the device's locale settings.
function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  const minutes = d.getMinutes().toString().padStart(2, "0");
  return `${d.getHours()}:${minutes}`;
}

function isDifferentLocalDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() !== db.getFullYear() || da.getMonth() !== db.getMonth() || da.getDate() !== db.getDate();
}

// WhatsApp-style: "Today" / "Yesterday" / a full date, comparing local
// calendar days (not raw UTC), since that's what "today" actually means
// to the person looking at their phone right now.
function formatDateSeparator(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? { month: "long", day: "numeric" } : { month: "long", day: "numeric", year: "numeric" });
}

// Hh:Mm:Ss — a live, functional countdown rather than any kind of
// repeated reminder. Deliberately always shows all three units (e.g.
// "0:04:12", not "4:12") so the display doesn't visually restructure
// itself as time passes.
function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

// One-time-ever (per user, per action type) educational toasts — shown
// exactly once the first time each specific chat-unlock charge happens,
// never again after that, per the explicit design direction: no
// repeated reminders that the user is being charged. Same localStorage-
// flag pattern already used elsewhere in this app (e.g. SearchPage's
// invite-quota-cost notice).
function hasSeenUnlockNotice(userId: string | null, action: string): boolean {
  if (!userId) return true; // fail toward NOT showing rather than crashing on a null id
  return !!localStorage.getItem(`deeply_seen_chat_unlock_${action}_${userId}`);
}
function markSeenUnlockNotice(userId: string | null, action: string): void {
  if (!userId) return;
  localStorage.setItem(`deeply_seen_chat_unlock_${action}_${userId}`, "1");
}

export default function ChatPage() {
  const params = useParams();
  const matchId = params.matchId || "";
  const { token } = useAuth();
  const userId = getUserIdFromToken(token);
  const { refresh: refreshSparksBadge, suppressThresholdToast } = useSparks();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [match, setMatch] = useState<Match | null>(() => getCachedMatchDetail<Match>(matchId));
  const [matchLoading, setMatchLoading] = useState(() => getCachedMatchDetail<Match>(matchId) === null);
  const [messages, setMessages] = useState<Message[]>(() => cachedMessagesByMatch[matchId] ?? []);
  const [input, setInput] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showMediaPicker, setShowMediaPicker] = useState(false);
  const [reactingToMessageId, setReactingToMessageId] = useState<string | null>(null);
  const [showFullEmojiPicker, setShowFullEmojiPicker] = useState(false);
  // Chat manages its own internal scroll container (scrollRef below),
  // separate from the shared <main> the app shell scrolls for most
  // other pages — a message list needs to stay pinned to the bottom on
  // new messages, with its own header and input bar outside the
  // scrollable area, which the shared container isn't set up for. That
  // means chat can't use the shared pull-to-refresh registration
  // (usePullToRefresh/PullToRefreshContext) the other pages use — that
  // mechanism checks the shared <main>'s scroll position, which stays
  // at 0 here regardless of where the user's actually scrolled within
  // messages, since <main> itself doesn't scroll on this page. This is
  // a small local implementation of the same gesture, scoped correctly
  // to scrollRef instead.
  const [pullDistance, setPullDistance] = useState(0);
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [isBlocking, setIsBlocking] = useState(false);
  const [receiptsUnlocked, setReceiptsUnlocked] = useState(false);
  const [isUnlockingReceipts, setIsUnlockingReceipts] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Live hours:minutes:seconds remaining before an 'awaiting_reply'
  // match's unlock attempt expires and auto-refunds. Recomputed once a
  // second, purely client-side, from chat_unlock_initiated_at — not
  // polled from the server, since a ticking clock doesn't need a network
  // round trip to advance. null whenever the match isn't currently in
  // 'awaiting_reply' at all.
  const [countdownMs, setCountdownMs] = useState<number | null>(null);

  // Long-press message action menu (React / Copy / Delete for me / Unsend)
  const [selectedMsgId, setSelectedMsgId] = useState<string | null>(null);
  const [menuOpenUp, setMenuOpenUp] = useState(false);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longTriggered = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Swipe-to-reply
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  // Tracks each GIF's real aspect ratio once it actually loads, keyed by
  // media_url (stable across the optimistic-send id transition — see
  // the usage site below for why msg.id specifically wouldn't work here).
  // Before a ratio is known, the container falls back to a reasonable
  // guess (4:3) purely to reserve space and avoid the original
  // load-then-jump bounce — but a fixed guess doesn't match every GIF's
  // real proportions (Giphy/Tenor GIFs are often closer to square, or
  // even portrait), and object-contain letterboxing a mismatched ratio
  // can visually read as the content being cropped rather than cleanly
  // fitted. Capturing the real ratio on load and resizing the container
  // to match exactly eliminates that mismatch — this happens via a
  // plain state update, not a key change, so it never causes a remount.
  const [gifAspectRatios, setGifAspectRatios] = useState<Record<string, number>>({});
  const [swipingMessageId, setSwipingMessageId] = useState<string | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const isSwipeRef = useRef(false);
  const SWIPE_TRIGGER = 50;
  const SWIPE_MAX = 70;

  const handleBubbleTouchStart = (msg: Message, e: React.TouchEvent | React.MouseEvent) => {
    const point = "touches" in e ? e.touches[0] : e;
    touchStartX.current = point.clientX;
    touchStartY.current = point.clientY;
    isSwipeRef.current = false;
    startLongPress(msg.id, e);
  };

  const handleBubbleTouchMove = (msg: Message, e: React.TouchEvent | React.MouseEvent) => {
    const point = "touches" in e ? e.touches[0] : e;
    const dx = point.clientX - touchStartX.current;
    const dy = point.clientY - touchStartY.current;

    // Only commit to a swipe once horizontal movement clearly dominates
    // vertical — avoids hijacking a normal vertical scroll of the chat.
    if (!isSwipeRef.current && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      isSwipeRef.current = true;
      cancelLongPress(); // this is a swipe, not a long-press
    }

    if (isSwipeRef.current && dx > 0) {
      setSwipingMessageId(msg.id);
      setSwipeOffset(Math.min(dx, SWIPE_MAX));
    }
  };

  const handleBubbleTouchEnd = (msg: Message) => {
    cancelLongPress();
    if (isSwipeRef.current && swipeOffset >= SWIPE_TRIGGER && !msg.is_unsent) {
      setReplyingTo(msg);
    }
    setSwipingMessageId(null);
    setSwipeOffset(0);
    isSwipeRef.current = false;
  };

  const scrollToMessage = (messageId: string) => {
    const el = document.getElementById(`msg-${messageId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedMessageId(messageId);
    setTimeout(() => setHighlightedMessageId(null), 1500);
  };

  useEffect(() => {
    if (!selectedMsgId) return;
    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setSelectedMsgId(null);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("touchstart", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("touchstart", handleOutsideClick);
    };
  }, [selectedMsgId]);

  const decideMenuDirection = (target: HTMLElement | null | undefined) => {
    if (!target) return;
    const rect = target.getBoundingClientRect();
    // window.innerHeight includes the space behind the fixed input bar,
    // which isn't actually available to the menu — measuring against the
    // real scrollable container's own bottom edge instead is what
    // correctly accounts for that.
    const containerBottom = scrollRef.current?.getBoundingClientRect().bottom ?? window.innerHeight;
    const spaceBelow = containerBottom - rect.bottom;
    setMenuOpenUp(spaceBelow < 180);
  };

  const startLongPress = (messageId: string, e: React.MouseEvent | React.TouchEvent) => {
    longTriggered.current = false;
    const target = e.currentTarget as HTMLElement;
    longPressRef.current = setTimeout(() => {
      longTriggered.current = true;
      decideMenuDirection(target);
      setSelectedMsgId(messageId);
    }, 400);
  };
  const cancelLongPress = () => {
    if (longPressRef.current) clearTimeout(longPressRef.current);
  };

  const handleCopy = (msg: Message) => {
    navigator.clipboard
      ?.writeText(msg.content)
      .then(() => toast({ title: "Copied" }))
      .catch(() => {});
    setSelectedMsgId(null);
  };

  const handleDeleteForMe = async (messageId: string) => {
    setSelectedMsgId(null);
    // Optimistic — removed from view immediately regardless of network
    // outcome, since this only ever affects this device's view of the
    // conversation, never the other person's.
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
    try {
      const res = await fetch(`/api/messages/${messageId}/hide`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error();
    } catch {
      // Non-fatal from the user's perspective — worst case it reappears
      // on next reload. Not worth an error toast for a "delete for me"
      // action that already visually succeeded.
    }
  };

  const isMyMsg = (senderId: string) => match?.matched_user?.id !== senderId;

  const fetchReceiptsStatus = useCallback(async () => {
    if (!matchId) return;
    try {
      const res = await fetch(`/api/matches/${matchId}/read-receipts/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const body = await res.json();
      setReceiptsUnlocked(!!body.unlocked);
    } catch {
      // Silent — non-critical.
    }
  }, [matchId, token]);

  const handleUnlockReceipts = async () => {
    setIsUnlockingReceipts(true);
    try {
      const res = await fetch(`/api/matches/${matchId}/read-receipts/unlock`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 402) {
        toast({
          title: "You're out of Sparks",
          description: "Recharge now or wait for your next monthly grant to unlock read receipts.",
          variant: "destructive",
        });
        return;
      }

      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to unlock read receipts");
      // No fetchMessages() here — unlocking receipts doesn't change any
      // message's own data, it only reveals read/delivered indicators
      // the render logic already computes from receiptsUnlocked plus
      // each message's existing is_read value (already present from
      // regular polling). A fetch here would be redundant at best, and
      // at worst risks the same read-after-write lag traced elsewhere
      // in this app, showing stale data right after a successful action.
      setReceiptsUnlocked(true);
      refreshSparksBadge();
      toast({ title: "Read receipts unlocked", description: "You'll now see when your messages are read." });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to unlock read receipts.",
        variant: "destructive",
      });
    } finally {
      setIsUnlockingReceipts(false);
    }
  };

  const fetchMatch = useCallback(async () => {
    if (!matchId) return;
    const cached = getCachedMatchDetail<Match>(matchId);
    // Only force the loading state when there's genuinely nothing to
    // show yet — see matchDetailCache.ts for the full reasoning.
    if (!cached) setMatchLoading(true);
    try {
      const res = await fetch(`/api/matches/${matchId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 404) {
        // Authoritative signal that this specific match is gone — same
        // fix as MatchDetailPage.tsx's 404 handling. Previously this
        // just fell through to the generic catch below, which showed a
        // toast but never told MatchesPage's cache the match was
        // actually deleted (as opposed to merely missing from one
        // fetch) — so it kept reappearing there. Also navigates back to
        // Matches rather than stranding the person on this dead-end
        // "Match not found." screen with no way forward.
        evictMatchFromCache(matchId);
        removeMatchDetailCache(matchId);
        removeMessagesCache(matchId);
        toast({
          title: "Match no longer available",
          description: "This match has been removed.",
        });
        setLocation("/matches");
        return;
      }

      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Match not found");
      setMatch(body);
      updateMatchDetailCache(matchId, body);
    } catch (err) {
      // Same reasoning as MatchDetailPage.tsx — a cached version already
      // on screen means a transient failure of this one background
      // refresh isn't worth interrupting the person over.
      if (!cached) {
        toast({
          title: "Error",
          description: err instanceof Error ? err.message : "Failed to load match.",
          variant: "destructive",
        });
      }
    } finally {
      setMatchLoading(false);
    }
  }, [matchId, token, toast, setLocation]);

  // Counts sends currently in flight (optimistic bubble shown, POST not
  // yet resolved). While non-zero, fetchMessages skips entirely — a full
  // server-list replace landing in that narrow window would wipe out the
  // just-sent bubble until the NEXT poll tick finally includes the
  // now-saved message, which is exactly the "message disappears for a
  // few seconds after sending" bug this prevents. A ref (not state) so
  // the check always sees the current value even inside the setInterval
  // closure, without needing fetchMessages to be recreated on every
  // change.
  const pendingSendCountRef = useRef(0);

  const fetchMessages = useCallback(async () => {
    if (!matchId || pendingSendCountRef.current > 0) return;
    try {
      const res = await fetch(`/api/matches/${matchId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load messages");
      // Merge, not replace. This started out only preserving renderKey
      // (fixing a real remount/bounce issue — see comment history), but
      // a screen recording caught something more serious: a message that
      // had ALREADY been successfully sent and reconciled (real server
      // id, no error, no toast) completely vanished from view for ~8
      // seconds across multiple poll cycles before finally reappearing.
      // Root cause: this is the same Supabase read-after-write
      // consistency lag traced and fixed elsewhere in this app's backend
      // (e.g. PUT /profile/me's PGRST116 retries) — a just-written row
      // isn't always immediately visible to a SEPARATE subsequent read.
      // The message was genuinely saved the whole time; this particular
      // poll's GET request just hadn't caught up to see it yet. Blindly
      // trusting body as the complete, authoritative list (even with
      // renderKey preserved) meant that gap silently deleted a real,
      // successfully-sent message from the screen. Now: any message
      // already reconciled to a real (non-"temp-") id that this specific
      // poll's response doesn't include gets kept, not dropped — we
      // already know it's real (its own send already confirmed that),
      // so a poll simply not seeing it yet is never grounds to remove it.
      setMessages((prev) => {
        const renderKeyById = new Map<string, string>();
        for (const m of prev) {
          if (m.renderKey) renderKeyById.set(m.id, m.renderKey);
        }
        const serverMessages: Message[] = (body ?? []).map((m: Message) => ({
          ...m,
          renderKey: renderKeyById.get(m.id) ?? m.renderKey,
        }));

        const serverIds = new Set(serverMessages.map((m) => m.id));
        // A GET can have started before a send incremented
        // pendingSendCountRef. In that case the response may arrive after
        // the optimistic temp message was added, even though the guard at
        // the start of fetchMessages allowed the request through. Do not
        // let that stale response erase in-flight sends. Once the POST
        // resolves, the temp id is replaced by the real id (or removed on
        // failure), so this only protects genuinely pending messages.
        const missingLocalMessages = prev.filter(
          (m) =>
            !serverIds.has(m.id) &&
            (pendingSendCountRef.current > 0 || !m.id.startsWith("temp-")),
        );

        const merged = [...serverMessages, ...missingLocalMessages];
        // Keep chronological order — the server response is normally
        // already sorted by sent_at, but a locally-retained message
        // appended at the end could be out of place if it was actually
        // sent before something the server response did include.
        merged.sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
        // Cache the MERGED result, not the raw server body — this is
        // the actual best-known state (server data plus anything
        // locally retained via the merge-not-replace protection above),
        // so a future cache read reflects the same safety net rather
        // than a potentially incomplete raw response.
        updateMessagesCache(matchId, merged);
        return merged;
      });
    } catch {
      // Silent — polling failures shouldn't spam the user with toasts.
    }
  }, [matchId, token]);

  useEffect(() => {
    fetchMatch();
    fetchReceiptsStatus();
    // fetchMatch/fetchReceiptsStatus depend on [matchId, token] internally
    // — depending on matchId here (not the function references themselves)
    // avoids re-running this on every auth token refresh, which happens
    // periodically regardless of anything the user does and was causing
    // the whole chat to visibly refetch/flash on that same cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  useEffect(() => {
    fetchMessages();
    const interval = setInterval(fetchMessages, 3000);
    return () => clearInterval(interval);
    // Same reasoning as above — matchId is the only thing that should
    // restart this poll, not a token refresh recreating fetchMessages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  // Also re-fetches the match itself on the same 3s cadence as messages
  // — chat_unlock_status can change from an action the OTHER person
  // takes (they reply, or the 48h window lapses while they're the one
  // who happens to open the app first), and this page has no other
  // mechanism that would ever learn about that short of the person
  // manually leaving and re-opening the chat. Deliberately a separate,
  // lighter-weight poll rather than folding this into fetchMatch (which
  // also flips matchLoading, which would re-show the loading skeleton
  // every 3 seconds).
  useEffect(() => {
    if (!matchId) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/matches/${matchId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const body = await res.json();
        setMatch(body);
      } catch {
        // Silent — same reasoning as the messages poll above.
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [matchId, token]);

  // Ticks the live countdown once a second while — and only while — the
  // match is actually 'awaiting_reply'. Recomputed from scratch each
  // tick directly against chat_unlock_initiated_at, rather than simply
  // decrementing a counter, so it can never drift out of sync with the
  // server's own understanding of when the window actually started.
  useEffect(() => {
    if (match?.chat_unlock_status !== "awaiting_reply" || !match.chat_unlock_initiated_at) {
      setCountdownMs(null);
      return;
    }
    const initiatedAt = new Date(match.chat_unlock_initiated_at).getTime();
    const tick = () => setCountdownMs(Math.max(0, initiatedAt + CHAT_UNLOCK_EXPIRY_MS - Date.now()));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [match?.chat_unlock_status, match?.chat_unlock_initiated_at]);

  // Always the current fetchMessages (fresh token included) — the
  // gesture effect below intentionally only attaches its listeners
  // once, so it reads this ref rather than closing over fetchMessages
  // directly, which would otherwise go stale after any background token
  // refresh (fetchMessages depends on token, so its identity changes
  // whenever that happens, even though matchId hasn't).
  const fetchMessagesRef = useRef(fetchMessages);
  fetchMessagesRef.current = fetchMessages;

  // Pull-to-refresh, scoped to this page's own scrollRef — see the
  // comment above the pullDistance/isPullRefreshing state for why this
  // is separate from the shared usePullToRefresh mechanism. Mirrors
  // that same gesture feel (damping, threshold) for consistency.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const PULL_THRESHOLD_PX = 70;
    const MAX_PULL_PX = 100;
    const PULL_DAMPING = 0.5;

    let touchStartY: number | null = null;
    let isPulling = false;
    let pullDistanceLocal = 0;
    let isRefreshingLocal = false;

    const onTouchStart = (e: TouchEvent) => {
      if (isRefreshingLocal) return;
      if (el.scrollTop > 0) return;
      touchStartY = e.touches[0].clientY;
      isPulling = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!isPulling || touchStartY === null) return;
      const delta = e.touches[0].clientY - touchStartY;
      if (delta <= 0) {
        pullDistanceLocal = 0;
        setPullDistance(0);
        return;
      }
      e.preventDefault();
      const damped = Math.min(delta * PULL_DAMPING, MAX_PULL_PX);
      pullDistanceLocal = damped;
      setPullDistance(damped);
    };

    const onTouchEnd = async () => {
      if (!isPulling) return;
      isPulling = false;
      touchStartY = null;
      const finalDistance = pullDistanceLocal;
      pullDistanceLocal = 0;
      setPullDistance(0);

      if (finalDistance >= PULL_THRESHOLD_PX) {
        isRefreshingLocal = true;
        setIsPullRefreshing(true);
        try {
          await fetchMessagesRef.current();
        } finally {
          isRefreshingLocal = false;
          setIsPullRefreshing(false);
        }
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
    // Intentionally empty deps — attaches once to a stable DOM node.
    // Always calls the LATEST fetchMessages via fetchMessagesRef, not a
    // stale closure, so this doesn't need to re-run on every token
    // refresh the way the poll effect above does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // useLayoutEffect, not useEffect — this must run BEFORE the browser
  // paints, not after. With useEffect, the very first render (empty ->
  // full message list) paints starting from the top of the container
  // (scrollTop defaults to 0), then this effect jumps to the bottom a
  // frame later — meaning whoever's watching briefly sees the top of the
  // conversation before it snaps down. Depending on how many messages
  // fit in the visible area before that jump, that reads as exactly "the
  // first couple of messages bounce." useLayoutEffect runs synchronously
  // after the DOM update but before the browser paints anything, so the
  // scroll position is already correct by the time the user sees
  // anything at all.
  useLayoutEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "auto" });
    }
  }, [messages.length]);

  // Fires the one-time (per user, ever) educational toast for a given
  // chat-unlock action, then immediately marks it seen so it never
  // fires again for this user regardless of how many more matches they
  // go on to unlock/revive the same way. Deliberately separate from the
  // sparks_charged number a specific match session shows in-line
  // (there isn't one here) — this toast exists purely to teach the
  // MECHANIC once, not to report every individual transaction.
  const maybeShowUnlockNotice = (action: string, sparksCharged: number) => {
    if (hasSeenUnlockNotice(userId, action)) return;
    markSeenUnlockNotice(userId, action);
    const copy: Record<string, { title: string; description: string }> = {
      initiated: {
        title: `${sparksCharged} Sparks — your half`,
        description: "Starting a new conversation costs half the unlock fee. Your match pays the other half when they reply — or you're refunded if they don't within 48 hours.",
      },
      unlocked: {
        title: `${sparksCharged} Sparks — your half`,
        description: "Replying to unlock a new conversation costs half the fee. This chat is now fully open — free to keep talking.",
      },
      revived: {
        title: `${sparksCharged} Sparks — full cost`,
        description: "Replying after the 48-hour window means covering the full unlock fee alone. The chat is now open either way.",
      },
    };
    const entry = copy[action];
    // Explicit, longer duration for this specific toast only — it's
    // explaining an entire mechanic in a full sentence, not confirming a
    // quick action like "Copied", so the default toast duration (tuned
    // for brief confirmations) wasn't giving anyone enough time to
    // actually read it before it disappeared.
    if (entry) {
      // This spend can itself cross a low-Sparks warning threshold —
      // when it does, refreshSparksBadge() (called right after this)
      // fires SparksContext's own threshold toast almost immediately
      // afterward, evicting this one from the single-toast slot before
      // anyone can read it (confirmed happening in production). This
      // toast already reports the Sparks spent as part of its own
      // message, so suppressing the more generic warning for a moment
      // costs nothing — it'll still show up reliably on the next
      // balance check if the balance is still low then.
      suppressThresholdToast();
      toast({ ...entry, duration: 12000 });
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = input.trim();
    if (!content || !matchId || isSending) return;

    setIsSending(true);
    setInput("");
    const replyId = replyingTo?.id;
    const replyPreview = replyingTo;
    setReplyingTo(null);

    // Appears instantly, before the network round trip even starts —
    // this is what sending a message should feel like. Previously this
    // waited on the POST, then threw its own response away and did a
    // second full round trip (fetchMessages) just to see the message it
    // already had the data for. Reconciled with the real, server-saved
    // message below once the request actually resolves; rolled back
    // entirely if it fails.
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimisticMessage: Message = {
      id: tempId,
      renderKey: tempId,
      match_id: matchId,
      sender_id: userId ?? tempId,
      content,
      message_type: "text",
      media_url: null,
      is_read: false,
      is_unsent: false,
      sent_at: new Date().toISOString(),
      reactions: [],
      reply_to: replyPreview
        ? {
            id: replyPreview.id,
            content: replyPreview.content,
            sender_id: replyPreview.sender_id,
            message_type: replyPreview.message_type,
            is_unsent: replyPreview.is_unsent,
          }
        : null,
    };
    setMessages((prev) => [...prev, optimisticMessage]);
    pendingSendCountRef.current += 1;

    try {
      const res = await fetch(`/api/matches/${matchId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ content, reply_to_message_id: replyId }),
      });

      if (res.status === 402) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setInput(content);
        setReplyingTo(replyPreview);
        toast({
          title: "You're out of Sparks",
          description: "Recharge now or wait for your next monthly grant to keep messaging.",
          variant: "destructive",
        });
        return;
      }

      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to send message");
      // The POST response already IS the fully-formed saved message
      // (id, sent_at, reactions, reply_to — everything the list endpoint
      // would return for it) — swap the optimistic bubble for it
      // directly rather than re-fetching the whole conversation. Keep
      // renderKey stable across this swap (see the Message interface
      // comment) so the list's React key never changes here, even
      // though `id` correctly updates to the real server id.
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...(body as Message), renderKey: m.renderKey ?? tempId } : m)),
      );

      // A chat-unlock state transition happened as a side effect of this
      // send — refresh the match itself so chat_unlock_status (and the
      // countdown it drives) reflects it immediately, rather than
      // waiting up to 3s for the next background poll to notice.
      if (body.chat_unlock_action && body.chat_unlock_action !== "none") {
        maybeShowUnlockNotice(body.chat_unlock_action, body.sparks_charged ?? 0);
        fetchMatch();
      }
      if (body.sparks_balance !== undefined) {
        refreshSparksBadge();
      }
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setInput(content); // restore what they typed so they don't lose it
      setReplyingTo(replyPreview);
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to send message.",
        variant: "destructive",
      });
    } finally {
      pendingSendCountRef.current -= 1;
      setIsSending(false);
    }
  };

  const sendMediaMessage = async (messageType: "sticker" | "gif", content: string, mediaUrl?: string) => {
    if (!matchId || isSending) return;
    setIsSending(true);
    setShowMediaPicker(false);

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimisticMessage: Message = {
      id: tempId,
      renderKey: tempId,
      match_id: matchId,
      sender_id: userId ?? tempId,
      content,
      message_type: messageType,
      media_url: mediaUrl ?? null,
      is_read: false,
      is_unsent: false,
      sent_at: new Date().toISOString(),
      reactions: [],
      reply_to: null,
    };
    setMessages((prev) => [...prev, optimisticMessage]);
    pendingSendCountRef.current += 1;

    try {
      const res = await fetch(`/api/matches/${matchId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ content, message_type: messageType, media_url: mediaUrl }),
      });

      if (res.status === 402) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        toast({
          title: "You're out of Sparks",
          description: "Recharge now or wait for your next monthly grant to keep messaging.",
          variant: "destructive",
        });
        return;
      }

      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to send");
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...(body as Message), renderKey: m.renderKey ?? tempId } : m)),
      );
      if (body.chat_unlock_action && body.chat_unlock_action !== "none") {
        maybeShowUnlockNotice(body.chat_unlock_action, body.sparks_charged ?? 0);
        fetchMatch();
      }
      if (body.sparks_balance !== undefined) {
        refreshSparksBadge();
      }
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to send.",
        variant: "destructive",
      });
    } finally {
      pendingSendCountRef.current -= 1;
      setIsSending(false);
    }
  };

  const handleReact = async (messageId: string, emoji: string) => {
    setReactingToMessageId(null);
    // Optimistic update so it feels instant.
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m;
        const existing = m.reactions.find((r) => r.emoji === emoji);
        let reactions: Reaction[];
        if (existing) {
          reactions = existing.reactedByMe
            ? m.reactions
                .map((r) => (r.emoji === emoji ? { ...r, count: r.count - 1, reactedByMe: false } : r))
                .filter((r) => r.count > 0)
            : m.reactions.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1, reactedByMe: true } : r));
        } else {
          reactions = [...m.reactions, { emoji, count: 1, reactedByMe: true }];
        }
        return { ...m, reactions };
      }),
    );

    try {
      const res = await fetch(`/api/messages/${messageId}/react`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ emoji }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to react");
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, reactions: body.reactions } : m)));
    } catch {
      await fetchMessages(); // reconcile with server state on failure
    }
  };

  const handleBlock = async () => {
    if (!match?.matched_user?.id || isBlocking) return;
    setIsBlocking(true);
    try {
      const res = await fetch("/api/blocks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ blockedUserId: match.matched_user.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to block");
      }
      toast({ title: `${match.matched_user.name} has been blocked` });
      setLocation("/matches");
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to block user.",
        variant: "destructive",
      });
    } finally {
      setIsBlocking(false);
    }
  };

  const handleUnsend = async (messageId: string) => {
    try {
      const res = await fetch(`/api/messages/${messageId}/unsend`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 410) {
        toast({
          title: "Too late",
          description: "The unsend window for this message has passed.",
          variant: "destructive",
        });
        return;
      }

      if (res.status === 402) {
        toast({
          title: "You're out of Sparks",
          description: "Recharge now or wait for your next monthly grant to unsend messages.",
          variant: "destructive",
        });
        return;
      }

      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to unsend message");
      // Update locally rather than await fetchMessages() — the same
      // read-after-write lag traced repeatedly elsewhere in this app
      // means a fresh GET immediately after this POST can still return
      // the message's pre-unsend content, since Postgres hasn't
      // guaranteed a separate subsequent read sees this exact write yet.
      // We already know the unsend succeeded (this response confirms
      // it), so there's no need to ask the server again and risk it
      // answering with stale data — this is exactly why "leave the page
      // and come back" was the only thing that reliably fixed it (by
      // then, the lag had cleared).
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, is_unsent: true } : m)));

      if (body.chat_unlock_refunded) {
        toast({
          title: "Chat unlock cancelled",
          description: "Your Sparks were refunded since your match hadn't replied yet.",
        });
        fetchMatch();
        refreshSparksBadge();
      }
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to unsend message.",
        variant: "destructive",
      });
    }
  };

  const canUnsend = (msg: Message) => {
    if (msg.is_unsent) return false;
    if (!isMyMsg(msg.sender_id)) return false;
    return Date.now() - new Date(msg.sent_at).getTime() <= 60 * 60 * 1000;
  };

  if (matchLoading) {
    return (
      <div className="p-6 pt-6">
        <Skeleton className="h-10 w-full mb-4" />
        <Skeleton className="h-[60vh] w-full" />
      </div>
    );
  }

  if (!match) return <div className="p-6 text-center">Match not found.</div>;

  const isInitiator = !!match.chat_unlock_initiator_id && match.chat_unlock_initiator_id === userId;
  const status = match.chat_unlock_status ?? "unlocked";

  return (
    <div className="flex flex-col h-full overflow-hidden w-full max-w-[430px] mx-auto bg-background">
      {/* Header — AppShell's persistent top bar already reserves the
          safe-area/status-bar space, so this header just needs normal
          padding, not its own extra top offset. */}
      <header className="relative z-30 flex-none bg-card/90 backdrop-blur-xl border-b border-card-border py-4 px-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/matches" className="w-10 h-10 flex items-center justify-center rounded-full bg-secondary text-foreground hover:bg-secondary/80 transition-colors shrink-0">
              <ChevronLeft size={24} />
            </Link>
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-full bg-muted overflow-hidden border border-border shrink-0">
                {match.matched_user?.photo_url ? (
                  <img src={match.matched_user.photo_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-primary/20 text-primary font-bold font-['Syne']">
                    {match.matched_user?.name?.[0] || "?"}
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <h2 className="font-bold text-base leading-tight truncate">{match.matched_user?.name}</h2>
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" /> Matched
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 relative">
            {!receiptsUnlocked && (
              <button
                onClick={handleUnlockReceipts}
                disabled={isUnlockingReceipts}
                title="Unlock read receipts"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary text-muted-foreground hover:text-foreground transition-colors text-xs font-medium shrink-0 disabled:opacity-50"
              >
                <Eye size={13} />
                <span>{isUnlockingReceipts ? "..." : "Receipts"}</span>
              </button>
            )}

            <button
              onClick={() => setShowHeaderMenu((v) => !v)}
              className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-foreground shrink-0"
            >
              <MoreVertical size={16} />
            </button>

            {showHeaderMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowHeaderMenu(false)} />
                <div className="absolute right-0 top-11 z-50 bg-card border border-card-border rounded-xl shadow-lg overflow-hidden min-w-[190px]">
                  <button
                    onClick={() => {
                      setShowHeaderMenu(false);
                      handleBlock();
                    }}
                    disabled={isBlocking}
                    className="flex items-center gap-2.5 w-full px-4 py-3 text-sm text-foreground hover:bg-secondary transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    <UserX size={15} className="text-muted-foreground" /> Block user
                  </button>
                  <button
                    onClick={() => {
                      setShowHeaderMenu(false);
                      setShowReportModal(true);
                    }}
                    className="flex items-center gap-2.5 w-full px-4 py-3 text-sm text-destructive hover:bg-secondary transition-colors whitespace-nowrap"
                  >
                    <Flag size={15} /> Report and block
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Chat-unlock status row — live, functional information (a
            ticking countdown, or the current missed-connection state),
            never a static repeated reminder. Nothing renders at all for
            'locked' (no message sent yet by either side) or 'unlocked'
            (fully open) — there's nothing time-sensitive or actionable
            to show in either of those states. */}
        {status === "awaiting_reply" && countdownMs !== null && (
          <div className="flex items-center gap-1.5 mt-2.5 text-xs text-muted-foreground">
            <Clock size={13} className="text-primary shrink-0" />
            <span>
              {isInitiator
                ? `Waiting for reply — refunded in ${formatCountdown(countdownMs)} if no response`
                : `Reply within ${formatCountdown(countdownMs)} to unlock this chat`}
            </span>
          </div>
        )}
        {status === "missed_connection" && (
          <div className="flex items-center gap-1.5 mt-2.5 text-xs text-muted-foreground">
            <HeartCrack size={13} className="text-destructive shrink-0" />
            <span>
              {isInitiator
                ? "Your match didn't reply in time — your Sparks were refunded. Send another message to try again."
                : "You missed this connection — reply now to revive it (full unlock cost)."}
            </span>
          </div>
        )}
      </header>

      {showReportModal && match?.matched_user && (
        <ReportBlockModal
          targetId={match.matched_user.id}
          targetName={match.matched_user.name}
          context="chat"
          matchId={matchId}
          onClose={() => setShowReportModal(false)}
          onSuccess={() => setLocation("/matches")}
        />
      )}

      {/* Messages Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
        {(pullDistance > 0 || isPullRefreshing) && (
          <div
            className="flex items-center justify-center overflow-hidden"
            style={{
              height: isPullRefreshing ? 50 : pullDistance,
              transition: isPullRefreshing ? "height 0.2s ease-out" : undefined,
            }}
          >
            <Loader2
              size={20}
              className={`text-primary ${isPullRefreshing || pullDistance >= 70 ? "animate-spin" : ""}`}
              style={{ opacity: Math.min((isPullRefreshing ? 50 : pullDistance) / 70, 1) }}
            />
          </div>
        )}
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4 text-primary font-bold font-['Syne'] text-2xl">
              {match.matched_user?.name?.[0] || "?"}
            </div>
            {status === "locked" ? (
              <>
                <Lock size={18} className="text-muted-foreground mb-2" />
                <p className="text-muted-foreground text-sm max-w-[220px]">
                  You matched! Send the first message to unlock this chat.
                </p>
              </>
            ) : (
              <p className="text-muted-foreground text-sm max-w-[200px]">
                You matched! Send a message to start the conversation.
              </p>
            )}
          </div>
        ) : (
          messages.map((msg, i) => {
            // Unsent messages disappear from the conversation entirely,
            // not shown as a "Message unsent" placeholder — kept in the
            // underlying messages array (so index-based calculations
            // below, and any OTHER message's reply_to snapshot of this
            // one, stay correct) but never rendered.
            if (msg.is_unsent) return null;

            const mine = isMyMsg(msg.sender_id);
            const showUnsend = mine && canUnsend(msg);
            // Excludes unsent messages from the lookahead — otherwise,
            // if the actual last message I sent was unsent (and so
            // isn't rendered at all, per the early return above), the
            // read-receipt indicator would never appear on the last
            // message that's actually visible.
            const isLastOwnMessage = mine && !messages.slice(i + 1).some((m) => isMyMsg(m.sender_id) && !m.is_unsent);
            const showReadIndicator = isLastOwnMessage && receiptsUnlocked && !msg.is_unsent;
            const isMedia = msg.message_type === "sticker" || msg.message_type === "gif";
            const showDateSeparator = i === 0 || isDifferentLocalDay(msg.sent_at, messages[i - 1].sent_at);

            return (
              <div key={msg.renderKey ?? msg.id}>
                {showDateSeparator && (
                  <div className="flex justify-center my-3">
                    <span className="px-3 py-1 rounded-full bg-secondary text-muted-foreground text-[11px] font-medium">
                      {formatDateSeparator(msg.sent_at)}
                    </span>
                  </div>
                )}
                <div
                id={`msg-${msg.id}`}
                className={`group rounded-xl transition-colors duration-500 ${
                  highlightedMessageId === msg.id ? "bg-primary/10" : ""
                }`}
              >
                <div className={`flex items-end gap-1.5 relative ${mine ? "justify-end" : "justify-start"}`}>
                  {selectedMsgId === msg.id && (
                    <div
                      ref={menuRef}
                      className={`absolute z-50 ${menuOpenUp ? "bottom-full mb-1" : "top-full mt-1"} ${
                        mine ? "right-0" : "left-0"
                      } bg-card border border-card-border rounded-xl shadow-lg overflow-hidden min-w-[170px]`}
                    >
                      {!msg.is_unsent && (
                        <button
                          onClick={() => {
                            setSelectedMsgId(null);
                            setReactingToMessageId(msg.id);
                          }}
                          className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-foreground hover:bg-secondary"
                        >
                          <Smile size={16} className="text-muted-foreground" /> React
                        </button>
                      )}
                      {msg.message_type === "text" && !msg.is_unsent && (
                        <button
                          onClick={() => handleCopy(msg)}
                          className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-foreground hover:bg-secondary"
                        >
                          <Copy size={16} className="text-muted-foreground" /> Copy
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteForMe(msg.id)}
                        className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-foreground hover:bg-secondary"
                      >
                        <Trash2 size={16} className="text-muted-foreground" /> Delete
                      </button>
                      {mine && showUnsend && (
                        <button
                          onClick={() => {
                            setSelectedMsgId(null);
                            handleUnsend(msg.id);
                          }}
                          className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-destructive hover:bg-secondary"
                        >
                          <Undo2 size={16} /> Unsend
                        </button>
                      )}
                    </div>
                  )}

                  {/* Swipe-to-reply indicator — only rendered during an
                      active swipe (not a permanent, invisible flex
                      sibling), and positioned absolute so it never
                      affects the bubble's own width. */}
                  {!msg.is_unsent && swipingMessageId === msg.id && (
                    <div
                      className={`absolute bottom-1 flex items-center justify-center w-7 h-7 rounded-full bg-secondary text-muted-foreground ${
                        mine ? "right-full mr-1" : "left-full ml-1"
                      }`}
                      style={{ opacity: Math.min(swipeOffset / SWIPE_TRIGGER, 1) }}
                    >
                      <Reply size={14} />
                    </div>
                  )}

                  {/* This branch is now unreachable — the early return
                      at the top of this map callback means an unsent
                      message never gets this far at all. Left in place
                      rather than restructured, since removing it would
                      mean re-indenting the entire bubble-rendering block
                      below for no behavioral difference. */}
                  {msg.is_unsent ? (
                    <div className="max-w-[75%] px-4 py-2.5 text-[15px] leading-snug bg-secondary text-foreground rounded-2xl opacity-50 italic line-through">
                      Message unsent
                    </div>
                  ) : (
                    <div
                      className="relative inline-block max-w-[75%]"
                      onMouseDown={(e) => handleBubbleTouchStart(msg, e)}
                      onMouseMove={(e) => handleBubbleTouchMove(msg, e)}
                      onMouseUp={() => handleBubbleTouchEnd(msg)}
                      onMouseLeave={() => handleBubbleTouchEnd(msg)}
                      onTouchStart={(e) => handleBubbleTouchStart(msg, e)}
                      onTouchMove={(e) => handleBubbleTouchMove(msg, e)}
                      onTouchEnd={() => handleBubbleTouchEnd(msg)}
                      onContextMenu={(e) => e.preventDefault()}
                      style={{
                        transform: swipingMessageId === msg.id ? `translateX(${swipeOffset}px)` : undefined,
                        transition: swipingMessageId === msg.id ? "none" : "transform 0.2s",
                      }}
                    >
                      {msg.reply_to && (
                        <button
                          onClick={() => scrollToMessage(msg.reply_to!.id)}
                          className="block w-full mb-1 px-3 py-1.5 rounded-xl border-l-2 border-primary bg-secondary/60 text-left"
                        >
                          <p className="text-xs text-muted-foreground truncate">
                            {msg.reply_to.is_unsent
                              ? "Message unsent"
                              : msg.reply_to.message_type === "gif"
                                ? "GIF"
                                : msg.reply_to.content}
                          </p>
                        </button>
                      )}
                      {msg.message_type === "sticker" ? (
                        // Fixed box, not a plain text-6xl div sized purely
                        // by its own content — large emoji glyphs on
                        // Android WebView can briefly render with a
                        // fallback font's metrics before the real
                        // color-emoji font swaps in, resizing the box the
                        // instant that happens. Reserving a fixed
                        // footprint up front means that swap can no
                        // longer visibly resize anything, same principle
                        // as the GIF aspect-ratio fix above.
                        <div className="w-24 h-24 flex items-center justify-center text-6xl leading-none">
                          {msg.content}
                        </div>
                      ) : msg.message_type === "gif" ? (
                        // A fixed aspect-ratio placeholder, not h-auto —
                        // h-auto means the image's height is entirely
                        // determined by its natural dimensions, which
                        // are unknown until the GIF actually finishes
                        // downloading. Before that it renders at ~zero
                        // height; the moment it loads, everything below
                        // it in the chat suddenly jumps to make room —
                        // exactly the "bounce" this fixes. object-contain
                        // (not cover) keeps the full GIF visible, same as
                        // before, just within a reserved box instead of
                        // one that collapses to nothing pre-load. The
                        // 4/3 fallback below is only a placeholder guess
                        // for before the image has loaded — once it has,
                        // gifAspectRatios holds the GIF's real ratio, so
                        // the box always ends up matching the actual
                        // content exactly rather than letterboxing (or
                        // visually appearing to crop) a mismatched guess.
                        // Keyed by media_url, not msg.id — id changes
                        // from a temp id to the real server id once an
                        // optimistically-sent GIF's POST resolves, but by
                        // then the image is already loaded/cached, so
                        // onLoad wouldn't fire again to re-learn the
                        // ratio under the new id. The URL itself never
                        // changes across that transition.
                        //
                        // aspect-ratio applied DIRECTLY to the img, not
                        // to a wrapping div with the img at h-full inside
                        // it. A percentage height (h-full = height: 100%)
                        // requires its parent to have a "definite" height
                        // to resolve against — and a parent sized purely
                        // via aspect-ratio doesn't reliably count as
                        // definite for that purpose in every browser's
                        // layout path. When that resolution fails, the
                        // img falls back to its own natural (often
                        // taller) height instead of the intended 100%,
                        // and the parent's overflow-hidden silently clips
                        // the excess — exactly the "cropped at top or
                        // bottom" symptom this was producing, confirmed
                        // present on both web and native, which is what
                        // pointed at a genuine CSS issue rather than
                        // anything WebView-specific. Putting aspect-ratio
                        // directly on the img removes the percentage-
                        // height relationship entirely — there's nothing
                        // left to fail to resolve.
                        <div className="rounded-2xl overflow-hidden bg-muted">
                          <img
                            src={msg.media_url ?? ""}
                            alt="GIF"
                            className="w-full block object-contain"
                            style={{ aspectRatio: gifAspectRatios[msg.media_url ?? ""] ?? 4 / 3 }}
                            onLoad={(e) => {
                              const img = e.currentTarget;
                              const key = msg.media_url ?? "";
                              if (img.naturalWidth && img.naturalHeight && key) {
                                const ratio = img.naturalWidth / img.naturalHeight;
                                setGifAspectRatios((prev) =>
                                  prev[key] === ratio ? prev : { ...prev, [key]: ratio },
                                );
                              }
                            }}
                          />
                        </div>
                      ) : (
                        <div
                          className={`px-4 py-2.5 text-[15px] leading-snug select-none ${
                            mine
                              ? "bg-primary text-white rounded-2xl rounded-tr-sm"
                              : "bg-secondary text-foreground rounded-2xl rounded-tl-sm"
                          }`}
                        >
                          {msg.content}
                        </div>
                      )}

                      {/* Reactions — overlaid on the bubble's own bottom
                          corner (WhatsApp/iMessage-style), not a separate
                          block that reads as its own message. */}
                      {msg.reactions.length > 0 && (
                        <div
                          className={`absolute -bottom-2.5 z-10 flex flex-wrap gap-1 ${mine ? "right-1" : "left-1"}`}
                        >
                          {msg.reactions.map((r) => (
                            <button
                              key={r.emoji}
                              onClick={() => handleReact(msg.id, r.emoji)}
                              className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border shadow-sm transition-colors ${
                                r.reactedByMe
                                  ? "bg-primary/15 border-primary text-primary"
                                  : "bg-card border-card-border text-muted-foreground"
                              }`}
                            >
                              <span>{r.emoji}</span>
                              {r.count > 1 && <span>{r.count}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Always shows the time; extends with Delivered/Read
                    only for the last own message once receipts are
                    unlocked, reusing the same row instead of stacking a
                    second one underneath it. */}
                <div
                  className={`flex items-center gap-1 mt-1 text-[11px] text-muted-foreground ${
                    mine ? "justify-end pr-1" : "justify-start pl-1"
                  }`}
                >
                  <span>{formatMessageTime(msg.sent_at)}</span>
                  {showReadIndicator && (
                    <>
                      <span>·</span>
                      {msg.is_read ? (
                        <>
                          <CheckCheck size={12} className="text-primary" />
                          <span>Read</span>
                        </>
                      ) : (
                        <span>Delivered</span>
                      )}
                    </>
                  )}
                </div>
              </div>
              </div>
            );
          })
        )}
      </div>

      {/* Input — AppShell's main already reserves clearance for the
          bottom nav, so this only needs a modest bottom padding, not its
          own large offset on top of that. */}
      <div className="flex-none bg-background border-t border-border px-4 py-3">
        {replyingTo && (
          <div className="flex items-center justify-between gap-2 mb-2 pl-3 pr-2 py-1.5 rounded-xl bg-secondary/60 border-l-2 border-primary">
            <div className="min-w-0">
              <p className="text-xs font-medium text-primary">
                Replying to {isMyMsg(replyingTo.sender_id) ? "yourself" : match.matched_user?.name}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {replyingTo.message_type === "gif" ? "GIF" : replyingTo.content}
              </p>
            </div>
            <button
              onClick={() => setReplyingTo(null)}
              className="w-6 h-6 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        )}
        <form onSubmit={handleSend} className="flex gap-2 items-end">
          <button
            type="button"
            onClick={() => {
              setShowEmojiPicker((v) => !v);
              setShowMediaPicker(false);
            }}
            className="h-12 w-11 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors shrink-0"
          >
            <Smile size={22} />
          </button>
          <button
            type="button"
            onClick={() => {
              setShowMediaPicker((v) => !v);
              setShowEmojiPicker(false);
            }}
            className="h-12 w-11 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors shrink-0"
          >
            <ImagePlus size={22} />
          </button>
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 bg-card border-card-border rounded-full h-12 px-4 focus-visible:ring-1 focus-visible:ring-primary"
            disabled={isSending}
          />
          <Button
            type="submit"
            size="icon"
            className="h-12 w-12 rounded-full shrink-0 bg-primary hover:bg-primary/90 disabled:opacity-50"
            disabled={!input.trim() || isSending}
          >
            <Send size={20} className="ml-1" />
          </Button>
        </form>

        {showEmojiPicker && (
          <div className="mt-2 h-56 bg-card border border-card-border rounded-2xl pt-3 overflow-hidden">
            <div className="flex items-center justify-between px-3 pb-1">
              <span className="text-xs font-medium text-muted-foreground">Emoji</span>
              <button onClick={() => setShowEmojiPicker(false)} className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center">
                <X size={12} />
              </button>
            </div>
            <EmojiPicker
              onSelect={(emoji) => {
                setInput((prev) => prev + emoji);
              }}
            />
          </div>
        )}

        {showMediaPicker && (
          <div className="mt-2 h-64 bg-card border border-card-border rounded-2xl pt-3 overflow-hidden">
            <div className="flex items-center justify-between px-3 pb-1">
              <span className="text-xs font-medium text-muted-foreground">Stickers & GIFs</span>
              <button onClick={() => setShowMediaPicker(false)} className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center">
                <X size={12} />
              </button>
            </div>
            <MediaPicker
              onSelectSticker={(emoji) => sendMediaMessage("sticker", emoji)}
              onSelectGif={(url) => sendMediaMessage("gif", "GIF", url)}
              token={token}
            />
          </div>
        )}
      </div>

      {/* Reaction picker — compact row is hand-built (exact-fit, and
          crucially has no search input to accidentally trigger the
          device's native keyboard). Tapping + mounts the full library
          picker separately, sized generously since at that point it's
          the only thing on screen — avoiding the alternative of a single
          fixed-height container that has to compromise between "snug for
          six emojis" and "roomy enough for the full board." */}
      {reactingToMessageId && !showFullEmojiPicker && (
        <div
          className="fixed inset-0 z-[100] bg-black/40 flex items-end"
          onClick={() => setReactingToMessageId(null)}
        >
          <div
            className="w-full max-w-[430px] mx-auto bg-card rounded-t-3xl overflow-hidden pb-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>
            <div className="flex items-center justify-center gap-2 px-4">
              {QUICK_REACT_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => {
                    handleReact(reactingToMessageId, emoji);
                    setReactingToMessageId(null);
                  }}
                  className="w-11 h-11 rounded-full bg-secondary flex items-center justify-center text-2xl hover:scale-110 transition-transform"
                >
                  {emoji}
                </button>
              ))}
              <button
                onClick={() => setShowFullEmojiPicker(true)}
                className="w-11 h-11 rounded-full bg-secondary flex items-center justify-center text-muted-foreground text-xl font-semibold"
              >
                +
              </button>
            </div>
          </div>
        </div>
      )}

      {reactingToMessageId && showFullEmojiPicker && (
        <div
          className="fixed inset-0 z-[100] bg-black/40 flex items-end"
          onClick={() => {
            setReactingToMessageId(null);
            setShowFullEmojiPicker(false);
          }}
        >
          <div
            className="w-full max-w-[430px] mx-auto bg-card rounded-t-3xl overflow-hidden max-h-[65vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>
            <ReactionPicker
              theme="light"
              autoFocusSearch={false}
              width="100%"
              height={340}
              previewConfig={{ showPreview: false }}
              onEmojiClick={(emojiData) => {
                handleReact(reactingToMessageId!, emojiData.emoji);
                setReactingToMessageId(null);
                setShowFullEmojiPicker(false);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
