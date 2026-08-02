import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/PageHeader";
import { UserX, Flag, Sparkles, ChevronDown } from "lucide-react";
import { ReportBlockModal } from "@/components/ReportBlockModal";

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
  has_unread?: boolean;
  is_new?: boolean;
}

export default function MatchesPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [matches, setMatches] = useState<Match[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showNewMatches, setShowNewMatches] = useState(true);

  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<{ id: string; name: string; matchId: string } | null>(null);
  const [isBlocking, setIsBlocking] = useState(false);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longTriggered = useRef(false);

  const startLongPress = (matchId: string) => {
    longTriggered.current = false;
    longPressRef.current = setTimeout(() => {
      longTriggered.current = true;
      setSelectedMatchId(matchId);
    }, 400);
  };
  const cancelLongPress = () => {
    if (longPressRef.current) clearTimeout(longPressRef.current);
  };

  const handleBlockFromMatch = async (userId: string) => {
    setIsBlocking(true);
    try {
      const res = await fetch("/api/blocks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ blockedUserId: userId }),
      });
      if (!res.ok) throw new Error("Failed to block");
      setMatches((prev) => prev.filter((m) => m.matched_user?.id !== userId));
      setSelectedMatchId(null);
      toast({ title: "User blocked" });
    } catch {
      toast({ title: "Error", description: "Failed to block user.", variant: "destructive" });
    } finally {
      setIsBlocking(false);
    }
  };

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Run once on mount only — same reload-on-token-refresh fix applied
  // elsewhere in the app.
  useEffect(() => {
    fetchMatches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isLoading) {
    return (
      <div className="px-4 pb-6 pt-6 space-y-4">
        <PageHeader title="Matches" />
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

  const newMatches = matches.filter((m) => m.is_new);
  const regularMatches = matches.filter((m) => !m.is_new);

  return (
    <div className="px-4 pb-6 pt-6 min-h-full">
      <PageHeader title="Matches" />

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
        <>
          {newMatches.length > 0 && (
            <div className="mb-6">
              <button
                onClick={() => setShowNewMatches((v) => !v)}
                className="w-full flex items-center justify-between mb-3"
              >
                <h3 className="text-sm font-semibold flex items-center gap-1.5 text-foreground">
                  <Sparkles size={15} className="text-primary" />
                  {newMatches.length} New Match{newMatches.length === 1 ? "" : "es"}
                </h3>
                <ChevronDown
                  size={16}
                  className={`text-muted-foreground transition-transform ${showNewMatches ? "rotate-180" : ""}`}
                />
              </button>

              <AnimatePresence>
                {showNewMatches && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="overflow-hidden"
                  >
                    <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1 no-scrollbar">
                      {newMatches.map((match) => (
                        <Link
                          key={match.id}
                          href={`/matches/${match.id}`}
                          className="flex flex-col items-center gap-1.5 shrink-0 w-[72px]"
                        >
                          <div className="w-16 h-16 rounded-full p-[2px] bg-gradient-accent">
                            <div className="w-full h-full rounded-full overflow-hidden border-2 border-background bg-muted">
                              {match.matched_user?.photo_url ? (
                                <img src={match.matched_user.photo_url} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-accent/20">
                                  <span className="text-primary text-lg font-bold font-['Syne']">
                                    {match.matched_user?.name?.[0] || "?"}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                          <p className="text-xs font-medium truncate w-full text-center">
                            {match.matched_user?.name}
                          </p>
                        </Link>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          <div className="space-y-4">
            {regularMatches.map((match, idx) => (
            <motion.div
              key={match.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="relative"
            >
              <div
                onMouseDown={() => startLongPress(match.id)}
                onMouseUp={cancelLongPress}
                onMouseLeave={cancelLongPress}
                onTouchStart={() => startLongPress(match.id)}
                onTouchEnd={cancelLongPress}
                onClick={(e) => {
                  if (longTriggered.current) {
                    e.preventDefault();
                    longTriggered.current = false;
                  }
                }}
              >
                <Link href={`/matches/${match.id}`} className="block">
                  <div
                    className={`flex items-center gap-4 p-4 rounded-2xl bg-card border transition-colors active:scale-[0.98] select-none ${
                      selectedMatchId === match.id ? "border-primary/40 bg-primary/5" : "border-card-border hover:border-primary/50"
                    }`}
                  >
                    <div className="relative shrink-0">
                      <div className="w-16 h-16 rounded-full bg-muted overflow-hidden border-2 border-background shadow-md">
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
                      {match.has_unread && (
                        <span className="absolute top-0 right-0 w-3.5 h-3.5 rounded-full bg-primary border-2 border-background" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-lg truncate">
                        {match.matched_user?.name}
                        {match.matched_user?.age ? (
                          <span className="text-muted-foreground font-normal ml-2">{match.matched_user.age}</span>
                        ) : null}
                      </h3>
                      <p className={`text-sm mt-0.5 ${match.has_unread ? "text-foreground font-semibold" : "text-muted-foreground"}`}>
                        {match.message_count > 0
                          ? `${match.message_count} message${match.message_count === 1 ? "" : "s"}`
                          : "Say hi 👋"}
                      </p>
                    </div>
                  </div>
                </Link>
              </div>

              {selectedMatchId === match.id && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setSelectedMatchId(null)} />
                  <div className="absolute z-50 top-full right-4 -mt-1 bg-card border border-card-border rounded-xl shadow-lg overflow-hidden min-w-[170px]">
                    <button
                      onClick={() => match.matched_user && handleBlockFromMatch(match.matched_user.id)}
                      disabled={isBlocking}
                      className="flex items-center gap-2.5 w-full px-4 py-3 text-sm text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
                    >
                      <UserX size={15} className="text-muted-foreground" /> Block user
                    </button>
                    <button
                      onClick={() => {
                        if (match.matched_user) {
                          setReportTarget({ id: match.matched_user.id, name: match.matched_user.name, matchId: match.id });
                        }
                        setSelectedMatchId(null);
                      }}
                      className="flex items-center gap-2.5 w-full px-4 py-3 text-sm text-destructive hover:bg-secondary transition-colors"
                    >
                      <Flag size={15} /> Report and block
                    </button>
                  </div>
                </>
              )}
            </motion.div>
            ))}
          </div>
        </>
      )}

      {reportTarget && (
        <ReportBlockModal
          targetId={reportTarget.id}
          targetName={reportTarget.name}
          context="chat"
          matchId={reportTarget.matchId}
          onClose={() => setReportTarget(null)}
          onSuccess={() => {
            setMatches((prev) => prev.filter((m) => m.matched_user?.id !== reportTarget.id));
            setReportTarget(null);
          }}
        />
      )}
    </div>
  );
}
