import { ReactNode, useState, useEffect, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { Compass, Search, Mail, Heart, HeartHandshake, SlidersHorizontal } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

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
  const [invitesCount, setInvitesCount] = useState(0);

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

  // Fetched independently here, not borrowed from DiscoverPage/
  // DiscoverControlsContext — that context only holds data while
  // DiscoverPage is actually mounted, so relying on it here would make
  // this badge vanish the moment you navigate to any other tab. This
  // bar is visible everywhere, so its data needs to be too. Same
  // self-contained poll-plus-route-change-refetch pattern as the match
  // indicator right below it.
  //
  // Only new_count feeds the badge — NOT revealed.length. revealed is
  // the list of inviters already paid-for and permanently visible on
  // the Invites page; counting them here too would mean the badge never
  // goes down even after you've seen and dealt with every one of them.
  // A nav badge should mean "new/unseen", matching exactly how
  // InvitesPage.tsx itself already treats these as two separate things
  // (a "new_count" banner vs. the always-visible revealed cards).
  const fetchInvitesCount = useCallback(async () => {
    try {
      const res = await fetch("/api/discover/invites", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const body = await res.json();
      setInvitesCount(body.new_count ?? 0);
    } catch {
      // Silent — non-critical background fetch.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Poll periodically, plus refetch on route change — e.g. after
  // visiting Matches (which clears the "new" state server-side), the dot
  // should disappear as soon as you navigate away, not wait a full
  // polling interval. Same reasoning applies to invites: after visiting
  // /invites and revealing new ones, the count should update right away.
  useEffect(() => {
    fetchIndicatorStatus();
    fetchInvitesCount();
    const interval = setInterval(() => {
      fetchIndicatorStatus();
      fetchInvitesCount();
    }, INDICATOR_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchIndicatorStatus, fetchInvitesCount, location]);

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
