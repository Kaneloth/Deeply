import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useParams, useLocation, Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ProfileCard, type ProfileCardData } from "@/components/ProfileCard";
import { ChevronLeft, MessageCircle, UserX, MoreVertical, Flag } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ReportBlockModal } from "@/components/ReportBlockModal";

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
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [isBlocking, setIsBlocking] = useState(false);

  const fetchMatch = useCallback(async () => {
    if (!matchId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/matches/${matchId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 404) {
        toast({
          title: "Match no longer available",
          description: "This match has been removed.",
        });
        setLocation("/matches");
        return;
      }

      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load match");
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
  }, [matchId, token, toast, setLocation]);

  // Run once per matchId only — same reload-on-token-refresh fix applied
  // elsewhere in the app (MatchesPage, SearchPage, DiscoverPage).
  // fetchMatch depends on token, toast, and setLocation as well as
  // matchId — any one of those getting a new reference (token refreshes
  // periodically, confirmed elsewhere in this codebase) re-triggered
  // this fetch and re-rendered the whole page, ProfileCard included.
  // matchId is kept as the one real dependency, since navigating to a
  // different match should still refetch.
  useEffect(() => {
    fetchMatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

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

  const handleBlock = async () => {
    if (!profile?.id || isBlocking) return;
    setIsBlocking(true);
    try {
      const res = await fetch("/api/blocks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ blockedUserId: profile.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to block");
      }
      toast({ title: `${profile.name} has been blocked` });
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

        <button
          onClick={() => setShowProfileMenu((v) => !v)}
          className="absolute top-3 right-3 z-20 w-8 h-8 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white border border-white/10"
        >
          <MoreVertical size={16} />
        </button>

        {showProfileMenu && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setShowProfileMenu(false)} />
            <div className="absolute top-12 right-3 z-30 bg-card border border-card-border rounded-xl shadow-lg overflow-hidden min-w-[170px]">
              <button
                onClick={() => {
                  setShowProfileMenu(false);
                  handleBlock();
                }}
                disabled={isBlocking}
                className="flex items-center gap-2.5 w-full px-4 py-3 text-sm text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
              >
                <UserX size={15} className="text-muted-foreground" /> Block user
              </button>
              <button
                onClick={() => {
                  setShowProfileMenu(false);
                  setShowReportModal(true);
                }}
                className="flex items-center gap-2.5 w-full px-4 py-3 text-sm text-destructive hover:bg-secondary transition-colors"
              >
                <Flag size={15} /> Report and block
              </button>
            </div>
          </>
        )}
      </div>

      {showReportModal && profile && (
        <ReportBlockModal
          targetId={profile.id}
          targetName={profile.name}
          context="profile"
          matchId={matchId}
          onClose={() => setShowReportModal(false)}
          onSuccess={() => setLocation("/matches")}
        />
      )}

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
