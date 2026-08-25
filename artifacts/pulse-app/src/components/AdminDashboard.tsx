import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  X, Users, Flag, Coins, Megaphone, LayoutDashboard, Loader2, Search,
  Ban, ShieldOff, Crown, Plus, Trash2, CheckCircle2, XCircle, ChevronLeft,
  ChevronRight, ShieldCheck, AlertTriangle, RefreshCw, Sliders,
} from "lucide-react";

type Section = "overview" | "reports" | "users" | "sparks" | "economy" | "announcements" | "verification";
type AdminScope = "manage_reports" | "manage_users" | "manage_sparks" | "view_analytics";

const SECTIONS: { key: Section; label: string; icon: any; scope: AdminScope }[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard, scope: "view_analytics" },
  { key: "reports", label: "Reports", icon: Flag, scope: "manage_reports" },
  { key: "users", label: "Users", icon: Users, scope: "manage_users" },
  { key: "verification", label: "Verification", icon: ShieldCheck, scope: "manage_users" },
  { key: "sparks", label: "Sparks", icon: Coins, scope: "manage_sparks" },
  { key: "economy", label: "Pricing", icon: Sliders, scope: "manage_sparks" },
  { key: "announcements", label: "Announcements", icon: Megaphone, scope: "manage_users" },
];

