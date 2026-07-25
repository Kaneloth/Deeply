import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useParams, Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, Play } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface MatchedUser {
  id: string;
  name: string;
  age: number;
  bio: string | null;
  city: string | null;
  photo_url: string | null;
  integrity_score: number;
  personality_tags: string[];
}

interface Match {
  id: string;
  matched_user: MatchedUser | null;
  message_count: number;
  created_at: string;
}

export default function MatchDetailPage() {
  const params = useParams();
  const matchId = params.matchId || "";
  const { token } = useAuth();
  const { toast } = useToast();
  const [match, setMatch] = useState<Match | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchMatch = useCallback(async () => {
    if (!matchId) return;
    setIsLoading(true);
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
      setIsLoading(false);
    }
  }, [matchId, token, toast]);

  useEffect(() => {
    fetchMatch();
  }, [fetchMatch]);

  if (isLoading) {
    return (
      <div className="p-6 pt-12">
        <Skeleton className="h-64 w-full rounded-3xl" />
      </div>
    );
  }

  if (!match) {
    return <div className="p-6 text-center mt-20 text-muted-foreground">Match not found.</div>;
  }

  const profile = match.matched_user;

  return (
    <div className="min-h-full pb-24 relative bg-background">
      {/* Back Button Overlay */}
      <Link href="/matches" className="absolute top-12 left-6 z-20 w-10 h-10 bg-black/40 backdrop-blur-md rounded-full flex items-center justify-center text-white border border-white/10 hover:bg-black/60 transition-colors">
        <ChevronLeft size={24} />
      </Link>

      {/* Header Profile Photo */}
      <div className="h-[50vh] w-full relative bg-muted border-b border-border">
        {profile?.photo_url ? (
          <img src={profile.photo_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-card to-background">
            <span className="text-primary text-6xl font-bold font-['Syne'] opacity-20">
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
            <span className="text-2xl font-['Syne'] font-bold text-primary">
              {profile?.integrity_score}<span className="text-sm text-muted-foreground">/100</span>
            </span>
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
              {profile.personality_tags.map((tag) => (
                <span key={tag} className="px-4 py-2 bg-secondary text-secondary-foreground rounded-full text-sm font-medium border border-border">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Bio */}
        {profile?.bio && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-1">About</h3>
            <div className="bg-card border border-card-border rounded-2xl p-5 shadow-sm">
              <p className="text-sm text-foreground">{profile.bio}</p>
            </div>
          </div>
        )}
      </div>

      {/* Sticky Bottom CTA — chat is always open now */}
      <div className="fixed bottom-20 left-0 right-0 max-w-[430px] mx-auto p-6 bg-gradient-to-t from-background via-background to-transparent z-10 pointer-events-none">
        <div className="pointer-events-auto">
          <Link
            href={`/matches/${matchId}/chat`}
            className="w-full h-14 rounded-2xl bg-gradient-accent border-0 text-white font-bold text-lg shadow-[0_8px_20px_rgba(225,29,72,0.3)] flex items-center justify-center hover:scale-[1.02] transition-transform"
          >
            Open Chat →
          </Link>
        </div>
      </div>
    </div>
  );
}
