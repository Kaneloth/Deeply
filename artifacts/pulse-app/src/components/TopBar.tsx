import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { User, Settings, LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { AppBrand } from "@/components/AppBrand";

export function TopBar() {
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
