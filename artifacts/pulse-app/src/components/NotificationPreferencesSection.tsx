import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Check, Bell } from "lucide-react";

interface NotifPrefs {
  notify_messages: boolean;
  notify_matches: boolean;
  notify_likes: boolean;
  notify_profile_views: boolean;
}

const ITEMS: { key: keyof NotifPrefs; label: string }[] = [
  { key: "notify_messages", label: "💬 Someone messages you" },
  { key: "notify_matches", label: "❤️ You get a new match" },
  { key: "notify_likes", label: "🔥 Someone likes your profile" },
  { key: "notify_profile_views", label: "👀 Someone views your profile" },
];

/** Self-contained — fetches its own current values and saves each toggle
 *  instantly on tap, independent of ProfilePage's own "unsaved changes"
 *  save flow for the rest of the profile fields. Notification
 *  preferences are settings, not profile content, so they shouldn't
 *  require a separate deliberate Save action. */
export function NotificationPreferencesSection() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<NotifPrefs | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const fetchPrefs = useCallback(async () => {
    try {
      const res = await fetch("/api/profile/me", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const body = await res.json();
      setPrefs({
        notify_messages: body.notify_messages ?? true,
        notify_matches: body.notify_matches ?? true,
        notify_likes: body.notify_likes ?? true,
        notify_profile_views: body.notify_profile_views ?? true,
      });
    } catch {
      // Silent — section just won't render if this fails.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    fetchPrefs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = async (key: keyof NotifPrefs) => {
    if (!prefs) return;
    const next = !prefs[key];
    setPrefs((prev) => (prev ? { ...prev, [key]: next } : prev));
    setSavingKey(key);
    try {
      const res = await fetch("/api/profile/me", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ [key]: next }),
      });
      if (!res.ok) throw new Error("Failed to update");
    } catch {
      // Revert on failure.
      setPrefs((prev) => (prev ? { ...prev, [key]: !next } : prev));
      toast({ title: "Error", description: "Failed to update notification preference.", variant: "destructive" });
    } finally {
      setSavingKey(null);
    }
  };

  if (!prefs) return null;

  return (
    <div className="bg-card border border-card-border rounded-2xl p-5 mb-8">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-gradient-accent flex items-center justify-center text-white shrink-0">
          <Bell size={18} />
        </div>
        <div>
          <h3 className="font-['Syne'] font-bold text-base">Notifications</h3>
          <p className="text-xs text-muted-foreground">Choose what you'd like to hear about</p>
        </div>
      </div>

      <div className="space-y-2">
        {ITEMS.map((item) => {
          const value = prefs[item.key];
          return (
            <button
              key={item.key}
              onClick={() => toggle(item.key)}
              disabled={savingKey === item.key}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-colors disabled:opacity-60 ${
                value ? "bg-primary/10 border-primary" : "bg-secondary/40 border-card-border"
              }`}
            >
              <span className="text-sm">{item.label}</span>
              <div
                className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                  value ? "bg-primary border-primary" : "border-muted-foreground"
                }`}
              >
                {value && <Check size={12} className="text-primary-foreground" />}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
