import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { AdminDashboard } from "@/components/AdminDashboard";
import { Loader2 } from "lucide-react";

export default function AdminPage() {
  const { token } = useAuth();
  const [, setLocation] = useLocation();
  const [access, setAccess] = useState<{ isAdmin: boolean; isSuperAdmin: boolean; scopes: string[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/me", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!body?.isAdmin) {
          setLocation("/settings");
          return;
        }
        setAccess(body);
      })
      .catch(() => setLocation("/settings"))
      .finally(() => setLoading(false));
  }, [token, setLocation]);

  if (loading) {
    return (
      <div className="min-h-full flex items-center justify-center py-24">
        <Loader2 size={24} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!access) return null;

  return <AdminDashboard access={access as any} onClose={() => setLocation("/settings")} />;
}
