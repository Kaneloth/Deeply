import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  X, Users, Flag, Coins, Megaphone, LayoutDashboard, Loader2, Search,
  Ban, ShieldOff, Crown, Plus, Trash2, CheckCircle2, XCircle, ChevronLeft,
  ChevronRight,
} from "lucide-react";

type Section = "overview" | "reports" | "users" | "sparks" | "announcements";
type AdminScope = "manage_reports" | "manage_users" | "manage_sparks" | "view_analytics";

const SECTIONS: { key: Section; label: string; icon: any; scope: AdminScope }[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard, scope: "view_analytics" },
  { key: "reports", label: "Reports", icon: Flag, scope: "manage_reports" },
  { key: "users", label: "Users", icon: Users, scope: "manage_users" },
  { key: "sparks", label: "Sparks", icon: Coins, scope: "manage_sparks" },
  { key: "announcements", label: "Announcements", icon: Megaphone, scope: "manage_users" },
];

const MODERATION_REASONS = [
  "Fraudulent activity",
  "Fake or duplicate account",
  "Harassment or abusive behavior",
  "Violation of Terms of Service",
  "Safety concern reported by another user",
  "Other",
];

const ALL_SCOPES: { value: AdminScope; label: string }[] = [
  { value: "manage_reports", label: "Manage Reports" },
  { value: "manage_users", label: "Manage Users" },
  { value: "manage_sparks", label: "Manage Sparks" },
  { value: "view_analytics", label: "View Analytics" },
];

interface AdminAccess {
  isAdmin: boolean;
  isSuperAdmin: boolean;
  scopes: AdminScope[];
}

