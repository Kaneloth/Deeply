import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { AppBrand } from "@/components/AppBrand";
import { ChevronLeft, LogOut } from "lucide-react";

export default function SettingsPage() {
  const { logout } = useAuth();

  return (
    <div className="min-h-full pb-6 bg-background">
      <header
        className="sticky top-0 z-30 flex items-center gap-3 bg-background/90 backdrop-blur-xl border-b border-border px-6 pb-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <Link href="/profile" className="w-10 h-10 flex items-center justify-center rounded-full bg-secondary text-foreground hover:bg-secondary/80 transition-colors shrink-0">
          <ChevronLeft size={22} />
        </Link>
        <AppBrand />
      </header>

      <div className="px-6 pt-8 space-y-6">
        <div className="bg-card border border-card-border rounded-2xl p-5">
          <h3 className="font-['Syne'] font-bold text-sm uppercase tracking-wider text-muted-foreground mb-1">
            About
          </h3>
          <p className="text-sm text-foreground">Deeply</p>
          <p className="text-xs text-muted-foreground mt-1">Deep connections begin with a spark.</p>
        </div>

        <Button
          onClick={logout}
          variant="outline"
          className="w-full h-12 rounded-xl border-destructive/30 text-destructive hover:bg-destructive/10 flex items-center justify-center gap-2"
        >
          <LogOut size={16} />
          Log Out
        </Button>
      </div>
    </div>
  );
}
