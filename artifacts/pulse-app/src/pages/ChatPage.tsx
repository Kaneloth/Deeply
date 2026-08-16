import { useState, useRef, useEffect, useCallback } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useSparks } from "@/contexts/SparksContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Send, Undo2, Eye, CheckCheck, Smile, ImagePlus, X, MoreVertical, UserX, Flag, Copy, Trash2, Reply } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { EmojiPicker } from "@/components/EmojiPicker";
import { ReportBlockModal } from "@/components/ReportBlockModal";
import { MediaPicker } from "@/components/MediaPicker";

interface MatchedUser {
  id: string;
  name: string;
  photo_url: string | null;
}

interface Match {
  id: string;
  matched_user: MatchedUser | null;
  message_count: number;
  created_at: string;
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

const QUICK_REACT_EMOJIS = ["❤️", "😂", "😮", "😢", "👍", "🔥"];

export default function ChatPage() {
  const params = useParams();
  const matchId = params.matchId || "";
  const { token } = useAuth();
  const { refresh: refreshSparksBadge } = useSparks();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [match, setMatch] = useState<Match | null>(null);
  const [matchLoading, setMatchLoading] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showMediaPicker, setShowMediaPicker] = useState(false);
  const [reactingToMessageId, setReactingToMessageId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [isBlocking, setIsBlocking] = useState(false);
  const [receiptsUnlocked, setReceiptsUnlocked] = useState(false);
  const [isUnlockingReceipts, setIsUnlockingReceipts] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Long-press message action menu (React / Copy / Delete for me / Unsend)
  const [selectedMsgId, setSelectedMsgId] = useState<string | null>(null);
  const [menuOpenUp, setMenuOpenUp] = useState(false);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longTriggered = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const reactBarRef = useRef<HTMLDivElement>(null);

  // Swipe-to-reply
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
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

  useEffect(() => {
    if (!reactingToMessageId) return;
    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      if (reactBarRef.current && !reactBarRef.current.contains(e.target as Node)) {
        setReactingToMessageId(null);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("touchstart", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("touchstart", handleOutsideClick);
    };
  }, [reactingToMessageId]);

  // The react bar renders in normal document flow — if it appears near
  // the bottom of the currently-loaded messages, it can end up below the
  // visible scroll position (the container's own height stops above the
  // fixed input bar) with nothing bringing it into view automatically.
  useEffect(() => {
    if (!reactingToMessageId) return;
    // Wait a tick for the bar to actually render before measuring it.
    const timer = setTimeout(() => {
      reactBarRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
    return () => clearTimeout(timer);
  }, [reactingToMessageId]);

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
      setReceiptsUnlocked(true);
      refreshSparksBadge();
      await fetchMessages();
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
    setMatchLoading(true);
    try {
      const res = await fetch(`/api/matches/${matchId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Match not found");
      setMatch(body);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to load match.",
        variant: "destructive",
      });
    } finally {
      setMatchLoading(false);
    }
  }, [matchId, token, toast]);

  const fetchMessages = useCallback(async () => {
    if (!matchId) return;
    try {
      const res = await fetch(`/api/matches/${matchId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load messages");
      setMessages(body ?? []);
    } catch {
      // Silent — polling failures shouldn't spam the user with toasts.
    }
  }, [matchId, token]);

  useEffect(() => {
    fetchMatch();
    fetchReceiptsStatus();
  }, [fetchMatch, fetchReceiptsStatus]);

  useEffect(() => {
    fetchMessages();
    const interval = setInterval(fetchMessages, 3000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = input.trim();
    if (!content || !matchId || isSending) return;

    setIsSending(true);
    setInput("");
    const replyId = replyingTo?.id;
    setReplyingTo(null);
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
        setInput(content);
        toast({
          title: "You're out of Sparks",
          description: "Recharge now or wait for your next monthly grant to keep messaging.",
          variant: "destructive",
        });
        return;
      }

      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to send message");
      await fetchMessages();
    } catch (err) {
      setInput(content); // restore what they typed so they don't lose it
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to send message.",
        variant: "destructive",
      });
    } finally {
      setIsSending(false);
    }
  };

  const sendMediaMessage = async (messageType: "sticker" | "gif", content: string, mediaUrl?: string) => {
    if (!matchId || isSending) return;
    setIsSending(true);
    setShowMediaPicker(false);
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
        toast({
          title: "You're out of Sparks",
          description: "Recharge now or wait for your next monthly grant to keep messaging.",
          variant: "destructive",
        });
        return;
      }

      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to send");
      await fetchMessages();
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to send.",
        variant: "destructive",
      });
    } finally {
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
      await fetchMessages();
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
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth min-h-0">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4 text-primary font-bold font-['Syne'] text-2xl">
              {match.matched_user?.name?.[0] || "?"}
            </div>
            <p className="text-muted-foreground text-sm max-w-[200px]">
              You matched! Send a message to start the conversation.
            </p>
          </div>
        ) : (
          messages.map((msg, i) => {
            const mine = isMyMsg(msg.sender_id);
            const showUnsend = mine && canUnsend(msg);
            const isLastOwnMessage = mine && !messages.slice(i + 1).some((m) => isMyMsg(m.sender_id));
            const showReadIndicator = isLastOwnMessage && receiptsUnlocked && !msg.is_unsent;
            const isMedia = msg.message_type === "sticker" || msg.message_type === "gif";

            return (
              <div
                key={msg.id}
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
                        <div className="text-6xl leading-none">{msg.content}</div>
                      ) : msg.message_type === "gif" ? (
                        <div className="rounded-2xl overflow-hidden">
                          <img src={msg.media_url ?? ""} alt="GIF" className="w-full h-auto" />
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

                {reactingToMessageId === msg.id && (
                  <div
                    ref={reactBarRef}
                    className={`flex gap-1 mt-1.5 ${msg.reactions.length > 0 ? "mt-4" : ""} ${mine ? "justify-end pr-8" : "justify-start pl-8"}`}
                  >
                    {QUICK_REACT_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => {
                          handleReact(msg.id, emoji);
                          setReactingToMessageId(null);
                        }}
                        className="w-8 h-8 rounded-full bg-card border border-card-border flex items-center justify-center text-base hover:scale-110 transition-transform"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}

                {showReadIndicator && (
                  <div className="flex items-center justify-end gap-1 mt-1 pr-1 text-[11px] text-muted-foreground">
                    {msg.is_read ? (
                      <>
                        <CheckCheck size={12} className="text-primary" />
                        <span>Read</span>
                      </>
                    ) : (
                      <span>Delivered</span>
                    )}
                  </div>
                )}
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
            />
          </div>
        )}
      </div>
    </div>
  );
}
