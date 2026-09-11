import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Camera, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

/** Shown at the AppShell level (same placement as UpdateBanner/
 *  AnnouncementBanner) so it's visible regardless of which screen
 *  someone's actually on. Deliberately NOT a one-time notification or
 *  announcement someone can dismiss and forget — this checks the
 *  person's own current profile state directly, so it automatically
 *  stops appearing the moment they actually add a photo, and (by
 *  design) reappears on every fresh app open until they do, rather
 *  than relying on them remembering a message they saw once.
 *
 *  The "dismiss" (X) button only hides it for the current session —
 *  deliberately not persisted to localStorage, since permanently
 *  suppressing this would defeat the entire point: someone dismissing
 *  it once shouldn't mean they never see it again despite still having
 *  no photo. */
export function PhotoNudgeBanner() {
  const { token } = useAuth();
  const [location, setLocation] = useLocation();
  const [needsPhoto, setNeedsPhoto] = useState(false);
  const [dismissedThisSession, setDismissedThisSession] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch("/api/profile/me", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((profile) => {
        if (!cancelled) setNeedsPhoto(!!profile && !profile.photo_url);
      })
      .catch(() => {
        // Non-fatal — this is a soft nudge, not something that should
        // ever surface an error to the user.
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Already on the Profile page (where they'd actually add a photo) —
  // no point nudging someone toward the exact screen they're already on.
  if (!needsPhoto || dismissedThisSession || location === "/profile") return null;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-primary/10 border-b border-primary/20">
      <Camera size={18} className="text-primary shrink-0" />
      <p className="flex-1 text-xs text-foreground min-w-0">
        Add a profile photo — profiles without one get far fewer matches.{" "}
        <button onClick={() => setLocation("/profile")} className="text-primary font-semibold underline underline-offset-2">
          Add now
        </button>
      </p>
      <button onClick={() => setDismissedThisSession(true)} aria-label="Dismiss" className="text-muted-foreground shrink-0">
        <X size={16} />
      </button>
    </div>
  );
}
