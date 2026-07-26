import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { LogOut } from "lucide-react";

export default function SettingsPage() {
  const { logout } = useAuth();

  return (
    <div className="min-h-full px-6 pb-6 pt-6 bg-background">
      <PageHeader title="Settings" backTo="/profile" />

      <div className="space-y-6">
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
