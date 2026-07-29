import { useState, useRef, useEffect, useCallback } from "react";
import { useParams, Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useSparks } from "@/contexts/SparksContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Send, Undo2, Eye, CheckCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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

interface Message {
  id: string;
  match_id: string;
  sender_id: string;
  content: string;
  is_read: boolean;
  is_unsent: boolean;
  sent_at: string;
}

export default function ChatPage() {
  const params = useParams();
  const matchId = params.matchId || "";
  const { token } = useAuth();
  const { refresh: refreshSparksBadge } = useSparks();
  const { toast } = useToast();

  const [match, setMatch] = useState<Match | null>(null);
  const [matchLoading, setMatchLoading] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [receiptsUnlocked, setReceiptsUnlocked] = useState(false);
  const [isUnlockingReceipts, setIsUnlockingReceipts] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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
    try {
      const res = await fetch(`/api/matches/${matchId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ content }),
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
    return Date.now() - new Date(msg.sent_at).getTime() <= 5 * 60 * 1000;
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
      <header className="flex-none bg-card/90 backdrop-blur-xl border-b border-card-border py-4 px-4">
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
        </div>
      </header>

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

            return (
              <div key={msg.id}>
                <div className={`flex items-end gap-1.5 ${mine ? "justify-end" : "justify-start"}`}>
                  {mine && showUnsend && (
                    <button
                      onClick={() => handleUnsend(msg.id)}
                      title="Unsend"
                      className="w-6 h-6 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-secondary transition-colors shrink-0 mb-1"
                    >
                      <Undo2 size={14} />
                    </button>
                  )}
                  <div
                    className={`max-w-[75%] px-4 py-2.5 text-[15px] leading-snug ${
                      mine
                        ? "bg-primary text-white rounded-2xl rounded-tr-sm"
                        : "bg-secondary text-foreground rounded-2xl rounded-tl-sm"
                    } ${msg.is_unsent ? "opacity-50 italic line-through" : ""}`}
                  >
                    {msg.is_unsent ? "Message unsent" : msg.content}
                  </div>
                </div>
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
        <form onSubmit={handleSend} className="flex gap-2 items-end">
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
      </div>
    </div>
  );
}
