import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { X, Info, AlertTriangle, CheckCircle2 } from "lucide-react";

interface Announcement {
  id: string;
  title: string;
  body: string;
  severity: "info" | "warning" | "success";
}

const SEVERITY_STYLES = {
  info: { bg: "bg-accent/10", border: "border-accent/30", icon: Info, iconColor: "text-accent" },
  warning: { bg: "bg-amber-500/10", border: "border-amber-500/30", icon: AlertTriangle, iconColor: "text-amber-500" },
  success: { bg: "bg-green-500/10", border: "border-green-500/30", icon: CheckCircle2, iconColor: "text-green-500" },
};

export function AnnouncementBanner() {
  const { token } = useAuth();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  useEffect(() => {
    if (!token) return;
    fetch("/api/announcements", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : []))
      .then((body) => setAnnouncements(body ?? []))
      .catch(() => {});
  }, [token]);

  const dismiss = async (id: string) => {
    setAnnouncements((prev) => prev.filter((a) => a.id !== id));
    try {
      await fetch(`/api/announcements/${id}/dismiss`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // Non-fatal — worst case it reappears next load, not dangerous.
    }
  };

  if (announcements.length === 0) return null;

  // Show only the single most recent one at a time, to avoid stacking up
  // the top of the screen — dismissing it reveals the next, if any.
  const current = announcements[0];
  const style = SEVERITY_STYLES[current.severity] ?? SEVERITY_STYLES.info;
  const Icon = style.icon;

  return (
    <div className={`mx-4 mt-3 rounded-2xl border ${style.bg} ${style.border} p-3 flex items-start gap-2.5`}>
      <Icon size={16} className={`${style.iconColor} shrink-0 mt-0.5`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{current.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{current.body}</p>
      </div>
      <button onClick={() => dismiss(current.id)} className="shrink-0 text-muted-foreground hover:text-foreground">
        <X size={14} />
      </button>
    </div>
  );
}
