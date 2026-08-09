import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { ProfileCard, type ProfileCardData } from "@/components/ProfileCard";
import { X, Heart, Eye, Sparkles } from "lucide-react";

interface Viewer extends ProfileCardData {
  viewed_at: string;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function WhoViewedMePage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [newCount, setNewCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRevealing, setIsRevealing] = useState(false);
  const [selected, setSelected] = useState<Viewer | null>(null);
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());

  const fetchViewers = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/profile-views/who-viewed-me", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const body = await res.json();
      setViewers(body.revealed ?? []);
      setNewCount(body.new_count ?? 0);
    } catch {
      // Silent — page just shows empty state.
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    fetchViewers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const revealViewers = async () => {
    setIsRevealing(true);
    try {
      const res = await fetch("/api/profile-views/reveal", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to reveal");
      setViewers(body.revealed ?? []);
      setNewCount(0);
      toast({ title: "Revealed!" });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to reveal viewers.",
        variant: "destructive",
      });
    } finally {
      setIsRevealing(false);
    }
  };

  const sendInvite = async (viewer: Viewer) => {
    setInvitingId(viewer.id);
    try {
      const res = await fetch("/api/discover/swipe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          targetId: viewer.id,
          direction: "like",
          clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to send invite");
      setInvitedIds((prev) => new Set(prev).add(viewer.id));
      toast({ title: body.matched ? "It's a match!" : "Invite sent" });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to send invite.",
        variant: "destructive",
      });
    } finally {
      setInvitingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="px-6 pt-6 space-y-3">
        <Skeleton className="h-8 w-48 mb-4" />
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="min-h-full px-6 pb-6 pt-6 bg-background">
      <PageHeader title="Who Viewed You" />

      {newCount > 0 && (
        <div className="bg-gradient-accent rounded-2xl p-4 mb-4 text-white">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles size={16} />
            <p className="font-semibold text-sm">
              {newCount} new {newCount === 1 ? "person" : "people"} viewed your profile
            </p>
          </div>
          <p className="text-xs text-white/80 mb-3">Reveal who they are — already-revealed viewers are always free to see again.</p>
          <button
            onClick={revealViewers}
            disabled={isRevealing}
            className="w-full h-10 rounded-xl bg-white text-primary text-sm font-semibold disabled:opacity-60"
          >
            {isRevealing ? "Revealing..." : "Reveal Now"}
          </button>
        </div>
      )}

      {viewers.length === 0 && newCount === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-20">
          <div className="w-16 h-16 rounded-full bg-card border border-card-border flex items-center justify-center mb-4">
            <Eye size={24} className="text-muted-foreground" />
          </div>
          <p className="text-muted-foreground">No one has viewed your profile yet.</p>
        </div>
      ) : (
        <div className="space-y-2 mt-2">
          {viewers.map((viewer) => (
            <div key={viewer.id} className="flex items-center gap-3 bg-card border border-card-border rounded-2xl p-3">
              <button onClick={() => setSelected(viewer)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                <div className="w-14 h-14 rounded-full bg-muted overflow-hidden shrink-0">
                  {viewer.photos?.[0]?.url ? (
                    <img src={viewer.photos[0].url} alt="" className="w-full h-full object-cover" />
                  ) : null}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">
                    {viewer.name}, {viewer.age}
                  </p>
                  <p className="text-xs text-muted-foreground">Viewed {timeAgo(viewer.viewed_at)}</p>
                </div>
              </button>
              <button
                onClick={() => sendInvite(viewer)}
                disabled={invitingId === viewer.id || invitedIds.has(viewer.id)}
                className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                  invitedIds.has(viewer.id)
                    ? "bg-secondary text-muted-foreground"
                    : "bg-gradient-accent text-white"
                } disabled:opacity-60`}
              >
                <Heart size={16} className={invitedIds.has(viewer.id) ? "" : "fill-current"} />
              </button>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-[200] bg-background flex flex-col">
          <div className="w-full max-w-[430px] mx-auto h-full flex flex-col">
            <div className="flex items-center justify-between px-4 pt-12 pb-3">
              <button onClick={() => setSelected(null)} className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 min-h-0 px-4 pb-4">
              <ProfileCard profile={selected} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
