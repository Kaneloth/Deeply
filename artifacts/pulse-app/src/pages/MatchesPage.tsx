import { useGetMatches } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";

function MatchCountdown({ expiresAt }: { expiresAt: string }) {
  const target = new Date(expiresAt).getTime();
  const now = new Date().getTime();
  const diff = Math.max(0, target - now);
  
  const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  
  if (diff <= 0) return <span className="text-destructive font-medium text-xs">Expired</span>;
  if (h < 1) return <span className="text-accent font-medium text-xs">{m}m left</span>;
  return <span className="text-muted-foreground text-xs">{h}h {m}m left</span>;
}

export default function MatchesPage() {
  const { data: matches, isLoading } = useGetMatches();

  if (isLoading) {
    return (
      <div className="p-6 pt-12 space-y-4">
        <h1 className="text-3xl font-['Syne'] font-bold mb-8">Matches</h1>
        {[1, 2, 3].map(i => (
          <div key={i} className="flex items-center gap-4 p-4 rounded-2xl bg-card border border-card-border">
            <Skeleton className="w-16 h-16 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const activeMatches = matches?.filter(m => m.status === 'active' || m.status === 'pending') || [];

  return (
    <div className="p-6 pt-12 min-h-full">
      <h1 className="text-3xl font-['Syne'] font-bold mb-8 tracking-tight">Active Matches</h1>
      
      {activeMatches.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center mb-6">
            <span className="text-4xl text-muted-foreground">∅</span>
          </div>
          <h3 className="text-xl font-semibold mb-2">It's quiet in here</h3>
          <p className="text-muted-foreground max-w-[250px]">
            Your next great connection is waiting in the Discover tab.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {activeMatches.map((match, idx) => (
            <motion.div
              key={match.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
            >
              <Link href={`/matches/${match.id}`} className="block">
                <div className="flex items-center gap-4 p-4 rounded-2xl bg-card border border-card-border hover:border-primary/50 transition-colors active:scale-[0.98]">
                  <div className="relative">
                    <div className="w-16 h-16 rounded-full bg-muted overflow-hidden border-2 border-background shadow-md">
                      {match.photo_revealed && match.matched_user?.photo_url ? (
                        <img src={match.matched_user.photo_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-accent/20">
                          <span className="text-primary text-xl font-bold font-['Syne']">
                            {match.matched_user?.name?.[0] || '?'}
                          </span>
                        </div>
                      )}
                    </div>
                    {/* Status dot */}
                    <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-background rounded-full flex items-center justify-center">
                      <div className={`w-3 h-3 rounded-full ${match.chat_unlocked ? 'bg-primary' : 'bg-muted-foreground'}`} />
                    </div>
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-1">
                      <h3 className="font-semibold text-lg truncate pr-2">{match.matched_user?.name}</h3>
                      <MatchCountdown expiresAt={match.expires_at} />
                    </div>
                    
                    <div className="flex items-center mt-1">
                      {match.chat_unlocked ? (
                        <div className="flex items-center gap-1.5 bg-secondary px-2 py-0.5 rounded text-xs font-medium text-secondary-foreground">
                          <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                          {match.message_count} / {match.message_limit} msgs
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 bg-muted px-2 py-0.5 rounded text-xs font-medium text-muted-foreground">
                          <span className="text-xs">🔒 Chat Locked</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
