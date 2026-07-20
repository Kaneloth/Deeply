import { useGetMatch, useUnlockChat, getGetMatchQueryKey } from "@workspace/api-client-react";
import { useParams, Link, useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Play, Pause, ChevronLeft, Lock } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

export default function MatchDetailPage() {
  const params = useParams();
  const matchId = params.matchId || "";
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  
  const { data: match, isLoading } = useGetMatch(matchId, { query: { enabled: !!matchId, queryKey: getGetMatchQueryKey(matchId) } });
  const unlockChatMutation = useUnlockChat();
  
  const [playingPromptId, setPlayingPromptId] = useState<string | null>(null);

  if (isLoading) {
    return <div className="p-6 pt-12"><Skeleton className="h-64 w-full rounded-3xl" /></div>;
  }

  if (!match) {
    return <div className="p-6 text-center mt-20 text-muted-foreground">Match not found.</div>;
  }

  const profile = match.matched_user;

  const handleUnlockChat = () => {
    unlockChatMutation.mutate({ matchId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMatchQueryKey(matchId) });
        setLocation(`/matches/${matchId}/chat`);
      }
    });
  };

  return (
    <div className="min-h-full pb-24 relative bg-background">
      {/* Back Button Overlay */}
      <Link href="/matches" className="absolute top-12 left-6 z-20 w-10 h-10 bg-black/40 backdrop-blur-md rounded-full flex items-center justify-center text-white border border-white/10 hover:bg-black/60 transition-colors">
        <ChevronLeft size={24} />
      </Link>

      {/* Header Profile Photo */}
      <div className="h-[50vh] w-full relative bg-muted border-b border-border">
        {match.photo_revealed && profile?.photo_url ? (
          <img src={profile.photo_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-card to-background p-6 relative overflow-hidden">
            <div className="absolute inset-0 bg-primary/5 pattern-noise opacity-50" />
            <Lock className="w-16 h-16 text-muted-foreground/30 mb-4 z-10" />
            <span className="text-primary text-6xl font-bold font-['Syne'] opacity-20 z-10">
              {profile?.name?.[0]}
            </span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
        
        <div className="absolute bottom-6 left-6 right-6">
          <h1 className="text-4xl font-['Syne'] font-bold text-foreground drop-shadow-md flex items-end gap-3">
            {profile?.name} <span className="text-2xl font-medium text-foreground/80">{profile?.age}</span>
          </h1>
          {profile?.city && <p className="text-muted-foreground mt-1 text-lg">{profile.city}</p>}
        </div>
      </div>

      <div className="p-6 space-y-8">
        {/* Integrity Score */}
        <div className="bg-card border border-card-border p-5 rounded-2xl">
          <div className="flex justify-between items-end mb-3">
            <span className="text-sm font-medium text-muted-foreground">Integrity Score</span>
            <span className="text-2xl font-['Syne'] font-bold text-primary">{profile?.integrity_score}<span className="text-sm text-muted-foreground">/100</span></span>
          </div>
          <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
            <div className="h-full bg-primary" style={{ width: `${profile?.integrity_score || 0}%` }} />
          </div>
          <p className="text-xs text-muted-foreground mt-3 text-center">Based on response rate and dating behavior.</p>
        </div>

        {/* Tags */}
        {profile?.personality_tags && profile.personality_tags.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Vibe Check</h3>
            <div className="flex flex-wrap gap-2">
              {profile.personality_tags.map(tag => (
                <span key={tag} className="px-4 py-2 bg-secondary text-secondary-foreground rounded-full text-sm font-medium border border-border">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Audio Prompts */}
        <div className="space-y-4">
           <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-1">Audio Responses</h3>
           {match.matched_user && (
             <div className="space-y-4">
               {/* Simulating prompts since UserProfile doesn't carry them in the type currently, but DiscoverCard does. 
                   If the backend doesn't attach them to Match detail, we show bio. */}
               {profile?.bio ? (
                 <div className="bg-card border border-card-border rounded-2xl p-5 shadow-sm">
                   <p className="text-sm font-medium text-muted-foreground mb-4">"About me"</p>
                   <div className="flex items-center gap-4">
                      <button className="w-12 h-12 rounded-full bg-primary flex items-center justify-center text-white shrink-0 shadow-[0_0_15px_rgba(192,38,211,0.4)]">
                        <Play size={20} className="ml-1" />
                      </button>
                      <div className="flex-1 h-8 bg-secondary/50 rounded-lg overflow-hidden flex items-center px-1 gap-0.5">
                        {Array.from({length: 30}).map((_, i) => (
                           <div key={i} className="flex-1 bg-primary/40 rounded-full" style={{ height: `${Math.max(20, Math.random() * 100)}%` }}/>
                        ))}
                      </div>
                   </div>
                 </div>
               ) : (
                 <p className="text-muted-foreground text-sm italic">No audio recorded.</p>
               )}
             </div>
           )}
        </div>
      </div>

      {/* Sticky Bottom CTA */}
      <div className="fixed bottom-20 left-0 right-0 max-w-[430px] mx-auto p-6 bg-gradient-to-t from-background via-background to-transparent z-10 pointer-events-none">
        <div className="pointer-events-auto">
          {match.chat_unlocked ? (
            <Link href={`/matches/${matchId}/chat`} className="w-full h-14 rounded-2xl bg-foreground text-background font-bold text-lg hover:bg-foreground/90 shadow-xl flex items-center justify-center">
              Open Chat →
            </Link>
          ) : (
            <Button 
              className="w-full h-14 rounded-2xl bg-gradient-accent border-0 text-white font-bold text-lg shadow-[0_8px_20px_rgba(225,29,72,0.3)] hover:scale-[1.02] transition-transform"
              onClick={handleUnlockChat}
              disabled={unlockChatMutation.isPending}
            >
              {unlockChatMutation.isPending ? "Unlocking..." : "Unlock Chat — 1 Key"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
