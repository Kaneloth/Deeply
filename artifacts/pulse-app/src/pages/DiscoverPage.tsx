import { useState, useEffect } from "react";
import { useGetTodayMatch, useAcceptMatch, useRevealMatchPhoto, useGetSparks, getGetTodayMatchQueryKey, getGetSparksQueryKey } from "@workspace/api-client-react";
import { SparkIcon } from "@/components/Icons";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
import { Lock, Play, Pause, MapPin } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

// Animated audio waveform
function AudioWaveform({ isPlaying }: { isPlaying: boolean }) {
  const bars = Array.from({ length: 24 });
  return (
    <div className="flex items-center gap-[3px] h-10 px-2 overflow-hidden">
      {bars.map((_, i) => {
        const height = Math.random() * 60 + 20; // 20% to 80%
        return (
          <motion.div
            key={i}
            className="w-1 bg-primary rounded-full"
            initial={{ height: `${height}%` }}
            animate={isPlaying ? {
              height: [`${height}%`, `${Math.random() * 80 + 20}%`, `${height}%`],
            } : { height: `${height}%` }}
            transition={{
              repeat: isPlaying ? Infinity : 0,
              duration: 0.5 + Math.random() * 0.5,
              ease: "easeInOut"
            }}
          />
        );
      })}
    </div>
  );
}

