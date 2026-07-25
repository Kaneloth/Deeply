import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";

interface MatchedUser {
  id: string;
  name: string;
  age: number;
  photo_url: string | null;
}

interface Match {
  id: string;
  matched_user: MatchedUser | null;
  message_count: number;
  created_at: string;
}

export default function MatchesPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [matches, setMatches] = useState<Match[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchMatches = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/matches", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load matches");
      setMatches(body ?? []);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to load matches.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [token, toast]);

  useEffect(() => {
    fetchMatches();
  }, [fetchMatches]);

  if (isLoading) {
    return (
      <div className="p-6 pt-12 space-y-4">
        <h1 className="text-3xl font-['Syne'] font-bold mb-8">Matches</h1>
        {[1, 2, 3].map((i) => (
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

  return (
    <div className="p-6 pt-12 min-h-full">
      <h1 className="text-3xl font-['Syne'] font-bold mb-8 tracking-tight">Matches</h1>

      {matches.length === 0 ? (
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
          {matches.map((match, idx) => (
            <motion.div
              key={match.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
            >
              <Link href={`/matches/${match.id}`} className="block">
                <div className="flex items-center gap-4 p-4 rounded-2xl bg-card border border-card-border hover:border-primary/50 transition-colors active:scale-[0.98]">
                  <div className="w-16 h-16 rounded-full bg-muted overflow-hidden border-2 border-background shadow-md shrink-0">
                    {match.matched_user?.photo_url ? (
                      <img src={match.matched_user.photo_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-accent/20">
                        <span className="text-primary text-xl font-bold font-['Syne']">
                          {match.matched_user?.name?.[0] || "?"}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-lg truncate">
                      {match.matched_user?.name}
                      {match.matched_user?.age ? (
                        <span className="text-muted-foreground font-normal ml-2">{match.matched_user.age}</span>
                      ) : null}
                    </h3>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {match.message_count > 0
                        ? `${match.message_count} message${match.message_count === 1 ? "" : "s"}`
                        : "Say hi 👋"}
                    </p>
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