const NAV_GROUPS: { label: string; keys: Section[] }[] = [
  { label: "Overview", keys: ["overview"] },
  { label: "People & Safety", keys: ["reports", "users", "verification"] },
  { label: "Money", keys: ["sparks", "economy"] },
  { label: "Communication", keys: ["announcements"] },
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
  const currentSection = availableSections.find((s) => s.key === section);

  const renderContent = () => (
    <>
      {section === "overview" && <OverviewSection token={token} toast={toast} />}
      {section === "reports" && <ReportsSection token={token} toast={toast} />}
      {section === "users" && <UsersSection token={token} toast={toast} isSuperAdmin={access.isSuperAdmin} />}
      {section === "sparks" && <SparksSection token={token} toast={toast} />}
      {section === "economy" && <EconomySection token={token} toast={toast} />}
      {section === "verification" && <AdminVerificationSection token={token} toast={toast} />}
      {section === "announcements" && <AnnouncementsSection token={token} toast={toast} />}
    </>
  );

  return (
    <div className="fixed inset-0 z-[200] bg-background flex flex-col lg:flex-row">
      <aside className="hidden lg:flex lg:flex-col w-64 shrink-0 border-r border-card-border bg-card">
        <div className="px-5 py-5 border-b border-card-border flex items-center gap-2.5">
          <ShieldCheck size={22} className="text-primary shrink-0" />
          <span className="font-['Syne'] font-bold text-lg">Admin</span>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {NAV_GROUPS.map((group) => {
            const items = availableSections.filter((s) => group.keys.includes(s.key));
            if (items.length === 0) return null;
            return (
              <div key={group.label}>
                <p className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {items.map((s) => (
                    <button
                      key={s.key}
                      onClick={() => setSection(s.key)}
                      className={`flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                        section === s.key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                      }`}
                    >
                      <s.icon size={16} className="shrink-0" />
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="px-3 py-4 border-t border-card-border">
          <button
            onClick={onClose}
            className="flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <ChevronLeft size={16} className="shrink-0" />
            Back to Settings
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div className="lg:hidden flex flex-col">
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
        </div>

        <header className="hidden lg:flex items-center justify-between px-6 py-4 border-b border-card-border bg-card shrink-0">
          <h1 className="font-['Syne'] font-bold text-xl">{currentSection?.label ?? "Admin"}</h1>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center hover:bg-secondary/70 transition-colors">
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-[430px] mx-auto lg:max-w-4xl w-full p-4 lg:p-6">{renderContent()}</div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Overview
// ============================================================
function OverviewSection({ token, toast }: { token: string | null; toast: any }) {
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [incognitoEnabled, setIncognitoEnabled] = useState(false);
  const [isTogglingIncognito, setIsTogglingIncognito] = useState(false);
  const [dealbreakersEnabled, setDealbreakersEnabled] = useState(false);
  const [isTogglingDealbreakers, setIsTogglingDealbreakers] = useState(false);

  useEffect(() => {
    fetch("/api/admin/overview", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => setStats(body))
      .finally(() => setLoading(false));
    fetch("/api/app-settings", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (body) {
          setIncognitoEnabled(body.incognito_enabled === true);
          setDealbreakersEnabled(body.dealbreakers_enabled === true);
        }
      })
      .catch(() => {});
  }, [token]);

  const toggleIncognitoFeature = async () => {
    const next = !incognitoEnabled;
    setIsTogglingIncognito(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ key: "incognito_enabled", value: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to update setting");
      setIncognitoEnabled(next);
      toast({ title: next ? "Incognito mode enabled platform-wide" : "Incognito mode disabled platform-wide" });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to update setting.",
        variant: "destructive",
      });
    } finally {
      setIsTogglingIncognito(false);
    }
  };

  const toggleDealbreakersFeature = async () => {
    const next = !dealbreakersEnabled;
    setIsTogglingDealbreakers(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ key: "dealbreakers_enabled", value: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to update setting");
      setDealbreakersEnabled(next);
      toast({ title: next ? "Dealbreakers enabled platform-wide" : "Dealbreakers disabled platform-wide" });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to update setting.",
        variant: "destructive",
      });
    } finally {
      setIsTogglingDealbreakers(false);
    }
  };

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
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="bg-card border border-card-border rounded-2xl p-4">
            <c.icon size={18} className="text-muted-foreground mb-2" />
            <p className="text-2xl font-bold font-['Syne']">{c.value?.toLocaleString?.() ?? c.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 pl-1">Platform Settings</p>
        <button
          onClick={toggleIncognitoFeature}
          disabled={isTogglingIncognito}
          className="w-full flex items-center justify-between bg-card border border-card-border rounded-2xl p-4 disabled:opacity-60"
        >
          <div className="text-left">
            <p className="text-sm font-medium">Incognito Mode</p>
            <p className="text-xs text-muted-foreground">
              {incognitoEnabled ? "Enabled — users can go incognito (5 Sparks/day)" : "Disabled — hidden from all users"}
            </p>
          </div>
          <div className={`h-6 w-10 rounded-full relative transition-colors shrink-0 ${incognitoEnabled ? "bg-primary" : "bg-secondary"}`}>
            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${incognitoEnabled ? "right-1" : "left-1"}`} />
          </div>
        </button>

        <button
          onClick={toggleDealbreakersFeature}
          disabled={isTogglingDealbreakers}
          className="w-full flex items-center justify-between bg-card border border-card-border rounded-2xl p-4 disabled:opacity-60 mt-2"
        >
          <div className="text-left">
            <p className="text-sm font-medium">Dealbreakers</p>
            <p className="text-xs text-muted-foreground">
              {dealbreakersEnabled
                ? "Enabled — users can hard-filter Discover by lifestyle preferences"
                : "Disabled — dealbreaker checkboxes hidden from all users"}
            </p>
          </div>
          <div className={`h-6 w-10 rounded-full relative transition-colors shrink-0 ${dealbreakersEnabled ? "bg-primary" : "bg-secondary"}`}>
            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${dealbreakersEnabled ? "right-1" : "left-1"}`} />
          </div>
        </button>
      </div>
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
// Identity Verification queue — free "photo" (selfie vs gallery) and
// paid "id" (front/back/selfie) submissions reviewed together.
// ============================================================
const VERIFICATION_REJECTION_REASONS = [
  "Selfie doesn't match profile photos",
  "Selfie doesn't match ID photo",
  "Document photo too blurry to read",
  "Document appears altered or fake",
  "Name/details don't match profile",
  "Other",
];

function AdminVerificationSection({ token, toast }: { token: string | null; toast: any }) {
  const [queue, setQueue] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectReasonOther, setRejectReasonOther] = useState("");

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/verification-queue", { headers: { Authorization: `Bearer ${token}` } });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load queue");
      setQueue(body ?? []);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to load verification queue.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [token, toast]);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  const approve = async (submission: any) => {
    setProcessingId(submission.id);
    try {
      const res = await fetch(`/api/admin/verification/${submission.id}/approve`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to approve");
      }
      toast({ title: `${submission.verification_type === "photo" ? "Photo" : "ID"} verification approved` });
      setQueue((prev) => prev.filter((s) => s.id !== submission.id));
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to approve.", variant: "destructive" });
    } finally {
      setProcessingId(null);
    }
  };

  const reject = async (submission: any) => {
    const finalReason = rejectReason === "Other" ? rejectReasonOther.trim() : rejectReason;
    if (!finalReason) {
      toast({ title: "Select or enter a reason first", variant: "destructive" });
      return;
    }
    setProcessingId(submission.id);
    try {
      const res = await fetch(`/api/admin/verification/${submission.id}/reject`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason: finalReason }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to reject");
      }
      toast({ title: "Submission rejected" });
      setQueue((prev) => prev.filter((s) => s.id !== submission.id));
      setRejectingId(null);
      setRejectReason("");
      setRejectReasonOther("");
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to reject.", variant: "destructive" });
    } finally {
      setProcessingId(null);
    }
  };

  if (loading) return <CenteredLoader />;
  if (queue.length === 0) return <EmptyNote text="No pending verifications." />;

  return (
    <div className="space-y-4">
      {queue.map((s) => (
        <div key={s.id} className="bg-card border border-card-border rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-semibold">{s.user?.name ?? "Unknown user"}</p>
              <p className="text-[10px] text-muted-foreground">{new Date(s.created_at).toLocaleString()}</p>
            </div>
            <Tag color={s.verification_type === "id" ? "primary" : "amber"}>
              {s.verification_type === "id" ? "ID Verification (R99)" : "Photo Verification (Free)"}
            </Tag>
          </div>

          <p className="text-xs font-medium text-muted-foreground mb-1.5">Existing profile photos (compare against)</p>
          <div className="flex gap-2 mb-3 overflow-x-auto no-scrollbar">
            {(s.gallery_photos ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No existing gallery photos</p>
            ) : (
              s.gallery_photos.map((url: string) => (
                <img
                  key={url}
                  src={url}
                  alt=""
                  onClick={() => setPreview(url)}
                  className="w-16 h-16 object-cover rounded-lg border border-card-border shrink-0 cursor-pointer"
                />
              ))
            )}
          </div>

          <p className="text-xs font-medium text-muted-foreground mb-1.5">Submitted documents</p>
          <div className="flex gap-2 mb-3">
            {s.selfie_url && (
              <div className="text-center">
                <img
                  src={s.selfie_url}
                  alt="Selfie"
                  onClick={() => setPreview(s.selfie_url)}
                  className="w-20 h-20 object-cover rounded-lg border border-card-border cursor-pointer"
                />
                <p className="text-[10px] text-muted-foreground mt-1">Selfie</p>
              </div>
            )}
            {s.id_front_url && (
              <div className="text-center">
                <img
                  src={s.id_front_url}
                  alt="ID Front"
                  onClick={() => setPreview(s.id_front_url)}
                  className="w-20 h-20 object-cover rounded-lg border border-card-border cursor-pointer"
                />
                <p className="text-[10px] text-muted-foreground mt-1">ID Front</p>
              </div>
            )}
            {s.id_back_url && (
              <div className="text-center">
                <img
                  src={s.id_back_url}
                  alt="ID Back"
                  onClick={() => setPreview(s.id_back_url)}
                  className="w-20 h-20 object-cover rounded-lg border border-card-border cursor-pointer"
                />
                <p className="text-[10px] text-muted-foreground mt-1">ID Back</p>
              </div>
            )}
          </div>

          {rejectingId === s.id ? (
            <div className="space-y-2 border-t border-border pt-3">
              <select
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="w-full h-9 rounded-lg bg-background border border-card-border text-xs px-2"
              >
                <option value="">Select a reason...</option>
                {VERIFICATION_REJECTION_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              {rejectReason === "Other" && (
                <Input
                  placeholder="Type the reason..."
                  value={rejectReasonOther}
                  onChange={(e) => setRejectReasonOther(e.target.value)}
                  className="h-9 text-xs bg-background border-card-border rounded-lg"
                />
              )}
              <div className="flex gap-2">
                <button
                  disabled={processingId === s.id}
                  onClick={() => reject(s)}
                  className="flex-1 h-9 rounded-lg text-xs font-semibold bg-destructive text-destructive-foreground disabled:opacity-50"
                >
                  Confirm Rejection
                </button>
                <button
                  onClick={() => {
                    setRejectingId(null);
                    setRejectReason("");
                    setRejectReasonOther("");
                  }}
                  className="flex-1 h-9 rounded-lg text-xs font-medium border border-card-border"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2 border-t border-border pt-3">
              <button
                disabled={processingId === s.id}
                onClick={() => approve(s)}
                className="flex-1 h-9 rounded-lg text-xs font-semibold border border-green-500/30 text-green-500 bg-green-500/10 disabled:opacity-50"
              >
                Approve
              </button>
              <button
                disabled={processingId === s.id}
                onClick={() => setRejectingId(s.id)}
                className="flex-1 h-9 rounded-lg text-xs font-semibold border border-destructive/30 text-destructive disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          )}
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
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {loading ? "Loading..." : `${total.toLocaleString()} user${total === 1 ? "" : "s"}`}
        </p>
        <button
          onClick={fetchUsers}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

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
        <>
          <div className="lg:hidden space-y-2">
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

          <div className="hidden lg:block border border-card-border rounded-xl overflow-hidden bg-card">
            <table className="w-full text-sm">
              <thead className="bg-secondary/60">
                <tr>
                  <th className="p-3 text-left font-medium text-muted-foreground">User</th>
                  <th className="p-3 text-left font-medium text-muted-foreground">Age</th>
                  <th className="p-3 text-left font-medium text-muted-foreground">City</th>
                  <th className="p-3 text-left font-medium text-muted-foreground">Sparks</th>
                  <th className="p-3 text-left font-medium text-muted-foreground">Status</th>
                  <th className="p-3 text-right font-medium text-muted-foreground">Joined</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr
                    key={u.id}
                    onClick={() => setSelected(u)}
                    className="border-t border-card-border hover:bg-secondary/40 cursor-pointer transition-colors"
                  >
                    <td className="p-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-muted overflow-hidden shrink-0">
                          {u.photo_url ? <img src={u.photo_url} alt="" className="w-full h-full object-cover" /> : null}
                        </div>
                        <span className="font-medium">{u.name}</span>
                      </div>
                    </td>
                    <td className="p-3 text-muted-foreground">{u.age}</td>
                    <td className="p-3 text-muted-foreground">{u.city || "—"}</td>
                    <td className="p-3 text-muted-foreground">{(u.free_sparks_balance ?? 0) + (u.paid_sparks_balance ?? 0)}</td>
                    <td className="p-3">
                      <div className="flex gap-1">
                        {u.banned && <Tag color="destructive">Banned</Tag>}
                        {u.suspended_until && new Date(u.suspended_until) > new Date() && <Tag color="amber">Suspended</Tag>}
                        {u.is_admin && <Tag color="primary">Admin</Tag>}
                        {!u.banned && !(u.suspended_until && new Date(u.suspended_until) > new Date()) && !u.is_admin && (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                    </td>
                    <td className="p-3 text-right text-muted-foreground text-xs">
                      {u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
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
  const [showEditProfile, setShowEditProfile] = useState(false);

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

        {!showEditProfile && (
          <button
            onClick={() => setShowEditProfile(true)}
            className="w-full h-10 rounded-xl text-xs font-semibold border border-card-border mb-4"
          >
            Edit Profile
          </button>
        )}

        {showEditProfile ? (
          <EditProfileForm
            user={user}
            token={token}
            toast={toast}
            onCancel={() => setShowEditProfile(false)}
            onSaved={(patch) => {
              onUpdated(patch);
              setShowEditProfile(false);
            }}
          />
        ) : (
        <div className="space-y-4">
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
        )}
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

// Plain <input>/<textarea> (not <select>) are used deliberately for
// enum-like fields below (gender, relationship_type, education, etc.)
// rather than dropdowns — several of these columns have Postgres CHECK
// constraints with specific allowed values that aren't fully documented
// here, and a guessed-wrong dropdown option would submit an invalid
// value and fail. A pre-filled text field showing the user's CURRENT
// value is always safe, and an admin editing "on behalf of" a stuck
// user will usually only need to fix one or two fields, not pick from
// scratch.
//
// Defined at MODULE scope, not inside EditProfileForm — this used to be
// declared as a const inside EditProfileForm's function body, which
// meant a brand new Field function/component type was created on every
// single render. React reconciles by comparing element types at each
// position in the tree; a genuinely different component type there
// forces React to unmount the previous instance (including its actual
// <input> DOM node) and mount a fresh one, rather than just updating
// the existing node's value. Since every keystroke calls setForm (which
// re-renders EditProfileForm, which redefined Field yet again), this
// happened on EVERY character typed — destroying and recreating the
// input's DOM node each time, which drops focus, which is exactly what
// dismisses a mobile on-screen keyboard mid-word. Moving Field out to
// module scope means it's defined once, so React sees the same
// component type across renders and simply updates the existing node's
// value in place — focus (and the keyboard) now stays put across
// keystrokes. Takes value/onChange as explicit props instead of closing
// over EditProfileForm's local form/set, since a module-level component
// can't reach into another function's local variables.
function Field({
  label,
  type = "text",
  value,
  onChange,
}: {
  label: string;
  type?: string;
  value: string | number;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div>
      <label className="text-[10px] font-medium text-muted-foreground">{label}</label>
      <input
        type={type}
        value={value}
        onChange={onChange}
        className="w-full h-9 mt-0.5 rounded-lg bg-background border border-card-border text-xs px-2.5 outline-none"
      />
    </div>
  );
}

function EditProfileForm({
  user,
  token,
  toast,
  onCancel,
  onSaved,
}: {
  user: any;
  token: string | null;
  toast: any;
  onCancel: () => void;
  onSaved: (patch: any) => void;
}) {
  const [saving, setSaving] = useState(false);
  // Starts null (not pre-filled from the `user` prop) — that prop comes
  // from the paginated admin user LIST, which only ever fetches a
  // handful of summary fields (name, age, city, photo, ban/suspend
  // status, Sparks balance...) for performance, since it renders for
  // every row on every page. It never included bio, gender, any
  // lifestyle field, or any of the pref_* fields at all — so every one
  // of those was always undefined on `user`, making every field in this
  // form appear blank regardless of what the person had actually filled
  // in. Fetching the full profile fresh, specifically now that the
  // admin has opened this form for one specific person, is the correct
  // scope for that cost — the list itself stays fast for every row.
  const [form, setForm] = useState<Record<string, any> | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoadingProfile(true);
    fetch(`/api/profile/${user.id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Failed to load full profile");
        if (cancelled) return;
        setForm({
          name: body.name ?? "",
          bio: body.bio ?? "",
          city: body.city ?? "",
          birthday: body.birthday ?? "",
          personality_tags: (body.personality_tags ?? []).join(", "),
          gender: body.gender ?? "",
          looking_for_gender: body.looking_for_gender ?? "",
          distance_km: body.distance_km ?? "",
          relationship_type: body.relationship_type ?? "",
          dating_intentions: (body.dating_intentions ?? []).join(", "),
          num_kids: body.num_kids ?? "",
          family_plans: body.family_plans ?? "",
          smoking_status: body.smoking_status ?? "",
          drinking_status: body.drinking_status ?? "",
          vaping_status: body.vaping_status ?? "",
          has_tattoos: body.has_tattoos ?? "",
          pets: body.pets ?? "",
          height_cm: body.height_cm ?? "",
          activity_level: body.activity_level ?? "",
          nightlife_frequency: body.nightlife_frequency ?? "",
          languages_spoken: (body.languages_spoken ?? []).join(", "),
          languages_other: body.languages_other ?? "",
          love_language: body.love_language ?? "",
          education: body.education ?? "",
          pref_num_kids: body.pref_num_kids ?? "",
          pref_family_plans: body.pref_family_plans ?? "",
          pref_smoking_status: body.pref_smoking_status ?? "",
          pref_drinking_status: body.pref_drinking_status ?? "",
          pref_vaping_status: body.pref_vaping_status ?? "",
          pref_has_tattoos: body.pref_has_tattoos ?? "",
          pref_pets: body.pref_pets ?? "",
          pref_activity_level: body.pref_activity_level ?? "",
          pref_height_min_cm: body.pref_height_min_cm ?? "",
          pref_height_max_cm: body.pref_height_max_cm ?? "",
          pref_nightlife_frequency: body.pref_nightlife_frequency ?? "",
          pref_age_min: body.pref_age_min ?? "",
          pref_age_max: body.pref_age_max ?? "",
          dealbreakers: (body.dealbreakers ?? []).join(", "),
        });
      })
      .catch((err) => {
        if (cancelled) return;
        toast({
          title: "Error",
          description: err instanceof Error ? err.message : "Failed to load this user's full profile.",
          variant: "destructive",
        });
        onCancel();
      })
      .finally(() => {
        if (!cancelled) setLoadingProfile(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id, token]);

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => (f ? { ...f, [key]: e.target.value } : f));

  const toArray = (s: string) =>
    s.trim() === "" ? [] : s.split(",").map((x) => x.trim()).filter(Boolean);
  const toNumOrUndefined = (s: string) => (s === "" ? undefined : Number(s));

  const handleSave = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        bio: form.bio,
        city: form.city,
        birthday: form.birthday,
        personality_tags: toArray(form.personality_tags),
        gender: form.gender,
        looking_for_gender: form.looking_for_gender,
        distance_km: toNumOrUndefined(form.distance_km),
        relationship_type: form.relationship_type,
        dating_intentions: toArray(form.dating_intentions),
        num_kids: form.num_kids,
        family_plans: form.family_plans,
        smoking_status: form.smoking_status,
        drinking_status: form.drinking_status,
        vaping_status: form.vaping_status,
        has_tattoos: form.has_tattoos,
        pets: form.pets,
        height_cm: toNumOrUndefined(form.height_cm),
        activity_level: form.activity_level,
        nightlife_frequency: form.nightlife_frequency,
        languages_spoken: toArray(form.languages_spoken),
        languages_other: form.languages_other,
        love_language: form.love_language,
        education: form.education,
        pref_num_kids: form.pref_num_kids,
        pref_family_plans: form.pref_family_plans,
        pref_smoking_status: form.pref_smoking_status,
        pref_drinking_status: form.pref_drinking_status,
        pref_vaping_status: form.pref_vaping_status,
        pref_has_tattoos: form.pref_has_tattoos,
        pref_pets: form.pref_pets,
        pref_activity_level: form.pref_activity_level,
        pref_height_min_cm: toNumOrUndefined(form.pref_height_min_cm),
        pref_height_max_cm: toNumOrUndefined(form.pref_height_max_cm),
        pref_nightlife_frequency: form.pref_nightlife_frequency,
        pref_age_min: toNumOrUndefined(form.pref_age_min),
        pref_age_max: toNumOrUndefined(form.pref_age_max),
        dealbreakers: toArray(form.dealbreakers),
      };

      const res = await fetch(`/api/admin/users/${user.id}/profile`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to update profile");
      toast({ title: "Profile updated" });
      onSaved(body);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to update profile.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loadingProfile || !form) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground">Editing on behalf of {user.name}</p>
        <button onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground">
          ← Back
        </button>
      </div>

      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">About</p>
        <Field label="Name" value={form.name} onChange={set("name")} />
        <Field label="Birthday" type="date" value={form.birthday} onChange={set("birthday")} />
        <Field label="City" value={form.city} onChange={set("city")} />
        <div>
          <label className="text-[10px] font-medium text-muted-foreground">Bio</label>
          <textarea
            value={form.bio}
            onChange={set("bio")}
            rows={3}
            className="w-full mt-0.5 rounded-lg bg-background border border-card-border text-xs px-2.5 py-2 outline-none resize-none"
          />
        </div>
        <div>
          <label className="text-[10px] font-medium text-muted-foreground">Personality tags (comma-separated)</label>
          <input value={form.personality_tags} onChange={set("personality_tags")} className="w-full h-9 mt-0.5 rounded-lg bg-background border border-card-border text-xs px-2.5 outline-none" />
        </div>
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Dating</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Gender" value={form.gender} onChange={set("gender")} />
          <Field label="Looking for" value={form.looking_for_gender} onChange={set("looking_for_gender")} />
          <Field label="Max distance (km)" type="number" value={form.distance_km} onChange={set("distance_km")} />
          <Field label="Relationship type" value={form.relationship_type} onChange={set("relationship_type")} />
        </div>
        <div>
          <label className="text-[10px] font-medium text-muted-foreground">Dating intentions (comma-separated)</label>
          <input value={form.dating_intentions} onChange={set("dating_intentions")} className="w-full h-9 mt-0.5 rounded-lg bg-background border border-card-border text-xs px-2.5 outline-none" />
        </div>
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Lifestyle</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Kids" value={form.num_kids} onChange={set("num_kids")} />
          <Field label="Family plans" value={form.family_plans} onChange={set("family_plans")} />
          <Field label="Smoking" value={form.smoking_status} onChange={set("smoking_status")} />
          <Field label="Drinking" value={form.drinking_status} onChange={set("drinking_status")} />
          <Field label="Vaping" value={form.vaping_status} onChange={set("vaping_status")} />
          <Field label="Tattoos" value={form.has_tattoos} onChange={set("has_tattoos")} />
          <Field label="Pets" value={form.pets} onChange={set("pets")} />
          <Field label="Height (cm)" type="number" value={form.height_cm} onChange={set("height_cm")} />
          <Field label="Activity level" value={form.activity_level} onChange={set("activity_level")} />
          <Field label="Nightlife" value={form.nightlife_frequency} onChange={set("nightlife_frequency")} />
        </div>
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Language & Education</p>
        <div>
          <label className="text-[10px] font-medium text-muted-foreground">Languages spoken (comma-separated)</label>
          <input value={form.languages_spoken} onChange={set("languages_spoken")} className="w-full h-9 mt-0.5 rounded-lg bg-background border border-card-border text-xs px-2.5 outline-none" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Other language" value={form.languages_other} onChange={set("languages_other")} />
          <Field label="Love language" value={form.love_language} onChange={set("love_language")} />
          <Field label="Education" value={form.education} onChange={set("education")} />
        </div>
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Partner Preferences</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Pref. kids" value={form.pref_num_kids} onChange={set("pref_num_kids")} />
          <Field label="Pref. family plans" value={form.pref_family_plans} onChange={set("pref_family_plans")} />
          <Field label="Pref. smoking" value={form.pref_smoking_status} onChange={set("pref_smoking_status")} />
          <Field label="Pref. drinking" value={form.pref_drinking_status} onChange={set("pref_drinking_status")} />
          <Field label="Pref. vaping" value={form.pref_vaping_status} onChange={set("pref_vaping_status")} />
          <Field label="Pref. tattoos" value={form.pref_has_tattoos} onChange={set("pref_has_tattoos")} />
          <Field label="Pref. pets" value={form.pref_pets} onChange={set("pref_pets")} />
          <Field label="Pref. activity level" value={form.pref_activity_level} onChange={set("pref_activity_level")} />
          <Field label="Pref. nightlife" value={form.pref_nightlife_frequency} onChange={set("pref_nightlife_frequency")} />
          <Field label="Min height (cm)" type="number" value={form.pref_height_min_cm} onChange={set("pref_height_min_cm")} />
          <Field label="Max height (cm)" type="number" value={form.pref_height_max_cm} onChange={set("pref_height_max_cm")} />
          <Field label="Min age" type="number" value={form.pref_age_min} onChange={set("pref_age_min")} />
          <Field label="Max age" type="number" value={form.pref_age_max} onChange={set("pref_age_max")} />
        </div>
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Safety</p>
        <div>
          <label className="text-[10px] font-medium text-muted-foreground">Dealbreakers (comma-separated)</label>
          <input value={form.dealbreakers} onChange={set("dealbreakers")} className="w-full h-9 mt-0.5 rounded-lg bg-background border border-card-border text-xs px-2.5 outline-none" />
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <button onClick={onCancel} className="flex-1 h-10 rounded-xl text-xs font-semibold border border-card-border">
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 h-10 rounded-xl text-xs font-semibold bg-gradient-accent border-0 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
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
// Economy — admin-editable Sparks costs, grant amounts, and the ID
// verification fee. Each row edits independently (save one field at a
// time) rather than a single big form-wide save, so a mistake on one
// figure can't accidentally block saving a correction to another.
// ============================================================
function EconomySection({ token, toast }: { token: string | null; toast: any }) {
  const [figures, setFigures] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const fetchFigures = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/economy-config", { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `Failed to load config (${res.status})`);
        setFigures(body ?? []);
        setDrafts(Object.fromEntries((body ?? []).map((f: any) => [f.key, String(f.value)])));
      })
      .catch((err) => {
        toast({
          title: "Error",
          description: err instanceof Error ? err.message : "Failed to load pricing config.",
          variant: "destructive",
        });
      })
      .finally(() => setLoading(false));
  }, [token, toast]);

  useEffect(() => {
    fetchFigures();
  }, [fetchFigures]);

  const saveFigure = async (key: string) => {
    const raw = drafts[key];
    const value = Number(raw);
    if (!raw || Number.isNaN(value) || value < 0) {
      toast({ title: "Enter a valid non-negative number", variant: "destructive" });
      return;
    }
    setSavingKey(key);
    try {
      const res = await fetch("/api/admin/economy-config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ key, value }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to save");
      setFigures((prev) => prev.map((f) => (f.key === key ? { ...f, value } : f)));
      toast({ title: "Updated" });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to save.",
        variant: "destructive",
      });
    } finally {
      setSavingKey(null);
    }
  };

  if (loading) return <CenteredLoader />;
  if (figures.length === 0) return <EmptyNote text="No pricing config found." />;

  const groups: { title: string; keys: string[] }[] = [
    { title: "Grants", keys: ["sparks_monthly_grant", "daily_free_invites"] },
    {
      title: "Sparks Costs",
      keys: [
        "cost_super_like", "cost_undo_swipe", "cost_reveal_invites", "cost_message_before_match",
        "cost_reshuffle", "cost_send_message", "cost_unsend_message", "cost_unlock_read_receipts",
        "cost_extra_invite", "cost_extra_photo", "cost_boost", "cost_incognito_per_day", "cost_reveal_profile_views",
      ],
    },
    { title: "Real-Money Fees", keys: ["id_verification_fee_zar"] },
    {
      title: "Sparks Bundle Prices (ZAR)",
      keys: [
        "sparks_price_starter", "sparks_price_popular", "sparks_price_date_night",
        "sparks_price_power_user", "sparks_price_deep_connection",
      ],
    },
  ];

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground -mt-1">
        Changes take effect within 30 seconds platform-wide. Values reflect what's currently live in the database.
      </p>
      {groups.map((group) => (
        <div key={group.title}>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 pl-1">{group.title}</p>
          {group.title === "Sparks Bundle Prices (ZAR)" && (
            <p className="text-xs text-amber-600 dark:text-amber-500 mb-2 pl-1">
              These only control what PayFast charges on web and what's displayed in the app. Google Play has its
              own separate price for each bundle, set directly in Play Console — changing a price here does NOT
              update Google Play, and the two are never automatically synced. Update both places when changing a
              Sparks price.
            </p>
          )}
          <div className="space-y-2">
            {group.keys
              .map((key) => figures.find((f) => f.key === key))
              .filter(Boolean)
              .map((f: any) => {
                const isDirty = drafts[f.key] !== String(f.value);
                return (
                  <div key={f.key} className="bg-card border border-card-border rounded-2xl p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{f.label}</p>
                        <p className="text-xs text-muted-foreground">{f.description}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Input
                          type="number"
                          min={0}
                          value={drafts[f.key] ?? ""}
                          onChange={(e) => setDrafts((prev) => ({ ...prev, [f.key]: e.target.value }))}
                          className="w-20 h-9 text-sm bg-background border-card-border rounded-lg text-right"
                        />
                        <span className="text-xs text-muted-foreground w-10">{f.unit}</span>
                        <Button
                          size="sm"
                          disabled={!isDirty || savingKey === f.key}
                          onClick={() => saveFigure(f.key)}
                          className="h-9 text-xs"
                        >
                          {savingKey === f.key ? <Loader2 size={13} className="animate-spin" /> : "Save"}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}
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
