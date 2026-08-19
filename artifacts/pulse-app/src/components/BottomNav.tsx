import { ReactNode, useState, useEffect, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { Compass, Search, Mail, Heart, HeartHandshake, SlidersHorizontal } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useInvites } from "@/contexts/InvitesContext";

const INDICATOR_POLL_INTERVAL_MS = 45_000;

function InvitesIcon({ size }: { size: number }) {
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <Mail size={size} />
      <Heart
        size={size * 0.42}
        className="fill-current absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
      />
    </div>
  );
}

export function BottomNav() {
  const [location] = useLocation();
  const { token } = useAuth();
  const [hasMatchIndicator, setHasMatchIndicator] = useState(false);
  const { invitesCount } = useInvites();

  const fetchIndicatorStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/matches/indicator-status", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const body = await res.json();
      setHasMatchIndicator(!!body.indicator);
    } catch {
      // Silent — non-critical background fetch.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Poll periodically (with jitter — see SparksContext.tsx for why),
  // plus refetch on route change — e.g. after visiting Matches (which
  // clears the "new" state server-side), the dot should disappear as
  // soon as you navigate away, not wait a full polling interval.
  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    const JITTER_MS = 15_000;

    const scheduleNext = () => {
      const jitter = (Math.random() - 0.5) * JITTER_MS;
      timeoutId = setTimeout(async () => {
        if (cancelled) return;
        await fetchIndicatorStatus();
        if (!cancelled) scheduleNext();
      }, INDICATOR_POLL_INTERVAL_MS + jitter);
    };

    fetchIndicatorStatus();
    scheduleNext();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchIndicatorStatus, location]);

  return (
    <nav className="fixed bottom-0 w-full max-w-[430px] bg-background/80 backdrop-blur-xl border-t border-border z-50 px-4 py-4 flex items-center justify-between">
      <NavItem href="/discover" icon={<Compass size={22} />} active={location === "/discover"} label="Discover" />
      <NavItem href="/search" icon={<Search size={22} />} active={location === "/search"} label="Search" />
      <NavItem
        href="/invites"
        icon={<InvitesIcon size={22} />}
        active={location === "/invites"}
        label="Invites"
        badge={invitesCount > 0 ? invitesCount : undefined}
      />
      <NavItem
        href="/matches"
        icon={<HeartHandshake size={22} />}
        active={location.startsWith("/matches")}
        label="Matches"
        showDot={hasMatchIndicator}
      />
      <NavItem href="/preferences" icon={<SlidersHorizontal size={22} />} active={location === "/preferences"} label="Preferences" />
    </nav>
  );
}

function NavItem({
  href,
  icon,
  active,
  label,
  badge,
  showDot,
}: {
  href: string;
  icon: ReactNode;
  active: boolean;
  label: string;
  badge?: number;
  showDot?: boolean;
}) {
  return (
    <Link href={href} className={`flex flex-col items-center gap-1 transition-colors ${active ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}>
      <div className={`relative ${active ? "text-primary" : ""}`}>
        {icon}
        {badge !== undefined && (
          <span className="absolute -top-1.5 -right-2.5 min-w-[18px] h-[18px] px-1 rounded-full bg-secondary text-[9px] font-bold flex items-center justify-center text-foreground/80 border border-border">
            {badge > 999 ? "999+" : badge}
          </span>
        )}
        {showDot && (
          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-primary border-2 border-background" />
        )}
      </div>
      <span className="text-[10px] font-medium">{label}</span>
    </Link>
  );
}
