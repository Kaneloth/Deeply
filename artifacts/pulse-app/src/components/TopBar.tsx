import { useState, useRef, useEffect, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { User, Settings, LogOut, Bell, Shuffle, Heart } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useDiscoverControls } from "@/contexts/DiscoverControlsContext";

const UNREAD_POLL_INTERVAL_MS = 45_000;

export function TopBar() {
  const [location, setLocation] = useLocation();
  const { logout, token } = useAuth();
  const { controls } = useDiscoverControls();
  const [showMenu, setShowMenu] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showMenu]);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications/unread-count", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const body = await res.json();
      setUnreadCount(body.count ?? 0);
    } catch {
      // Silent — non-critical background fetch.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Poll periodically while the app is open, plus refetch whenever the
  // route changes (e.g. coming back from the notifications page itself).
  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, UNREAD_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchUnreadCount, location]);

  return (
    <div
      className="sticky top-0 z-40 flex items-center justify-between bg-background/90 backdrop-blur-xl border-b border-border px-4 shrink-0"
      style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)", paddingBottom: "12px" }}
    >
      <img src="/deeply-logo.png" alt="Deeply" className="h-10 w-auto" />
      <div className="flex items-center gap-2">
        {/* Discover-only controls — controls is null on every page other
            than Discover (DiscoverPage registers/clears it via
            DiscoverControlsContext), so this renders nothing anywhere
            else without any route-checking here at all. Styled as
            circular icon buttons with corner badges, matching the bell
            button right next to it, rather than the wider pill style
            these used when they lived inline on the Discover page
            itself — this bar is tight, so compact matters more here. */}
        {controls && (
          <>
            <button
              onClick={controls.onReshuffle}
              disabled={controls.isReshuffling}
              title={controls.reshuffleStatus?.isFree ? "Reshuffle (free)" : "Reshuffle"}
              className="relative w-10 h-10 rounded-full flex items-center justify-center border transition-colors bg-card/80 backdrop-blur text-foreground border-card-border hover:border-primary/50 disabled:opacity-60"
            >
              <Shuffle size={16} className={controls.isReshuffling ? "animate-spin" : ""} />
              {controls.reshuffleStatus?.isFree && !controls.isReshuffling && (
                <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-primary border border-background" />
              )}
            </button>

            {controls.invitesCount > 0 && (
              <Link
                href="/invites"
                title={`${controls.invitesCount} invite${controls.invitesCount === 1 ? "" : "s"}`}
                className={`relative w-10 h-10 rounded-full flex items-center justify-center border transition-colors ${
                  location === "/invites"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card/80 backdrop-blur text-foreground border-card-border hover:border-primary/50"
                }`}
              >
                <Heart size={16} className="fill-current" />
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                  {controls.invitesCount > 9 ? "9+" : controls.invitesCount}
                </span>
              </Link>
            )}
          </>
        )}

        <button
          onClick={() => setLocation("/notifications")}
          className={`relative w-10 h-10 rounded-full flex items-center justify-center border transition-colors ${
            location === "/notifications"
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-card/80 backdrop-blur text-foreground border-card-border hover:border-primary/50"
          }`}
        >
          <Bell size={18} />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>

        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setShowMenu((v) => !v)}
            className={`w-10 h-10 rounded-full flex items-center justify-center border transition-colors ${
              showMenu || location === "/profile"
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card/80 backdrop-blur text-foreground border-card-border hover:border-primary/50"
            }`}
          >
            <User size={18} />
          </button>
          {showMenu && (
            <div className="absolute right-0 mt-2 w-44 bg-card border border-card-border rounded-xl shadow-xl overflow-hidden z-40">
              <Link
                href="/profile"
                onClick={() => setShowMenu(false)}
                className="flex items-center gap-2.5 px-4 py-3 text-sm font-medium text-foreground hover:bg-secondary transition-colors"
              >
                <User size={16} />
                Profile
              </Link>
              <Link
                href="/settings"
                onClick={() => setShowMenu(false)}
                className="flex items-center gap-2.5 px-4 py-3 text-sm font-medium text-foreground hover:bg-secondary transition-colors border-t border-border"
              >
                <Settings size={16} />
                Settings
              </Link>
              <button
                onClick={() => {
                  setShowMenu(false);
                  logout();
                }}
                className="w-full flex items-center gap-2.5 px-4 py-3 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors border-t border-border"
              >
                <LogOut size={16} />
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