export function AdminDashboard({ access, onClose }: { access: AdminAccess; onClose: () => void }) {
  const { token } = useAuth();
  const { toast } = useToast();

  const availableSections = SECTIONS.filter((s) => access.isSuperAdmin || access.scopes.includes(s.scope));
  const [section, setSection] = useState<Section>(availableSections[0]?.key ?? "overview");

  return (
    <div className="fixed inset-0 z-[200] bg-background flex flex-col">
      <div className="w-full max-w-[430px] mx-auto h-full flex flex-col overflow-hidden">
        <header className="flex-none flex items-center justify-between px-4 pt-12 pb-4 border-b border-card-border bg-card/90 backdrop-blur-xl">
          <h1 className="font-['Syne'] font-bold text-xl">Admin Dashboard</h1>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center">
            <X size={16} />
          </button>
        </header>

        <div className="flex-none flex gap-2 px-4 py-3 overflow-x-auto no-scrollbar border-b border-card-border">
          {availableSections.map((s) => (
            <button
              key={s.key}
              onClick={() => setSection(s.key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-colors shrink-0 ${
                section === s.key ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
              }`}
            >
              <s.icon size={13} />
              {s.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {section === "overview" && <OverviewSection token={token} />}
          {section === "reports" && <ReportsSection token={token} toast={toast} />}
          {section === "users" && <UsersSection token={token} toast={toast} isSuperAdmin={access.isSuperAdmin} />}
          {section === "sparks" && <SparksSection token={token} toast={toast} />}
          {section === "announcements" && <AnnouncementsSection token={token} toast={toast} />}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Overview
// ============================================================
function OverviewSection({ token }: { token: string | null }) {
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/overview", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => setStats(body))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <CenteredLoader />;
  if (!stats) return <EmptyNote text="Could not load stats." />;

  const cards = [
    { label: "Total Users", value: stats.totalUsers, icon: Users },
    { label: "Banned", value: stats.bannedUsers, icon: Ban },
    { label: "Suspended", value: stats.suspendedUsers, icon: ShieldOff },
    { label: "Pending Reports", value: stats.pendingReports, icon: Flag },
    { label: "Total Matches", value: stats.totalMatches, icon: Users },
    { label: "Messages Sent", value: stats.totalMessages, icon: Megaphone },
    { label: "Sparks Granted", value: stats.sparksGranted, icon: Coins },
    { label: "Sparks Consumed", value: stats.sparksConsumed, icon: Coins },
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="bg-card border border-card-border rounded-2xl p-4">
          <c.icon size={18} className="text-muted-foreground mb-2" />
          <p className="text-2xl font-bold font-['Syne']">{c.value?.toLocaleString?.() ?? c.value}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{c.label}</p>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Reports
// ============================================================
function ReportsSection({ token, toast }: { token: string | null; toast: any }) {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<string | null>(null);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/reports", { headers: { Authorization: `Bearer ${token}` } });
      const body = await res.json();
      if (res.ok) setReports(body ?? []);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const finalize = async (report: any, action: "resolve" | "dismiss") => {
    setProcessingId(report.id);
    try {
      const res = await fetch(`/api/admin/reports/${report.id}/${action}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ notes: notes[report.id] }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Failed (${res.status})`);
      }
      toast({ title: action === "resolve" ? "Report resolved" : "Report dismissed" });
      setReports((prev) => prev.filter((r) => r.id !== report.id));
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to update report.",
        variant: "destructive",
      });
    } finally {
      setProcessingId(null);
    }
  };

  const banReported = async (report: any) => {
    setProcessingId(report.id);
    try {
      const res = await fetch(`/api/admin/users/${report.reported_id}/ban`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason: `Reported: ${report.reason}` }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Failed (${res.status})`);
      }
      toast({ title: `${report.reported?.name ?? "User"} banned` });
      await finalize(report, "resolve");
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to ban user.",
        variant: "destructive",
      });
      setProcessingId(null);
    }
  };

  if (loading) return <CenteredLoader />;
  if (reports.length === 0) return <EmptyNote text="No pending reports." />;

  return (
    <div className="space-y-3">
      {reports.map((r) => (
        <div key={r.id} className="bg-card border border-card-border rounded-2xl p-4">
          <p className="text-sm">
            <span className="font-semibold">{r.reporter?.name ?? "Unknown"}</span>
            <span className="text-muted-foreground"> reported </span>
            <span className="font-semibold">{r.reported?.name ?? "Unknown"}</span>
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">{new Date(r.created_at).toLocaleString()}</p>
          <div className="mt-2 px-3 py-2 rounded-xl bg-secondary/60 text-xs">
            <p className="font-semibold mb-1">{r.reason}</p>
            <p className="text-muted-foreground whitespace-pre-wrap">{r.details}</p>
          </div>
          {r.screenshot_urls?.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {r.screenshot_urls.map((url: string) => (
                <img
                  key={url}
                  src={url}
                  alt=""
                  onClick={() => setPreview(url)}
                  className="w-16 h-16 object-cover rounded-lg border border-card-border cursor-pointer"
                />
              ))}
            </div>
          )}
          <Input
            placeholder="Internal notes (optional)..."
            value={notes[r.id] ?? ""}
            onChange={(e) => setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
            className="mt-2 h-9 text-xs bg-background border-card-border rounded-lg"
          />
          <div className="flex gap-2 mt-2">
            <button
              disabled={processingId === r.id}
              onClick={() => finalize(r, "resolve")}
              className="flex-1 h-9 rounded-lg text-xs font-medium border border-green-500/30 text-green-500 bg-green-500/10 disabled:opacity-50"
            >
              Resolve
            </button>
            <button
              disabled={processingId === r.id}
              onClick={() => finalize(r, "dismiss")}
              className="flex-1 h-9 rounded-lg text-xs font-medium border border-card-border text-muted-foreground disabled:opacity-50"
            >
              Dismiss
            </button>
            <button
              disabled={processingId === r.id}
              onClick={() => banReported(r)}
              className="flex-1 h-9 rounded-lg text-xs font-medium border border-destructive/30 text-destructive disabled:opacity-50"
            >
              Ban
            </button>
          </div>
        </div>
      ))}

      {preview && (
        <div className="fixed inset-0 z-[300] bg-black/80 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <img src={preview} alt="" className="max-w-full max-h-[85vh] rounded-xl object-contain" />
        </div>
      )}
    </div>
  );
}

