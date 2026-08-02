import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { Megaphone, Zap, AlertTriangle, Eye, CheckCheck, Bell } from "lucide-react";

interface Notification {
  id: string;
  type: "announcement" | "spark_grant" | "spark_low" | "profile_views";
  title: string;
  body: string | null;
  is_read: boolean;
  created_at: string;
}

const TYPE_ICON: Record<Notification["type"], any> = {
  announcement: Megaphone,
  spark_grant: Zap,
  spark_low: AlertTriangle,
  profile_views: Eye,
};

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

export default function NotificationsPage() {
  const { token } = useAuth();
  const [, setLocation] = useLocation();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/notifications", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const body = await res.json();
      setNotifications(body ?? []);
    } catch {
      // Silent — page just shows empty state.
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Run once on mount only — consistent with the fix applied elsewhere
  // to avoid re-fetching (and visually resetting) on every background
  // token refresh.
  useEffect(() => {
    fetchNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markRead = async (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    try {
      await fetch(`/api/notifications/${id}/read`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // Non-fatal — worst case it shows as unread again next load.
    }
  };

  const markAllRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    try {
      await fetch("/api/notifications/read-all", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // Non-fatal.
    }
  };

  const hasUnread = notifications.some((n) => !n.is_read);

  if (isLoading) {
    return (
      <div className="px-6 pt-6 space-y-3">
        <Skeleton className="h-8 w-40 mb-4" />
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="min-h-full px-6 pb-6 pt-6 bg-background">
      <div className="flex items-center justify-between">
        <PageHeader title="Notifications" />
        {hasUnread && (
          <button
            onClick={markAllRead}
            className="flex items-center gap-1.5 text-xs font-semibold text-primary -mt-4"
          >
            <CheckCheck size={14} />
            Mark all read
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-20">
          <div className="w-16 h-16 rounded-full bg-card border border-card-border flex items-center justify-center mb-4">
            <Bell size={24} className="text-muted-foreground" />
          </div>
          <p className="text-muted-foreground">Nothing here yet.</p>
        </div>
      ) : (
        <div className="space-y-2 mt-2">
          {notifications.map((n) => {
            const Icon = TYPE_ICON[n.type];
            return (
              <button
                key={n.id}
                onClick={() => {
                  if (!n.is_read) markRead(n.id);
                  if (n.type === "profile_views") setLocation("/who-viewed-me");
                }}
                className={`w-full flex items-start gap-3 text-left rounded-2xl p-4 border transition-colors ${
                  n.is_read ? "bg-card border-card-border" : "bg-primary/5 border-primary/30"
                }`}
              >
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                    n.is_read ? "bg-secondary text-muted-foreground" : "bg-gradient-accent text-white"
                  }`}
                >
                  <Icon size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-sm ${n.is_read ? "font-medium" : "font-semibold"}`}>{n.title}</p>
                    {!n.is_read && <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />}
                  </div>
                  {n.body && <p className="text-xs text-muted-foreground mt-0.5">{n.body}</p>}
                  <p className="text-[10px] text-muted-foreground mt-1.5">{timeAgo(n.created_at)}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
