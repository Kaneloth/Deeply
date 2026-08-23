import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSparks } from "@/contexts/SparksContext";
import { useInvites } from "@/contexts/InvitesContext";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ProfileCard } from "@/components/ProfileCard";
import { PageHeader } from "@/components/PageHeader";
import { TopBar } from "@/components/TopBar";
import { BottomNav } from "@/components/BottomNav";
import { MatchCelebration } from "@/components/MatchCelebration";
import { ChevronLeft, Star, Lock, Heart, X, MessageCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";

interface Invite {
  id: string;
  name: string;
  age: number;
  bio: string | null;
  city: string | null;
  photo_url: string | null;
  photos: { url: string; media_type: "image" | "video" }[];
  personality_tags: string[];
  super_liked: boolean;
  // Present when this invite came from a "message before match" send —
  // see discover.ts's message-request handler. Received invites show it
  // as the other person's opening message; sent invites show it as a
  // reminder of what was sent.
  message_content: string | null;
}

function InviteDetailOverlay({
  invite,
  onClose,
  onDecide,
  onWithdraw,
  isActioning,
}: {
  invite: Invite;
  onClose: () => void;
  onDecide?: (direction: "like" | "pass") => void;
  onWithdraw?: () => void;
  isActioning?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[100] bg-background flex flex-col">
      <div className="w-full max-w-[430px] mx-auto h-full flex flex-col overflow-hidden">
        <TopBar />

        <div className="flex-1 flex flex-col overflow-hidden px-4 pb-20 pt-4">
          <div className="flex-1 min-h-0 relative">
            <ProfileCard profile={invite} />
            <button
              onClick={onClose}
              className="absolute top-3 left-3 z-20 w-8 h-8 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white border border-white/10"
            >
              <ChevronLeft size={16} />
            </button>
            {invite.super_liked && (
              <div className="absolute top-3 right-3 w-8 h-8 rounded-full bg-accent flex items-center justify-center shadow-lg z-10">
                <Star size={16} className="fill-current text-white" />
              </div>
            )}
          </div>

          {invite.message_content && (
            <div className="flex-none mt-3 px-4 py-3 rounded-2xl bg-card border border-card-border">
              <p className="text-xs font-medium text-muted-foreground mb-1">
                {onDecide ? `${invite.name}'s message` : "Your message"}
              </p>
              <p className="text-sm text-foreground leading-snug">{invite.message_content}</p>
            </div>
          )}

          <div className="flex-none pt-3 flex items-center justify-center gap-3">
            {onDecide ? (
              <>
                <button
                  onClick={() => onDecide("pass")}
                  disabled={isActioning}
                  className="flex-1 h-11 rounded-full bg-card border border-card-border flex items-center justify-center gap-1.5 text-muted-foreground hover:border-destructive hover:text-destructive transition-colors font-semibold text-sm"
                >
                  <X size={16} />
                  Decline
                </button>
                <button
                  onClick={() => onDecide("like")}
                  disabled={isActioning}
                  className="flex-1 h-11 rounded-full bg-gradient-accent text-white flex items-center justify-center gap-1.5 font-semibold text-sm shadow-[0_8px_20px_rgba(225,29,72,0.3)]"
                >
                  <Heart size={16} className="fill-current" />
                  Accept
                </button>
              </>
            ) : onWithdraw ? (
              <button
                onClick={onWithdraw}
                disabled={isActioning}
                className="flex-1 h-11 rounded-full bg-card border border-card-border flex items-center justify-center gap-1.5 text-muted-foreground hover:border-destructive hover:text-destructive transition-colors font-semibold text-sm"
              >
                <X size={16} />
                {isActioning ? "Withdrawing..." : "Withdraw Invite"}
              </button>
            ) : (
              <p className="text-sm text-muted-foreground">Waiting for them to respond</p>
            )}
          </div>
        </div>

        <BottomNav />
      </div>
    </div>
  );
}

// In-memory only, same pattern as DiscoverPage.tsx's cachedCandidates.
// Two separate caches since Received and Sent are independently loaded.
import { readPersistentCache, writePersistentCache, registerCacheResetter } from "@/lib/persistentCache";
import { useRefetchOnAppResume } from "@/hooks/useRefetchOnAppResume";
import { usePullToRefresh } from "@/contexts/PullToRefreshContext";

// Backed by localStorage — see MatchesPage.tsx for the full reasoning.
// Received (revealed + newCount) and Sent are cached separately, since
// they're independently loaded.
const REVEALED_CACHE_KEY = "invites_revealed";
const NEW_COUNT_CACHE_KEY = "invites_new_count";
const SENT_CACHE_KEY = "invites_sent";

let cachedRevealed: Invite[] | null = readPersistentCache<Invite[]>(REVEALED_CACHE_KEY);
let cachedNewCount = readPersistentCache<number>(NEW_COUNT_CACHE_KEY) ?? 0;
let cachedSent: Invite[] | null = readPersistentCache<Invite[]>(SENT_CACHE_KEY);

function updateRevealedCache(value: Invite[]) {
  cachedRevealed = value;
  writePersistentCache(REVEALED_CACHE_KEY, value);
}
function updateNewCountCache(value: number) {
  cachedNewCount = value;
  writePersistentCache(NEW_COUNT_CACHE_KEY, value);
}
function updateSentCache(value: Invite[] | null) {
  cachedSent = value;
  if (value !== null) writePersistentCache(SENT_CACHE_KEY, value);
}
registerCacheResetter(() => {
  cachedRevealed = null;
  cachedNewCount = 0;
  cachedSent = null;
});

export default function InvitesPage() {
  const { token } = useAuth();
  const { refresh: refreshSparksBadge } = useSparks();
  const { refresh: refreshInvitesBadge, setCount: setInvitesBadgeCount } = useInvites();
  const { toast } = useToast();

  const [revealed, setRevealed] = useState<Invite[]>(cachedRevealed ?? []);
  const [newCount, setNewCount] = useState(cachedNewCount);
  const [isLoading, setIsLoading] = useState(cachedRevealed === null);
  const [isRevealing, setIsRevealing] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [matchCelebration, setMatchCelebration] = useState<{ name: string; matchId: string; photoUrl?: string | null } | null>(null);
  const [, setLocation] = useLocation();
  const [selectedInvite, setSelectedInvite] = useState<Invite | null>(null);
  const [mode, setMode] = useState<"received" | "sent">("received");
  const [sent, setSent] = useState<Invite[] | null>(cachedSent);
  const [sentLoading, setSentLoading] = useState(false);

  const fetchInvites = useCallback(async () => {
    if (cachedRevealed === null) setIsLoading(true);
    try {
      const res = await fetch("/api/discover/invites", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load invites");
      const freshRevealed = body.revealed ?? [];
      const freshNewCount = body.new_count ?? 0;
      updateRevealedCache(freshRevealed);
      updateNewCountCache(freshNewCount);
      setRevealed(freshRevealed);
      setNewCount(freshNewCount);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to load invites.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [token, toast]);

  // Run once on mount only — same reload-on-token-refresh fix applied
  // elsewhere in the app (MatchesPage, SearchPage, DiscoverPage,
  // MatchDetailPage). fetchInvites depends on token and toast, both of
  // which can get new references on background token refresh — the
  // previous [fetchInvites] dependency re-ran this fetch (and
  // re-rendered the whole page) on that same interval.
  useEffect(() => {
    fetchInvites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Catches exactly the case where the one background refresh behind the
  // cached instant-load silently failed (see useRefetchOnAppResume for
  // the full reasoning) — without this, a real new invite could sit
  // invisible behind stale cached content until the user manually
  // reloaded the page.
  useRefetchOnAppResume(fetchInvites);

  const fetchSent = useCallback(async () => {
    setSentLoading(true);
    try {
      const res = await fetch("/api/discover/invites/sent", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load sent invites");
      const freshSent = body.sent ?? [];
      updateSentCache(freshSent);
      setSent(freshSent);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to load sent invites.",
        variant: "destructive",
      });
    } finally {
      setSentLoading(false);
    }
  }, [token, toast]);

  // Refreshes whichever tab is actually visible — Sent is fetched
  // lazily (only when the user has switched to it), so pulling to
  // refresh while on Received shouldn't trigger a Sent fetch that
  // hasn't otherwise happened yet, and vice versa.
  usePullToRefresh(mode === "sent" ? fetchSent : fetchInvites);

  const handleSwitchMode = (next: "received" | "sent") => {
    setMode(next);
    if (next === "sent" && sent === null) {
      fetchSent();
    }
  };

  const handleReveal = async () => {
    setIsRevealing(true);
    try {
      const res = await fetch("/api/discover/invites/reveal", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 402) {
        toast({
          title: "You're out of Sparks",
          description: "Recharge now or wait for your next monthly grant to see your new invites.",
          variant: "destructive",
        });
        return;
      }

      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to reveal invites");
      const freshRevealed = body.invites ?? [];
      updateRevealedCache(freshRevealed);
      updateNewCountCache(0);
      setRevealed(freshRevealed);
      setNewCount(0);
      // Set directly rather than refreshInvitesBadge() — revealing marks
      // every currently-pending invite as revealed in this same request,
      // so 0 is known with certainty here. A fresh poll immediately
      // after this write risks landing on a connection that hasn't seen
      // it yet and reporting a stale, too-high count right back — see
      // InvitesContext.tsx for the full reasoning.
      setInvitesBadgeCount(0);
      if (body.balance !== null) {
        refreshSparksBadge();
      }
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to reveal invites.",
        variant: "destructive",
      });
    } finally {
      setIsRevealing(false);
    }
  };

  const handleDecide = async (invite: Invite, direction: "like" | "pass") => {
    setAcceptingId(invite.id);
    try {
      const res = await fetch("/api/discover/swipe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ targetId: invite.id, direction, skipInviteQuota: true }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to record decision");

      setRevealed((prev) => {
        const next = prev.filter((i) => i.id !== invite.id);
        updateRevealedCache(next);
        return next;
      });
      setSelectedInvite((prev) => (prev?.id === invite.id ? null : prev));
      refreshInvitesBadge();

      if (body.matched) {
        setMatchCelebration({ name: invite.name, matchId: body.matchId, photoUrl: invite.photo_url });
      }
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to record decision.",
        variant: "destructive",
      });
    } finally {
      setAcceptingId(null);
    }
  };

  const handleWithdraw = async (invite: Invite) => {
    setAcceptingId(invite.id);
    try {
      const res = await fetch(`/api/discover/invites/sent/${invite.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 402) {
        toast({
          title: "You're out of Sparks",
          description: "Recharge now or wait for your next monthly grant to withdraw this invite.",
          variant: "destructive",
        });
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to withdraw invite");
      }

      setSent((prev) => {
        const next = prev ? prev.filter((i) => i.id !== invite.id) : prev;
        updateSentCache(next);
        return next;
      });
      setSelectedInvite((prev) => (prev?.id === invite.id ? null : prev));
      toast({ title: "Invite withdrawn" });
      refreshSparksBadge();
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to withdraw invite.",
        variant: "destructive",
      });
    } finally {
      setAcceptingId(null);
    }
  };

  return (
    <div className="min-h-full px-4 pb-6 pt-6">
      <PageHeader title="Invites" />

      <div className="flex gap-2 mb-6">
        <button
          onClick={() => handleSwitchMode("received")}
          className={`flex-1 h-10 rounded-xl text-sm font-semibold transition-colors ${
            mode === "received" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
          }`}
        >
          Received
        </button>
        <button
          onClick={() => handleSwitchMode("sent")}
          className={`flex-1 h-10 rounded-xl text-sm font-semibold transition-colors ${
            mode === "sent" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
          }`}
        >
          Sent
        </button>
      </div>

      {mode === "sent" ? (
        sentLoading ? (
          <Skeleton className="h-40 w-full rounded-3xl" />
        ) : !sent || sent.length === 0 ? (
          <div className="flex flex-col items-center text-center px-4 mt-10">
            <div className="w-20 h-20 rounded-full bg-card border border-card-border flex items-center justify-center mb-6">
              <Heart className="text-muted-foreground" size={28} />
            </div>
            <h2 className="text-xl font-['Syne'] font-bold">No pending invites sent</h2>
            <p className="text-muted-foreground mt-2 max-w-[260px]">
              People you invite from Discover or Search who haven't matched back yet will show up here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {sent.map((invite) => (
              <button
                key={invite.id}
                onClick={() => setSelectedInvite(invite)}
                className="relative aspect-[3/4] bg-card border border-card-border rounded-2xl overflow-hidden"
              >
                {invite.photo_url ? (
                  <img src={invite.photo_url} alt={invite.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-card to-background">
                    <span className="text-primary text-3xl font-bold font-['Syne'] opacity-20">{invite.name?.[0]}</span>
                  </div>
                )}
                {invite.super_liked && (
                  <div className="absolute top-2 right-2 w-7 h-7 rounded-full bg-accent flex items-center justify-center shadow-lg">
                    <Star size={14} className="fill-current text-white" />
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-black/70 to-transparent" />
                <div className="absolute bottom-2 left-3 right-3">
                  <p className="text-white font-semibold text-sm truncate flex items-center gap-1">
                    {invite.message_content && <MessageCircle size={12} className="shrink-0" />}
                    {invite.name}, {invite.age}
                  </p>
                  <p className="text-white/70 text-xs">Pending</p>
                </div>
              </button>
            ))}
          </div>
        )
      ) : isLoading ? (
        <Skeleton className="h-40 w-full rounded-3xl" />
      ) : (
        <>
          {newCount > 0 && (
            <div className="relative w-full rounded-3xl overflow-hidden bg-card border border-card-border p-6 mb-6">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-accent/10" />
              <div className="relative z-10 flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                  <Lock className="text-primary" size={20} />
                </div>
                <div className="flex-1">
                  <p className="font-['Syne'] font-bold text-foreground">
                    {newCount} new {newCount === 1 ? "person" : "people"} invited you
                  </p>
                  <p className="text-xs text-muted-foreground">Reveal to see who</p>
                </div>
                <Button
                  onClick={handleReveal}
                  disabled={isRevealing}
                  className="h-10 px-4 rounded-xl bg-gradient-accent border-0 text-white font-semibold text-sm shrink-0"
                >
                  {isRevealing ? "..." : "Reveal"}
                </Button>
              </div>
            </div>
          )}

          {revealed.length === 0 && newCount === 0 ? (
            <div className="flex flex-col items-center text-center px-4 mt-10">
              <div className="w-20 h-20 rounded-full bg-card border border-card-border flex items-center justify-center mb-6">
                <Heart className="text-muted-foreground" size={28} />
              </div>
              <h2 className="text-xl font-['Syne'] font-bold">No invites yet</h2>
              <p className="text-muted-foreground mt-2 max-w-[260px]">
                Keep swiping in Discover — when someone invites you to connect, they'll show up here.
              </p>
            </div>
          ) : revealed.length > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              {revealed.map((invite) => (
                <div key={invite.id} className="bg-card border border-card-border rounded-2xl overflow-hidden">
                  <button
                    onClick={() => setSelectedInvite(invite)}
                    className="relative aspect-[3/4] bg-muted w-full block"
                  >
                    {invite.photo_url ? (
                      <img src={invite.photo_url} alt={invite.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-card to-background">
                        <span className="text-primary text-3xl font-bold font-['Syne'] opacity-20">{invite.name?.[0]}</span>
                      </div>
                    )}
                    {invite.super_liked && (
                      <div className="absolute top-2 right-2 w-7 h-7 rounded-full bg-accent flex items-center justify-center shadow-lg">
                        <Star size={14} className="fill-current text-white" />
                      </div>
                    )}
                    <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-black/70 to-transparent" />
                    <div className="absolute bottom-2 left-3 right-3">
                      <p className="text-white font-semibold text-sm truncate flex items-center gap-1">
                        {invite.message_content && <MessageCircle size={12} className="shrink-0" />}
                        {invite.name}, {invite.age}
                      </p>
                    </div>
                  </button>
                  <div className="flex border-t border-card-border">
                    <button
                      onClick={() => handleDecide(invite, "pass")}
                      disabled={acceptingId === invite.id}
                      className="flex-1 py-2.5 flex items-center justify-center gap-1.5 text-muted-foreground font-semibold text-sm hover:bg-secondary/50 hover:text-destructive transition-colors disabled:opacity-50 border-r border-card-border"
                    >
                      <X size={14} />
                      Decline
                    </button>
                    <button
                      onClick={() => handleDecide(invite, "like")}
                      disabled={acceptingId === invite.id}
                      className="flex-1 py-2.5 flex items-center justify-center gap-1.5 text-primary font-semibold text-sm hover:bg-secondary/50 transition-colors disabled:opacity-50"
                    >
                      <Heart size={14} className="fill-current" />
                      {acceptingId === invite.id ? "..." : "Accept"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}

      <AnimatePresence>
        {matchCelebration && (
          <MatchCelebration
            name={matchCelebration.name}
            photoUrl={matchCelebration.photoUrl}
            onContinue={() => setMatchCelebration(null)}
            onMessage={() => setLocation(`/matches/${matchCelebration.matchId}/chat`)}
          />
        )}
      </AnimatePresence>

      {selectedInvite && (
        <InviteDetailOverlay
          invite={selectedInvite}
          onClose={() => setSelectedInvite(null)}
          onDecide={mode === "received" ? (direction) => handleDecide(selectedInvite, direction) : undefined}
          onWithdraw={mode === "sent" ? () => handleWithdraw(selectedInvite) : undefined}
          isActioning={acceptingId === selectedInvite.id}
        />
      )}
    </div>
  );
}
