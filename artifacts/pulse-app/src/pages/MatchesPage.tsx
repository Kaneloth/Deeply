import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/PageHeader";
import { UserX, Flag, Sparkles, ChevronDown, MoreVertical } from "lucide-react";
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

// In-memory only, same pattern as DiscoverPage.tsx's cachedCandidates —
// lets a revisit to Matches show the last-seen list instantly instead of
// a skeleton, while a fresh fetch quietly runs underneath.
import { readPersistentCache, writePersistentCache, registerCacheResetter } from "@/lib/persistentCache";
import { useRefetchOnAppResume } from "@/hooks/useRefetchOnAppResume";
import { usePullToRefresh } from "@/contexts/PullToRefreshContext";

// In-memory only, same pattern as DiscoverPage.tsx's cachedCandidates —
// but ALSO backed by localStorage here, so this survives a real app
// restart (not just a within-session revisit). Reading persisted data on
// module init means a cold app open can show the last-seen Matches list
// instantly instead of a skeleton, before the background fetch below
// even resolves. Discover deliberately doesn't get this same treatment
// — its scan-wave animation is gated by a separate, intentionally
// non-persisted flag that always forces a fresh loading state on a real
// app reopen regardless, so persisting its cache would add complexity
// for zero practical benefit there.
const MATCHES_CACHE_KEY = "matches";
let cachedMatches: Match[] | null = readPersistentCache<Match[]>(MATCHES_CACHE_KEY);
function updateMatchesCache(value: Match[]) {
  cachedMatches = value;
  writePersistentCache(MATCHES_CACHE_KEY, value);
}
registerCacheResetter(() => {
  cachedMatches = null;
});

// The merge-don't-replace fix in fetchMatches below (see its comment)
// deliberately keeps a previously-shown match even when a fresh fetch
// doesn't include it, so a flaky/incomplete read can't make a real
// match vanish. That's the right call for a fetch that's merely
// missing something — but it means an ACTUALLY-deleted match has no
// way to ever get cleared, since every future fetch also just "merges"
// its continued absence right back in. This export is the other half:
// an authoritative signal (a specific match ID confirmed 404 by its own
// GET /api/matches/:id, not just absent from a list) that overrides the
// merge and removes it for good. Called from MatchDetailPage.tsx (and
// should be called from anywhere else that gets a definitive
// not-found for a specific match, e.g. ChatPage) — never from the list
// fetch itself, which by design can't tell "gone" from "incomplete".
export function evictMatchFromCache(matchId: string): void {
  if (cachedMatches === null) return;
  const next = cachedMatches.filter((m) => m.id !== matchId);
  if (next.length !== cachedMatches.length) updateMatchesCache(next);
}

export default function MatchesPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [matches, setMatches] = useState<Match[]>(cachedMatches ?? []);
  const [isLoading, setIsLoading] = useState(cachedMatches === null);
  const [showNewMatches, setShowNewMatches] = useState(true);

  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<{ id: string; name: string; matchId: string } | null>(null);
  const [isBlocking, setIsBlocking] = useState(false);

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
      setMatches((prev) => {
        const next = prev.filter((m) => m.matched_user?.id !== userId);
        updateMatchesCache(next);
        return next;
      });
      setSelectedMatchId(null);
      toast({ title: "User blocked" });
    } catch {
      toast({ title: "Error", description: "Failed to block user.", variant: "destructive" });
    } finally {
      setIsBlocking(false);
    }
  };

  const fetchMatches = useCallback(async () => {
    if (cachedMatches === null) setIsLoading(true);
    try {
      const res = await fetch("/api/matches", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load matches");
      const fresh = body ?? [];
      // Merge, don't replace — same pattern used for ChatPage's message
      // list, for the same reason. Diagnostic logging on 2026-08-23
      // proved the underlying `matches` table read is genuinely
      // inconsistent between calls (a confirmed match with an active
      // conversation flapped in and out of a *different* endpoint's
      // results with no unmatch happening), and this page showed the
      // same symptom directly — an existing match with real messages
      // disappearing from this list, then reappearing on its own. A
      // fetch that's missing a match we already confirmed real should
      // never make it vanish; only an explicit action (block, report,
      // unmatch) should remove one. Fresh data still wins for anything
      // both lists agree exists (e.g. updated message_count/has_unread).
      //
      // De-duplicated by matched_user.id, not just match id — a real
      // production case proved this matters: this cache is persisted to
      // localStorage PER DEVICE, and evictMatchFromCache only ever runs
      // on whichever device actually performed an unmatch. A second
      // device (e.g. the web app, when the unmatch happened in the
      // native app, or vice versa) keeps the stale match indefinitely in
      // its own localStorage, since by design nothing here ever
      // proactively clears a merely-absent entry. If that same person is
      // later matched with again — a new match row, genuinely a
      // different id — the stale entry and the fresh one both survive
      // this merge, since they don't share an id. But the matches table
      // has a UNIQUE constraint on (user1_id, user2_id): the database
      // itself guarantees at most one real match with any given person
      // at a time, so two cards for the same person is never a valid
      // state regardless of which id caused it. When a stale retained
      // entry and a fresh entry point at the same person, the fresh one
      // always wins — the retained one is dropped instead of kept.
      setMatches((prev) => {
        const freshIds = new Set(fresh.map((m: Match) => m.id));
        const freshUserIds = new Set(fresh.map((m: Match) => m.matched_user?.id).filter(Boolean));
        const stillMissingFromFresh = prev.filter(
          (m) => !freshIds.has(m.id) && !(m.matched_user?.id && freshUserIds.has(m.matched_user.id)),
        );
        const merged = [...fresh, ...stillMissingFromFresh];
        updateMatchesCache(merged);
        return merged;
      });
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

  // See useRefetchOnAppResume for the full reasoning — catches a
  // background refresh that silently failed behind the cached instant
  // load, so a real new match doesn't stay invisible until a manual
  // reload.
  useRefetchOnAppResume(fetchMatches);
  usePullToRefresh(fetchMatches);

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
              <div className="relative">
                <Link href={`/matches/${match.id}`} className="block">
                  <div
                    className={`flex items-center gap-4 p-4 pr-12 rounded-2xl bg-card border transition-colors active:scale-[0.98] select-none ${
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

                {/* Tap-to-open menu, matching MatchDetailPage's 3-dot
                    pattern — replaces the previous tap-and-hold gesture,
                    which was firing accidentally during an ordinary
                    slow pull-to-refresh drag (both gestures start the
                    same way: finger down, little movement yet), causing
                    people to block/report someone by accident. A
                    sibling of the Link (not nested inside it), so
                    tapping it can never also trigger navigation. */}
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedMatchId(selectedMatchId === match.id ? null : match.id);
                  }}
                  className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-black/10 hover:bg-black/20 flex items-center justify-center text-foreground transition-colors"
                >
                  <MoreVertical size={16} />
                </button>
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
            setMatches((prev) => {
              const next = prev.filter((m) => m.matched_user?.id !== reportTarget.id);
              updateMatchesCache(next);
              return next;
            });
            setReportTarget(null);
          }}
        />
      )}
    </div>
  );
}
