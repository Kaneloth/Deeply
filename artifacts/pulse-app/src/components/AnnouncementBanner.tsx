import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Capacitor } from "@capacitor/core";
import { useAuth } from "@/contexts/AuthContext";
import { X, Info, AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";

interface Announcement {
  id: string;
  title: string;
  body: string;
  severity: "info" | "warning" | "success";
  action_link?: string | null;
}

const SEVERITY_STYLES = {
  info: { bg: "bg-accent/10", border: "border-accent/30", icon: Info, iconColor: "text-accent" },
  warning: { bg: "bg-amber-500/10", border: "border-amber-500/30", icon: AlertTriangle, iconColor: "text-amber-500" },
  success: { bg: "bg-green-500/10", border: "border-green-500/30", icon: CheckCircle2, iconColor: "text-green-500" },
};

export function AnnouncementBanner() {
  const { token } = useAuth();
  const [, setLocation] = useLocation();
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
      {current.action_link ? (
        <button
          onClick={async () => {
            // Dismisses exactly like the X button does (same backend
            // call, same permanence) before navigating — someone who's
            // already acted on the call-to-action shouldn't keep seeing
            // the same banner reappear on whatever screen they land on
            // next, since AnnouncementBanner renders at the app-shell
            // level and would otherwise still be showing the identical,
            // now-redundant announcement there too.
            dismiss(current.id);

            // Play Store links specifically need the market:// URI
            // scheme on native, not a regular https:// URL opened via a
            // browser — confirmed real bug otherwise: Google's own Play
            // Store web page detects when it's loaded inside an
            // embedded WebView (rather than a genuine standalone
            // browser or the actual Play Store app) and bounces back to
            // whatever app opened it. market:// bypasses the web/
            // browser layer entirely, directly triggering Android's own
            // "open in Play Store app" intent instead of trying to load
            // a web page at all. Only valid on native Android with the
            // Play Store app installed — falls back to the regular
            // https:// handling below on web, where market:// wouldn't
            // be understood at all.
            const playStoreMatch = current.action_link!.match(/play\.google\.com\/store\/apps\/details\?id=([\w.]+)/);
            if (playStoreMatch && Capacitor.getPlatform() === "android") {
              window.location.href = `market://details?id=${playStoreMatch[1]}`;
              return;
            }

            // Any other external link — needs a real browser, not
            // wouter's own internal router (setLocation would just try,
            // and fail, to interpret a full URL as an in-app route).
            // Capacitor's Browser plugin has a web-compatible
            // implementation too (opens a new tab under the hood
            // there), unlike some native-only plugins used elsewhere in
            // this app, so no platform check is needed here.
            if (current.action_link!.startsWith("https://")) {
              try {
                const { Browser } = await import("@capacitor/browser");
                await Browser.open({ url: current.action_link! });
              } catch {
                // Fallback if the plugin itself fails for any reason —
                // still gets the person to the destination.
                window.open(current.action_link!, "_blank");
              }
            } else {
              setLocation(current.action_link!);
            }
          }}
          className="min-w-0 flex-1 flex items-center gap-1.5 text-left"
        >
          <span className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{current.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{current.body}</p>
          </span>
          <ChevronRight size={16} className="shrink-0 text-muted-foreground" />
        </button>
      ) : (
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{current.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{current.body}</p>
        </div>
      )}
      <button onClick={() => dismiss(current.id)} className="shrink-0 text-muted-foreground hover:text-foreground">
        <X size={14} />
      </button>
    </div>
  );
}
