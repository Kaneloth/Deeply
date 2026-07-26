import { ReactNode, useState, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Flame, Search, Heart, MessageCircle, Zap, User, Settings, LogOut } from "lucide-react";
import { useSparks } from "@/contexts/SparksContext";
import { useAuth } from "@/contexts/AuthContext";
import { AppBrand } from "@/components/AppBrand";

interface AppShellProps {
  children: ReactNode;
}

function TopBar() {
  const [location] = useLocation();
  const { logout } = useAuth();
  const [showMenu, setShowMenu] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showMenu]);

  return (
    <div
      className="sticky top-0 z-40 flex items-center justify-between bg-background/90 backdrop-blur-xl border-b border-border px-4 shrink-0"
      style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)", paddingBottom: "12px" }}
    >
      <AppBrand />

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
  );
}

export function AppShell({ children }: AppShellProps) {
  const [location] = useLocation();
  const { balance } = useSparks();

  // Hide nav and top bar on auth and onboarding routes
  const hideChrome = location === "/" || location === "/onboarding";
  if (hideChrome) {
    return (
      <div className="w-full max-w-[430px] mx-auto min-h-[100dvh] bg-background relative overflow-hidden flex flex-col">
        {children}
      </div>
    );
  }

  return (
    <div className="w-full max-w-[430px] mx-auto h-[100dvh] bg-background relative flex flex-col overflow-hidden">
      <TopBar />

      <main className="flex-1 overflow-y-auto pb-20 no-scrollbar">
        {children}
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 w-full max-w-[430px] bg-background/80 backdrop-blur-xl border-t border-border z-50 px-4 py-4 flex items-center justify-between">
        <NavItem href="/discover" icon={<Flame size={22} />} active={location === "/discover"} label="Discover" />
        <NavItem href="/search" icon={<Search size={22} />} active={location === "/search"} label="Search" />
        <NavItem href="/invites" icon={<Heart size={22} />} active={location === "/invites"} label="Invites" />
        <NavItem href="/matches" icon={<MessageCircle size={22} />} active={location.startsWith("/matches")} label="Matches" />
        <NavItem
          href="/sparks"
          icon={<Zap size={22} />}
          active={location === "/sparks"}
          label="Sparks"
          badge={balance !== null ? balance : undefined}
        />
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
