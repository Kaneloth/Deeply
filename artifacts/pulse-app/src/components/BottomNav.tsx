import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Compass, Search, Mail, Heart, HeartHandshake, Zap } from "lucide-react";
import { useSparks } from "@/contexts/SparksContext";

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
  const { balance } = useSparks();

  return (
    <nav className="fixed bottom-0 w-full max-w-[430px] bg-background/80 backdrop-blur-xl border-t border-border z-50 px-4 py-4 flex items-center justify-between">
      <NavItem href="/discover" icon={<Compass size={22} />} active={location === "/discover"} label="Discover" />
      <NavItem href="/search" icon={<Search size={22} />} active={location === "/search"} label="Search" />
      <NavItem href="/invites" icon={<InvitesIcon size={22} />} active={location === "/invites"} label="Invites" />
      <NavItem href="/matches" icon={<HeartHandshake size={22} />} active={location.startsWith("/matches")} label="Matches" />
      <NavItem
        href="/sparks"
        icon={<Zap size={22} />}
        active={location === "/sparks"}
        label="Sparks"
        badge={balance !== null ? balance : undefined}
      />
    </nav>
  );
}

function NavItem({
  href,
  icon,
  active,
  label,
  badge,
}: {
  href: string;
  icon: ReactNode;
  active: boolean;
  label: string;
  badge?: number;
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
      </div>
      <span className="text-[10px] font-medium">{label}</span>
    </Link>
  );
}
