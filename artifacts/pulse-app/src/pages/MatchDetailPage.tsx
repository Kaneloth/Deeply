import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useParams, useLocation, Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ProfileCard, type ProfileCardData } from "@/components/ProfileCard";
import { ChevronLeft, MessageCircle, UserX } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Match {
  id: string;
  matched_user: (ProfileCardData & { integrity_score: number }) | null;
  message_count: number;
  created_at: string;
}

export default function MatchDetailPage() {
  const params = useParams();
  const matchId = params.matchId || "";
  const { token } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [match, setMatch] = useState<Match | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showUnmatchConfirm, setShowUnmatchConfirm] = useState(false);
  const [isUnmatching, setIsUnmatching] = useState(false);

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

  const handleUnmatch = async () => {
    setIsUnmatching(true);
    try {
      const res = await fetch(`/api/matches/${matchId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to unmatch");
      }
      toast({ title: "Unmatched", description: "This match has been removed." });
      setLocation("/matches");
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to unmatch.",
        variant: "destructive",
      });
    } finally {
      setIsUnmatching(false);
      setShowUnmatchConfirm(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 pt-10 space-y-6">
        <Skeleton className="h-8 w-32 mx-2" />
        <Skeleton className="h-[500px] w-full rounded-3xl" />
      </div>
    );
  }

  if (!match || !match.matched_user) {
    return <div className="p-6 text-center mt-20 text-muted-foreground">Match not found.</div>;
  }

  const profile = match.matched_user;

  return (
    <div className="flex flex-col h-full overflow-hidden px-4 pb-2 pt-6">
      <div className="flex-1 relative min-h-0">
        <ProfileCard profile={profile} />
        <Link
          href="/matches"
          className="absolute top-3 left-3 z-20 w-8 h-8 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white border border-white/10"
        >
          <ChevronLeft size={16} />
        </Link>
      </div>

      <div className="flex items-center justify-center gap-3 mt-3">
        <button
          onClick={() => setShowUnmatchConfirm(true)}
          className="h-11 px-4 rounded-full bg-card border border-card-border flex items-center justify-center gap-1.5 text-muted-foreground hover:border-destructive hover:text-destructive transition-colors font-semibold text-sm"
        >
          <UserX size={16} />
          Unmatch
        </button>
        <Link
          href={`/matches/${matchId}/chat`}
          className="flex-1 h-11 rounded-full bg-gradient-accent border-0 text-white shadow-[0_8px_20px_rgba(225,29,72,0.3)] flex items-center justify-center gap-1.5 font-semibold text-sm active:scale-95 transition-transform"
        >
          <MessageCircle size={16} />
          Open Chat
        </Link>
      </div>

      {showUnmatchConfirm && (
        <div
          className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm flex items-end"
          onClick={() => !isUnmatching && setShowUnmatchConfirm(false)}
        >
          <div
            className="w-full max-w-[430px] mx-auto bg-card border-t border-card-border rounded-t-3xl p-6 pb-10"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-['Syne'] font-bold text-lg mb-1">Unmatch {profile.name}?</h3>
            <p className="text-sm text-muted-foreground mb-6">
              This will remove the match and your conversation. This can't be undone.
            </p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 h-12 rounded-xl"
                onClick={() => setShowUnmatchConfirm(false)}
                disabled={isUnmatching}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 h-12 rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={handleUnmatch}
                disabled={isUnmatching}
              >
                {isUnmatching ? "Unmatching..." : "Unmatch"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