function CountdownTimer({ expiresAt }: { expiresAt: string }) {
  const [timeLeft, setTimeLeft] = useState<string>("00:00:00");

  useEffect(() => {
    const target = new Date(expiresAt).getTime();
    
    const interval = setInterval(() => {
      const now = new Date().getTime();
      const diff = target - now;

      if (diff <= 0) {
        setTimeLeft("00:00:00");
        clearInterval(interval);
        return;
      }

      const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const s = Math.floor((diff % (1000 * 60)) / 1000);

      setTimeLeft(
        `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
      );
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt]);

  return (
    <div className="flex items-center gap-2 justify-center my-6">
      <motion.div 
        animate={{ opacity: [1, 0.5, 1] }} 
        transition={{ repeat: Infinity, duration: 2 }}
        className="w-2 h-2 rounded-full bg-accent"
      />
      <span className="font-['Syne'] text-4xl font-bold tracking-tighter text-foreground">{timeLeft}</span>
    </div>
  );
}

export default function DiscoverPage() {
  const { data: match, isLoading } = useGetTodayMatch();
  const { data: sparks } = useGetSparks();
  const acceptMatch = useAcceptMatch();
  const revealPhoto = useRevealMatchPhoto();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [playingPromptId, setPlayingPromptId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="p-6 space-y-6 pt-12">
        <div className="flex justify-between items-center">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-16" />
        </div>
        <Skeleton className="h-[400px] w-full rounded-2xl" />
        <Skeleton className="h-14 w-full rounded-xl" />
        <Skeleton className="h-14 w-full rounded-xl" />
      </div>
    );
  }

  // Beautiful empty state if no match (or if accepted/rejected and status changed)
  if (!match || match.status !== 'pending') {
    return (
      <div className="h-full min-h-[calc(100dvh-80px)] flex flex-col items-center justify-center p-6 text-center relative">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] bg-primary/5 blur-[100px] rounded-full pointer-events-none" />
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }} 
          animate={{ scale: 1, opacity: 1 }} 
          transition={{ duration: 0.6 }}
          className="z-10 flex flex-col items-center"
        >
          <div className="w-20 h-20 rounded-full bg-card border border-card-border flex items-center justify-center mb-6 shadow-xl">
            <HeartbeatVisual />
          </div>
          <h2 className="text-2xl font-['Syne'] font-bold text-foreground">Your next match arrives in...</h2>
          <CountdownTimer expiresAt={new Date(new Date().setHours(24,0,0,0)).toISOString()} />
          <p className="text-muted-foreground mt-4 max-w-[260px]">
            Quality over quantity. Take a breather, live your life, and come back tomorrow.
          </p>
        </motion.div>
      </div>
    );
  }

  const handleAccept = () => {
    acceptMatch.mutate({ matchId: match.match_id }, {
      onSuccess: () => {
        toast({ title: "It's a Match!", description: "Head to your matches to start chatting." });
        queryClient.invalidateQueries({ queryKey: getGetTodayMatchQueryKey() });
      }
    });
  };

  const handleReveal = () => {
    if ((sparks?.balance || 0) < 2) {
      toast({ title: "Not enough Sparks", description: "You need 2 Sparks to reveal a photo.", variant: "destructive" });
      return;
    }
    revealPhoto.mutate({ matchId: match.match_id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetTodayMatchQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetSparksQueryKey() });
      }
    });
  };

  return (
    <div className="flex flex-col min-h-full pb-6 pt-10 px-4">
      <header className="flex justify-between items-center mb-6 px-2">
        <h1 className="text-2xl font-['Syne'] font-bold tracking-tight">Today's Match</h1>
        <div className="flex items-center gap-1.5 bg-card/80 backdrop-blur border border-card-border px-3 py-1.5 rounded-full text-sm font-bold text-primary">
          <SparkIcon size={16} />
          <span>{sparks?.balance || 0}</span>
        </div>
      </header>

      <motion.div 
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="flex-1 flex flex-col"
      >
        <div className="bg-card border border-card-border rounded-3xl overflow-hidden shadow-2xl relative flex-1 flex flex-col">
          {/* Photo Section */}
          <div className="relative h-[45%] min-h-[300px] w-full bg-muted overflow-hidden shrink-0">
            {match.photo_revealed && match.photo_url ? (
              <img src={match.photo_url} alt="Match" className="w-full h-full object-cover" />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-card to-background flex flex-col items-center justify-center p-6">
                <Lock className="w-12 h-12 text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground text-sm text-center">
                  Photo locked. Listen to their voice to feel the vibe.
                </p>
              </div>
            )}
            
            {/* Gradient Overlay for text */}
            <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-card to-transparent" />
            
            <div className="absolute bottom-4 left-6 right-6">
              <h2 className="text-3xl font-['Syne'] font-bold text-white flex items-end gap-2">
                {match.name} <span className="text-xl font-normal text-white/80">{match.age}</span>
              </h2>
              {match.city && (
                <div className="flex items-center gap-1 text-white/70 text-sm mt-1">
                  <MapPin size={14} /> {match.city} {match.distance_km ? `• ${match.distance_km}km away` : ''}
                </div>
              )}
            </div>
          </div>

          <div className="p-6 flex-1 flex flex-col">
            {/* Tags */}
            <div className="flex flex-wrap gap-2 mb-6">
              {match.personality_tags?.map(tag => (
                <span key={tag} className="px-3 py-1 rounded-full bg-secondary text-secondary-foreground text-xs font-medium">
                  {tag}
                </span>
              ))}
            </div>

            {/* Audio Prompts */}
            <div className="space-y-4 mb-6">
              {match.audio_prompts?.map(prompt => {
                const isPlaying = playingPromptId === prompt.id;
                return (
                  <div key={prompt.id} className="bg-background rounded-2xl p-4 border border-border">
                    <p className="text-sm font-medium text-muted-foreground mb-3">"{prompt.prompt_question}"</p>
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={() => setPlayingPromptId(isPlaying ? null : prompt.id)}
                        className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 transition-colors ${isPlaying ? 'bg-primary text-white shadow-[0_0_15px_rgba(192,38,211,0.4)]' : 'bg-secondary text-foreground hover:bg-secondary/80'}`}
                      >
                        {isPlaying ? <Pause size={20} className="fill-current" /> : <Play size={20} className="fill-current ml-1" />}
                      </button>
                      <div className="flex-1 bg-secondary/30 rounded-xl">
                        <AudioWaveform isPlaying={isPlaying} />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            
            <div className="mt-auto">
              <CountdownTimer expiresAt={match.expires_at} />
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 mt-6">
          {!match.photo_revealed && (
            <Button 
              variant="outline" 
              className="flex-1 h-14 rounded-2xl border-card-border bg-card hover:bg-card/80 text-foreground font-semibold flex items-center justify-center gap-2"
              onClick={handleReveal}
              disabled={revealPhoto.isPending || acceptMatch.isPending}
            >
              <SparkIcon size={18} className="text-primary" />
              <span>Reveal — 2 Sparks</span>
            </Button>
          )}
          <Button 
            className="flex-1 h-14 rounded-2xl bg-gradient-accent border-0 text-white font-bold text-lg shadow-[0_8px_20px_rgba(225,29,72,0.3)] hover:scale-[1.02] transition-transform"
            onClick={handleAccept}
            disabled={acceptMatch.isPending}
          >
            Match Blind
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

// Temporary internal definition since we used it up above
function HeartbeatVisual() {
  return (
    <svg className="w-10 h-10 text-primary drop-shadow-[0_0_10px_rgba(192,38,211,0.5)]" viewBox="0 0 500 100" fill="none">
      <path d="M0 50 H200 L210 20 L230 80 L250 10 L270 90 L290 50 H500" stroke="currentColor" strokeWidth="15" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