// ============================================================
// Users
// ============================================================
function UsersSection({ token, toast, isSuperAdmin }: { token: string | null; toast: any; isSuperAdmin: boolean }) {
  const [users, setUsers] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (search.trim()) params.set("search", search.trim());
      if (filter !== "all") params.set("filter", filter);
      const res = await fetch(`/api/admin/users?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Failed to load users (${res.status})`);
      setUsers(body.users ?? []);
      setTotal(body.total ?? 0);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to load users.",
        variant: "destructive",
      });
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [token, page, search, filter, toast]);

  useEffect(() => {
    const t = setTimeout(fetchUsers, 300);
    return () => clearTimeout(t);
  }, [fetchUsers]);

  const totalPages = Math.max(1, Math.ceil(total / 25));

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search by name..."
          className="w-full h-10 pl-9 pr-3 rounded-xl bg-card border border-card-border text-sm outline-none"
        />
      </div>
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {["all", "banned", "suspended", "verified", "admins"].map((f) => (
          <button
            key={f}
            onClick={() => {
              setFilter(f);
              setPage(1);
            }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap shrink-0 ${
              filter === f ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
            }`}
          >
            {f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <CenteredLoader />
      ) : users.length === 0 ? (
        <EmptyNote text="No users found." />
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <button
              key={u.id}
              onClick={() => setSelected(u)}
              className="w-full flex items-center gap-3 bg-card border border-card-border rounded-xl p-3 text-left"
            >
              <div className="w-10 h-10 rounded-full bg-muted overflow-hidden shrink-0">
                {u.photo_url ? <img src={u.photo_url} alt="" className="w-full h-full object-cover" /> : null}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">
                  {u.name}, {u.age}
                </p>
                <div className="flex gap-1 mt-0.5">
                  {u.banned && <Tag color="destructive">Banned</Tag>}
                  {u.suspended_until && new Date(u.suspended_until) > new Date() && <Tag color="amber">Suspended</Tag>}
                  {u.is_admin && <Tag color="primary">Admin</Tag>}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="p-2 rounded-lg bg-secondary disabled:opacity-40">
            <ChevronLeft size={16} />
          </button>
          <span className="text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="p-2 rounded-lg bg-secondary disabled:opacity-40">
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      {selected && (
        <UserDetailSheet
          user={selected}
          token={token}
          toast={toast}
          isSuperAdmin={isSuperAdmin}
          onClose={() => setSelected(null)}
          onUpdated={(patch) => {
            setUsers((prev) => prev.map((u) => (u.id === selected.id ? { ...u, ...patch } : u)));
            setSelected((prev: any) => ({ ...prev, ...patch }));
          }}
        />
      )}
    </div>
  );
}

function Tag({ children, color }: { children: React.ReactNode; color: "destructive" | "amber" | "primary" }) {
  const classes = {
    destructive: "bg-destructive/15 text-destructive",
    amber: "bg-amber-500/15 text-amber-500",
    primary: "bg-primary/15 text-primary",
  }[color];
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${classes}`}>{children}</span>;
}

function UserDetailSheet({
  user,
  token,
  toast,
  isSuperAdmin,
  onClose,
  onUpdated,
}: {
  user: any;
  token: string | null;
  toast: any;
  isSuperAdmin: boolean;
  onClose: () => void;
  onUpdated: (patch: any) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [banReason, setBanReason] = useState("");
  const [suspendDays, setSuspendDays] = useState("7");
  const [suspendReason, setSuspendReason] = useState("");
  const [sparksAmount, setSparksAmount] = useState("50");
  const [scopes, setScopes] = useState<AdminScope[]>(user.admin_scopes ?? []);

  const isSuspended = user.suspended_until && new Date(user.suspended_until) > new Date();

  const call = async (path: string, body?: any) => {
    setBusy(true);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const responseBody = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(responseBody.error ?? "Action failed");
      return responseBody;
    } finally {
      setBusy(false);
    }
  };

  const handleBan = async () => {
    try {
      if (user.banned) {
        await call(`/api/admin/users/${user.id}/unban`);
        onUpdated({ banned: false, ban_reason: null });
        toast({ title: "User unbanned" });
        return;
      }
      if (!banReason) {
        toast({ title: "Pick a reason first", variant: "destructive" });
        return;
      }
      await call(`/api/admin/users/${user.id}/ban`, { reason: banReason });
      onUpdated({ banned: true, ban_reason: banReason });
      toast({ title: "User banned" });
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Action failed.", variant: "destructive" });
    }
  };

  const handleSuspend = async () => {
    if (!suspendReason) {
      toast({ title: "Pick a reason first", variant: "destructive" });
      return;
    }
    try {
      const result = await call(`/api/admin/users/${user.id}/suspend`, {
        days: parseInt(suspendDays, 10) || 1,
        reason: suspendReason,
      });
      onUpdated({ suspended_until: result.suspended_until, suspension_reason: suspendReason });
      toast({ title: "User suspended" });
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to suspend user.", variant: "destructive" });
    }
  };

  const handleUnsuspend = async () => {
    try {
      await call(`/api/admin/users/${user.id}/unsuspend`);
      onUpdated({ suspended_until: null, suspension_reason: null });
      toast({ title: "Suspension lifted" });
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to lift suspension.", variant: "destructive" });
    }
  };

  const handleSparks = async (sign: 1 | -1) => {
    const amount = (parseInt(sparksAmount, 10) || 0) * sign;
    if (!amount) return;
    try {
      const result = await call(`/api/admin/users/${user.id}/sparks`, { amount, description: "Admin adjustment" });
      onUpdated({ free_sparks_balance: result.balance });
      toast({ title: `Balance updated to ${result.balance}` });
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to adjust balance.", variant: "destructive" });
    }
  };

  const handleGrantScopes = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/grant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email: user.email, scopes }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to update admin access");
      onUpdated({ is_admin: scopes.length > 0, admin_scopes: scopes });
      toast({ title: scopes.length > 0 ? "Admin access updated" : "Admin access revoked" });
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[250] bg-black/60 flex items-end" onClick={onClose}>
      <div
        className="w-full max-w-[430px] mx-auto bg-card rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-['Syne'] font-bold text-lg">{user.name}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-1 text-xs mb-4">
          <Row label="Age" value={user.age} />
          <Row label="City" value={user.city} />
          <Row label="Sparks Balance" value={(user.free_sparks_balance ?? 0) + (user.paid_sparks_balance ?? 0)} />
          {user.ban_reason && <Row label="Ban Reason" value={user.ban_reason} />}
          {user.suspension_reason && <Row label="Suspension Reason" value={user.suspension_reason} />}
        </div>

        <div className="space-y-4">
          {/* Ban */}
          <div className="space-y-2">
            {!user.banned && (
              <select
                value={banReason}
                onChange={(e) => setBanReason(e.target.value)}
                className="w-full h-10 rounded-xl bg-background border border-card-border text-xs px-3"
              >
                <option value="">Select ban reason...</option>
                {MODERATION_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            )}
            <button
              disabled={busy}
              onClick={handleBan}
              className={`w-full h-10 rounded-xl text-xs font-semibold disabled:opacity-50 ${
                user.banned ? "bg-destructive text-destructive-foreground" : "border border-destructive/30 text-destructive"
              }`}
            >
              {user.banned ? "Unban User" : "Ban User"}
            </button>
          </div>

          {/* Suspend */}
          {!user.banned && (
            <div className="space-y-2 border-t border-border pt-4">
              {isSuspended ? (
                <button disabled={busy} onClick={handleUnsuspend} className="w-full h-10 rounded-xl text-xs font-semibold border border-amber-500/30 text-amber-500">
                  Lift Suspension
                </button>
              ) : (
                <>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      value={suspendDays}
                      onChange={(e) => setSuspendDays(e.target.value)}
                      className="w-20 h-10 text-xs bg-background border-card-border rounded-xl"
                    />
                    <select
                      value={suspendReason}
                      onChange={(e) => setSuspendReason(e.target.value)}
                      className="flex-1 h-10 rounded-xl bg-background border border-card-border text-xs px-3"
                    >
                      <option value="">Select reason...</option>
                      {MODERATION_REASONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button disabled={busy} onClick={handleSuspend} className="w-full h-10 rounded-xl text-xs font-semibold border border-amber-500/30 text-amber-500 disabled:opacity-50">
                    Suspend ({suspendDays} days)
                  </button>
                </>
              )}
            </div>
          )}

          {/* Sparks */}
          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-xs font-medium text-muted-foreground">Adjust Sparks</p>
            <div className="flex gap-2">
              <Input
                type="number"
                value={sparksAmount}
                onChange={(e) => setSparksAmount(e.target.value)}
                className="flex-1 h-10 text-xs bg-background border-card-border rounded-xl"
              />
              <button disabled={busy} onClick={() => handleSparks(1)} className="h-10 px-4 rounded-xl text-xs font-semibold border border-card-border disabled:opacity-50">
                Add
              </button>
              <button disabled={busy} onClick={() => handleSparks(-1)} className="h-10 px-4 rounded-xl text-xs font-semibold border border-card-border disabled:opacity-50">
                Subtract
              </button>
            </div>
          </div>

          {/* Admin scopes — super-admin only */}
          {isSuperAdmin && (
            <div className="space-y-2 border-t border-border pt-4">
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Crown size={13} /> Admin Access
              </p>
              <div className="space-y-1.5">
                {ALL_SCOPES.map((s) => (
                  <label key={s.value} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={scopes.includes(s.value)}
                      onChange={(e) =>
                        setScopes((prev) => (e.target.checked ? [...prev, s.value] : prev.filter((x) => x !== s.value)))
                      }
                    />
                    {s.label}
                  </label>
                ))}
              </div>
              <button disabled={busy} onClick={handleGrantScopes} className="w-full h-10 rounded-xl text-xs font-semibold bg-gradient-accent border-0 disabled:opacity-50">
                Save Admin Access
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: any }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex justify-between border-b border-border/50 py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right max-w-[60%] truncate">{value}</span>
    </div>
  );
}

// ============================================================
// Sparks
// ============================================================
function SparksSection({ token, toast }: { token: string | null; toast: any }) {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch("/api/admin/sparks/transactions", { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `Failed to load transactions (${res.status})`);
        setTransactions(body ?? []);
      })
      .catch((err) => {
        toast({
          title: "Error",
          description: err instanceof Error ? err.message : "Failed to load transactions.",
          variant: "destructive",
        });
        setTransactions([]);
      })
      .finally(() => setLoading(false));
  }, [token, toast]);

  if (loading) return <CenteredLoader />;
  if (transactions.length === 0) return <EmptyNote text="No transactions yet." />;

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground mb-1">Most recent 200 transactions across all users. To adjust a specific user's balance, find them in Users.</p>
      {transactions.map((t) => (
        <div key={t.id} className="flex items-center justify-between bg-card border border-card-border rounded-xl p-3">
          <div className="min-w-0">
            <p className="text-xs font-medium truncate">{t.description || t.type}</p>
            <p className="text-[10px] text-muted-foreground">{new Date(t.created_at).toLocaleString()}</p>
          </div>
          <span className={`text-sm font-bold shrink-0 ${t.amount >= 0 ? "text-green-500" : "text-destructive"}`}>
            {t.amount >= 0 ? "+" : ""}
            {t.amount}
          </span>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Announcements
// ============================================================
function AnnouncementsSection({ token, toast }: { token: string | null; toast: any }) {
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [severity, setSeverity] = useState("info");

  const fetchAnnouncements = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/announcements", { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (res.ok) setAnnouncements(data ?? []);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchAnnouncements();
  }, [fetchAnnouncements]);

  const create = async () => {
    if (!title.trim() || !body.trim()) {
      toast({ title: "Title and message are both required", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/admin/announcements", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title: title.trim(), body: body.trim(), severity, targetType: "all" }),
      });
      if (!res.ok) throw new Error("Failed");
      toast({ title: "Announcement posted" });
      setTitle("");
      setBody("");
      setSeverity("info");
      fetchAnnouncements();
    } catch {
      toast({ title: "Error", description: "Failed to create announcement.", variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (a: any) => {
    setProcessingId(a.id);
    try {
      await fetch(`/api/admin/announcements/${a.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ isActive: !a.is_active }),
      });
      setAnnouncements((prev) => prev.map((x) => (x.id === a.id ? { ...x, is_active: !x.is_active } : x)));
    } finally {
      setProcessingId(null);
    }
  };

  const remove = async (a: any) => {
    setProcessingId(a.id);
    try {
      await fetch(`/api/admin/announcements/${a.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setAnnouncements((prev) => prev.filter((x) => x.id !== a.id));
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-card border border-card-border rounded-2xl p-4 space-y-3">
        <p className="text-sm font-semibold">New Announcement</p>
        <Input
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="h-10 text-sm bg-background border-card-border rounded-xl"
        />
        <textarea
          placeholder="Message"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          className="w-full rounded-xl bg-background border border-card-border text-sm p-3 resize-none outline-none"
        />
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          className="h-10 rounded-xl bg-background border border-card-border text-sm px-3"
        >
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="success">Success</option>
        </select>
        <button
          onClick={create}
          disabled={creating}
          className="flex items-center gap-1.5 h-10 px-4 rounded-xl text-sm font-semibold bg-gradient-accent text-white disabled:opacity-50"
        >
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Post to All Users
        </button>
      </div>

      {loading ? (
        <CenteredLoader />
      ) : announcements.length === 0 ? (
        <EmptyNote text="No announcements yet." />
      ) : (
        <div className="space-y-2">
          {announcements.map((a) => (
            <div key={a.id} className="bg-card border border-card-border rounded-xl p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold truncate">{a.title}</p>
                  <Tag color={a.is_active ? "primary" : "amber"}>{a.is_active ? "Active" : "Inactive"}</Tag>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{a.body}</p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button disabled={processingId === a.id} onClick={() => toggleActive(a)} className="p-1.5 rounded-lg bg-secondary">
                  {a.is_active ? <XCircle size={14} /> : <CheckCircle2 size={14} className="text-green-500" />}
                </button>
                <button disabled={processingId === a.id} onClick={() => remove(a)} className="p-1.5 rounded-lg bg-secondary text-destructive">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CenteredLoader() {
  return (
    <div className="flex justify-center py-16">
      <Loader2 size={24} className="animate-spin text-muted-foreground" />
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return <p className="text-center text-sm text-muted-foreground py-12 border border-dashed border-card-border rounded-2xl">{text}</p>;
}
