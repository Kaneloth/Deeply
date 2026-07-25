import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Flame, MessageCircle, Zap, User } from "lucide-react";
import { useSparks } from "@/contexts/SparksContext";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [location] = useLocation();
  const { balance } = useSparks();

  // Hide nav on auth and onboarding routes
  const hideNav = location === "/" || location === "/onboarding";
  if (hideNav) {
    return (
      <div className="w-full max-w-[430px] mx-auto min-h-[100dvh] bg-background relative overflow-hidden flex flex-col">
        {children}
      </div>
    );
  }

  return (
    <div className="w-full max-w-[430px] mx-auto min-h-[100dvh] bg-background relative flex flex-col overflow-hidden">
      <main className="flex-1 overflow-y-auto pb-20 no-scrollbar">
        {children}
      </main>
      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 w-full max-w-[430px] bg-background/80 backdrop-blur-xl border-t border-border z-50 px-6 py-4 flex items-center justify-between">
        <NavItem href="/discover" icon={<Flame size={24} />} active={location === "/discover"} label="Discover" />
        <NavItem href="/matches" icon={<MessageCircle size={24} />} active={location.startsWith("/matches")} label="Matches" />
        <NavItem
          href="/sparks"
          icon={<Zap size={24} />}
          active={location === "/sparks"}
          label="Sparks"
          badge={balance !== null ? balance : undefined}
        />
        <NavItem href="/profile" icon={<User size={24} />} active={location === "/profile"} label="Profile" />
      </nav>
    </div>
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
