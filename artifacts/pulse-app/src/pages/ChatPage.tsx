import { useState, useRef, useEffect } from "react";
import { useGetMatch, useGetMessages, useSendMessage, getGetMessagesQueryKey, getGetMatchQueryKey } from "@workspace/api-client-react";
import { useParams, Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Send, Zap, Ghost, RefreshCw, MessageSquarePlus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export default function ChatPage() {
  const params = useParams();
  const matchId = params.matchId || "";
  const { data: match, isLoading: matchLoading } = useGetMatch(matchId, { query: { enabled: !!matchId, queryKey: getGetMatchQueryKey(matchId) } });
  
  // Poll messages every 3s
  const { data: messages = [] } = useGetMessages(matchId, { 
    query: { 
      enabled: !!matchId, 
      queryKey: getGetMessagesQueryKey(matchId),
      refetchInterval: 3000
    } 
  });
  
  const sendMessage = useSendMessage();
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // Temporary hardcoded myUserId based on token/context - simplified for UI
  const isMyMsg = (senderId: string) => match?.matched_user?.id !== senderId;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !matchId) return;
    
    sendMessage.mutate({ matchId, data: { content: input } }, {
      onSuccess: () => {
        setInput("");
        queryClient.invalidateQueries({ queryKey: getGetMessagesQueryKey(matchId) });
        queryClient.invalidateQueries({ queryKey: getGetMatchQueryKey(matchId) });
      }
    });
  };

  if (matchLoading) return <div className="p-6 pt-12"><Skeleton className="h-10 w-full mb-4"/><Skeleton className="h-[60vh] w-full"/></div>;
  if (!match) return <div className="p-6 text-center">Match not found.</div>;

  const progressPercent = Math.min(100, (match.message_count / match.message_limit) * 100);
  const isCapReached = match.message_count >= match.message_limit;

  return (
    <div className="flex flex-col h-[100dvh] w-full max-w-[430px] mx-auto bg-background relative z-50">
      {/* Header */}
      <header className="flex-none bg-card/90 backdrop-blur-xl border-b border-card-border pt-12 pb-4 px-4 sticky top-0 z-10 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href={`/matches/${matchId}`} className="w-10 h-10 flex items-center justify-center rounded-full bg-secondary text-foreground hover:bg-secondary/80 transition-colors">
              <ChevronLeft size={24} />
            </Link>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-muted overflow-hidden border border-border">
                {match.photo_revealed && match.matched_user?.photo_url ? (
                  <img src={match.matched_user.photo_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-primary/20 text-primary font-bold font-['Syne']">
                    {match.matched_user?.name?.[0] || '?'}
                  </div>
                )}
              </div>
              <div>
                <h2 className="font-bold text-base leading-tight">{match.matched_user?.name}</h2>
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Active
                </div>
              </div>
            </div>
          </div>
        </div>
        
        {/* Message Cap Progress */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs font-medium">
            <span className="text-muted-foreground">Connection Progress</span>
            <span className={isCapReached ? "text-primary" : "text-foreground"}>
              {match.message_count} / {match.message_limit} msgs
            </span>
          </div>
          <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden flex">
            <div 
              className="h-full bg-gradient-accent transition-all duration-500 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          {isCapReached && (
            <p className="text-[10px] text-primary font-semibold text-center mt-1 animate-pulse">
              Limit reached. Time for a Video Call.
            </p>
          )}
        </div>
      </header>

      {/* Messages Area */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth"
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4 text-primary font-bold font-['Syne'] text-2xl">
              P
            </div>
            <p className="text-muted-foreground text-sm max-w-[200px]">
              Chat is unlocked. Send a message to start the connection.
            </p>
          </div>
        ) : (
          messages.map((msg, i) => {
            const mine = isMyMsg(msg.sender_id);
            const showTail = i === messages.length - 1 || isMyMsg(messages[i+1]?.sender_id) !== mine;
            
            return (
              <div key={msg.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div 
                  className={`
                    max-w-[75%] px-4 py-2.5 text-[15px] leading-snug
                    ${mine 
                      ? 'bg-primary text-white rounded-2xl rounded-tr-sm' 
                      : 'bg-secondary text-foreground rounded-2xl rounded-tl-sm'}
                    ${msg.is_unsent ? 'opacity-50 italic line-through' : ''}
                  `}
                >
                  {msg.is_unsent ? 'Message unsent' : msg.content}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Boost Strip & Input */}
      <div className="flex-none bg-background border-t border-border px-4 py-3 pb-8">
        {/* Boost actions */}
        <div className="flex justify-between items-center mb-3">
          <div className="flex gap-2">
            <BoostButton icon={<MessageSquarePlus size={14} />} label="Icebreaker" sparks={5} />
            <BoostButton icon={<RefreshCw size={14} />} label="Stretch" sparks={3} />
            <BoostButton icon={<Ghost size={14} />} label="Ghost" sparks={1} />
          </div>
        </div>

        <form onSubmit={handleSend} className="flex gap-2 items-end">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isCapReached ? "Message limit reached..." : "Type a message..."}
            className="flex-1 bg-card border-card-border rounded-full h-12 px-4 focus-visible:ring-1 focus-visible:ring-primary"
            disabled={isCapReached || sendMessage.isPending}
          />
          <Button 
            type="submit" 
            size="icon" 
            className="h-12 w-12 rounded-full shrink-0 bg-primary hover:bg-primary/90 disabled:opacity-50"
            disabled={!input.trim() || isCapReached || sendMessage.isPending}
          >
            <Send size={20} className="ml-1" />
          </Button>
        </form>
      </div>
    </div>
  );
}

function BoostButton({ icon, label, sparks }: { icon: React.ReactNode, label: string, sparks: number }) {
  return (
    <button className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary hover:bg-secondary/80 rounded-full transition-colors text-xs font-medium text-muted-foreground hover:text-foreground group">
      {icon}
      <span>{label}</span>
      <div className="flex items-center text-accent/80 group-hover:text-accent ml-0.5">
        <Zap size={10} className="fill-current" />{sparks}
      </div>
    </button>
  );
}
