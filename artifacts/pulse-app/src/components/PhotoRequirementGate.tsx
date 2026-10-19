import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

interface PhotoStatus {
  qualifying_count: number;
  required: number;
  met: boolean;
}

/** Wraps Discover and Search. Renders the page as normal, but while the
 *  user has fewer than the required number of real photos/clips of
 *  themselves, covers it with a "complete your profile" overlay. The server
 *  enforces the same rule independently (empty results, swipes refused), so
 *  this is the explanation, not the lock. Fails open on a network error —
 *  no overlay — since the server is the real gate. */
export function PhotoRequirementGate({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<PhotoStatus | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch("/api/profile/me/photo-status", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled && body) setStatus(body);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Mount-only, like the app's other page-level fetches: token refreshes
    // must not re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const blocked = status !== null && !status.met;

  return (
    <>
      {children}
      {blocked && status && (
        <div className="fixed inset-0 z-[90] bg-background/95 backdrop-blur-md flex items-center justify-center p-6">
          <div className="w-full max-w-sm text-center">
            <div className="w-16 h-16 rounded-full bg-gradient-accent flex items-center justify-center mx-auto mb-5">
              <Camera size={28} className="text-white" />
            </div>
            <h2 className="text-2xl font-['Syne'] font-bold mb-2">Complete your profile</h2>
            <p className="text-sm text-muted-foreground mb-5">
              Add at least {status.required} real photos or clips of yourself to start browsing. Photos of objects,
              scenery or pets are fine to keep on your profile, but they don't count toward the {status.required}.
              Duplicates only count once.
            </p>
            <div className="flex justify-center gap-2 mb-6">
              {Array.from({ length: status.required }).map((_, i) => (
                <div
                  key={i}
                  className={`h-2 flex-1 rounded-full ${i < status.qualifying_count ? "bg-primary" : "bg-secondary"}`}
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground mb-6">
              {Math.min(status.qualifying_count, status.required)} of {status.required} added
            </p>
            <Button
              onClick={() => setLocation("/profile")}
              className="w-full h-14 rounded-xl text-lg font-semibold bg-gradient-accent border-0 shadow-[0_4px_20px_rgba(225,29,72,0.3)]"
            >
              Add photos
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
