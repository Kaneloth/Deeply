import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useTextSize, type TextSize } from "@/contexts/TextSizeContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/PageHeader";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { AdminDashboard } from "@/components/AdminDashboard";
import { Shield } from "lucide-react";
import {
  LogOut, Moon, Sun, Type, Lock, HelpCircle, LifeBuoy, Trash2,
  ChevronRight, AlertTriangle, Eye, EyeOff, Mail, EyeOff as IncognitoIcon,
  ShieldOff, X as XIcon,
} from "lucide-react";

const TEXT_SIZE_OPTIONS: { label: string; value: TextSize }[] = [
  { label: "Normal", value: "normal" },
  { label: "Large", value: "large" },
  { label: "X-Large", value: "xlarge" },
];

const FAQ_ITEMS = [
  {
    q: "What are Sparks?",
    a: "Sparks are Deeply's in-app currency. You get 300 free every month, and they're used for things like sending messages, Super Invites, undoing a swipe, and seeing who invited you.",
  },
  {
    q: "How do daily free invites work?",
    a: "You get 15 free invites every day, resetting at midnight your local time. Unused ones don't carry over. After 15, extra invites cost 5 Sparks each.",
  },
  {
    q: "Can I undo a swipe?",
    a: "Yes — tap the Undo button on the Discover screen to bring back your last swipe. It costs 5 Sparks and only works if that swipe hasn't already resulted in a match.",
  },
  {
    q: "How do I delete a photo or video?",
    a: "Go to Profile, tap the ✕ on any photo or clip in your gallery to remove it.",
  },
  {
    q: "Is my information safe?",
    a: "We never share your exact location, and you control what's visible on your profile. You can block or report anyone from a chat or their profile.",
  },
  {
    q: "How do I delete my account?",
    a: "Go to Settings → Delete Account. This permanently removes your profile and all your data — it can't be undone.",
  },
];

export default function SettingsPage() {
  const { token, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { textSize, setTextSize } = useTextSize();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [email, setEmail] = useState<string | null>(null);
  const [adminAccess, setAdminAccess] = useState<{ isAdmin: boolean; isSuperAdmin: boolean; scopes: string[] } | null>(null);
  const [showAdminDashboard, setShowAdminDashboard] = useState(false);

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const [showFaq, setShowFaq] = useState(false);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);

  const [showDeleteSection, setShowDeleteSection] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const [isIncognito, setIsIncognito] = useState(false);
  const [isTogglingIncognito, setIsTogglingIncognito] = useState(false);

  interface BlockedEntry {
    id: string;
    blocked_user: { id: string; name: string; photo_url: string | null } | null;
    created_at: string;
  }
  const [showBlockedList, setShowBlockedList] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState<BlockedEntry[]>([]);
  const [isLoadingBlocked, setIsLoadingBlocked] = useState(false);
  const [blockActionId, setBlockActionId] = useState<string | null>(null);

  const fetchBlockedUsers = async () => {
    setIsLoadingBlocked(true);
    try {
      const res = await fetch("/api/blocks", { headers: { Authorization: `Bearer ${token}` } });
      const body = await res.json();
      if (res.ok) setBlockedUsers(body ?? []);
    } catch {
      // Silent — non-critical.
    } finally {
      setIsLoadingBlocked(false);
    }
  };

  const handleUnblock = async (blockedUserId: string) => {
    setBlockActionId(blockedUserId);
    try {
      const res = await fetch(`/api/blocks/${blockedUserId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to unblock");
      setBlockedUsers((prev) => prev.filter((b) => b.blocked_user?.id !== blockedUserId));
      toast({ title: "Unblocked" });
    } catch {
      toast({ title: "Error", description: "Failed to unblock.", variant: "destructive" });
    } finally {
      setBlockActionId(null);
    }
  };

  const handleRemoveFromList = async (blockedUserId: string) => {
    setBlockActionId(blockedUserId);
    try {
      const res = await fetch(`/api/blocks/${blockedUserId}/remove`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to remove");
      setBlockedUsers((prev) => prev.filter((b) => b.blocked_user?.id !== blockedUserId));
    } catch {
      toast({ title: "Error", description: "Failed to remove.", variant: "destructive" });
    } finally {
      setBlockActionId(null);
    }
  };

  const handleToggleIncognito = async () => {
    const next = !isIncognito;
    setIsTogglingIncognito(true);
    try {
      const res = await fetch("/api/profile/me", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ is_incognito: next }),
      });
      if (!res.ok) throw new Error("Failed to update");
      setIsIncognito(next);
      toast({
        title: next ? "Incognito mode on" : "Incognito mode off",
        description: next ? "You're now hidden from Discover and Search." : "You're visible in Discover and Search again.",
      });
    } catch {
      toast({ title: "Error", description: "Failed to update incognito mode.", variant: "destructive" });
    } finally {
      setIsTogglingIncognito(false);
    }
  };

  useEffect(() => {
    fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => setEmail(body?.email ?? null))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    fetch("/api/profile/me", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (body) setIsIncognito(!!body.is_incognito);
      })
      .catch(() => {});
    fetchBlockedUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    fetch("/api/admin/me", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => setAdminAccess(body))
      .catch(() => {});
  }, [token]);

  const handleChangePassword = async () => {
    setPasswordError("");
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError("Fill in all fields");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match");
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError("New password must be at least 6 characters");
      return;
    }

    setIsChangingPassword(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to update password");

      toast({ title: "Password updated" });
      setShowPasswordForm(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "Failed to update password");
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== "DELETE" || !deletePassword) return;
    setIsDeleting(true);
    try {
      const res = await fetch("/api/auth/account", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ password: deletePassword }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to delete account");
      }
      setLocation("/");
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to delete account.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="min-h-full px-6 pb-6 pt-6 bg-background">
      <PageHeader title="Settings" backTo="/profile" />

      <div className="space-y-6">
        {/* Account */}
        <div className="space-y-3">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider pl-1">Account</h3>

          {email && (
            <div className="flex items-center gap-3 bg-card border border-card-border rounded-2xl p-4">
              <Mail size={18} className="text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Signed in as</p>
                <p className="text-sm font-medium truncate">{email}</p>
              </div>
            </div>
          )}

          <div className="bg-card border border-card-border rounded-2xl p-4">
            <button
              onClick={() => setShowPasswordForm((v) => !v)}
              className="w-full flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <Lock size={18} className="text-muted-foreground" />
                <div className="text-left">
                  <p className="text-sm font-medium">Change Password</p>
                  <p className="text-xs text-muted-foreground">{showPasswordForm ? "Hide form" : "Update your password"}</p>
                </div>
              </div>
              <ChevronRight size={16} className={`text-muted-foreground transition-transform ${showPasswordForm ? "rotate-90" : ""}`} />
            </button>

            {showPasswordForm && (
              <div className="mt-4 pt-4 border-t border-border space-y-3">
                <div className="relative">
                  <Input
                    type={showCurrentPw ? "text" : "password"}
                    placeholder="Current password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="bg-background border-card-border h-11 rounded-xl pr-10"
                  />
                  <button type="button" onClick={() => setShowCurrentPw((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    {showCurrentPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <div className="relative">
                  <Input
                    type={showNewPw ? "text" : "password"}
                    placeholder="New password (6+ characters)"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="bg-background border-card-border h-11 rounded-xl pr-10"
                  />
                  <button type="button" onClick={() => setShowNewPw((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    {showNewPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <div className="relative">
                  <Input
                    type={showConfirmPw ? "text" : "password"}
                    placeholder="Confirm new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="bg-background border-card-border h-11 rounded-xl pr-10"
                  />
                  <button type="button" onClick={() => setShowConfirmPw((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    {showConfirmPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {passwordError && <p className="text-xs text-destructive">{passwordError}</p>}
                <Button onClick={handleChangePassword} disabled={isChangingPassword} className="w-full h-11 rounded-xl bg-gradient-accent border-0">
                  {isChangingPassword ? "Updating..." : "Update Password"}
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Appearance */}
        <div className="space-y-3">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider pl-1">Appearance</h3>

          <button
            onClick={toggleTheme}
            className="w-full flex items-center justify-between bg-card border border-card-border rounded-2xl p-4"
          >
            <div className="flex items-center gap-3">
              {theme === "dark" ? <Moon size={18} className="text-muted-foreground" /> : <Sun size={18} className="text-muted-foreground" />}
              <div className="text-left">
                <p className="text-sm font-medium">{theme === "dark" ? "Dark Mode" : "Light Mode"}</p>
                <p className="text-xs text-muted-foreground">Tap to switch to {theme === "dark" ? "light" : "dark"}</p>
              </div>
            </div>
            <div className={`h-6 w-10 rounded-full relative transition-colors ${theme === "dark" ? "bg-primary" : "bg-secondary"}`}>
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${theme === "dark" ? "right-1" : "left-1"}`} />
            </div>
          </button>

          <div className="bg-card border border-card-border rounded-2xl p-4">
            <div className="flex items-center gap-3 mb-3">
              <Type size={18} className="text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Text Size</p>
                <p className="text-xs text-muted-foreground">Adjust how large text appears</p>
              </div>
            </div>
            <div className="flex gap-2">
              {TEXT_SIZE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setTextSize(opt.value)}
                  className={`flex-1 h-9 rounded-lg text-xs font-medium border transition-colors ${
                    textSize === opt.value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground border-card-border"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Privacy & Safety */}
        <div className="space-y-3">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider pl-1">Privacy & Safety</h3>

          <button
            onClick={handleToggleIncognito}
            disabled={isTogglingIncognito}
            className="w-full flex items-center justify-between bg-card border border-card-border rounded-2xl p-4 disabled:opacity-60"
          >
            <div className="flex items-center gap-3">
              <IncognitoIcon size={18} className="text-muted-foreground" />
              <div className="text-left">
                <p className="text-sm font-medium">Incognito Mode</p>
                <p className="text-xs text-muted-foreground">
                  {isIncognito ? "Hidden from Discover & Search" : "Visible in Discover & Search"}
                </p>
              </div>
            </div>
            <div className={`h-6 w-10 rounded-full relative transition-colors ${isIncognito ? "bg-primary" : "bg-secondary"}`}>
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${isIncognito ? "right-1" : "left-1"}`} />
            </div>
          </button>

          <div className="bg-card border border-card-border rounded-2xl overflow-hidden">
            <button
              onClick={() => setShowBlockedList((v) => !v)}
              className="w-full flex items-center justify-between p-4"
            >
              <div className="flex items-center gap-3">
                <ShieldOff size={18} className="text-muted-foreground" />
                <div className="text-left">
                  <p className="text-sm font-medium">Blocked Users</p>
                  <p className="text-xs text-muted-foreground">
                    {blockedUsers.length > 0 ? `${blockedUsers.length} blocked` : "No one blocked"}
                  </p>
                </div>
              </div>
              <ChevronRight size={16} className={`text-muted-foreground transition-transform ${showBlockedList ? "rotate-90" : ""}`} />
            </button>

            {showBlockedList && (
              <div className="border-t border-border p-3 space-y-2">
                {isLoadingBlocked ? (
                  <p className="text-xs text-muted-foreground text-center py-3">Loading...</p>
                ) : blockedUsers.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-3">You haven't blocked anyone.</p>
                ) : (
                  blockedUsers.map((entry) => {
                    const user = entry.blocked_user;
                    const actioning = blockActionId === user?.id;
                    return (
                      <div key={entry.id} className="flex items-center gap-3 bg-background border border-card-border rounded-xl p-3">
                        <div className="w-9 h-9 rounded-full bg-muted overflow-hidden shrink-0">
                          {user?.photo_url ? (
                            <img src={user.photo_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-primary/20 text-primary text-xs font-bold">
                              {user?.name?.[0] ?? "?"}
                            </div>
                          )}
                        </div>
                        <p className="text-sm font-medium flex-1 min-w-0 truncate">{user?.name ?? "Unknown"}</p>
                        <div className="flex gap-1.5 shrink-0">
                          <button
                            onClick={() => user && handleUnblock(user.id)}
                            disabled={actioning}
                            className="px-2.5 py-1.5 rounded-lg bg-secondary text-xs font-medium text-foreground disabled:opacity-50"
                          >
                            Unblock
                          </button>
                          <button
                            onClick={() => user && handleRemoveFromList(user.id)}
                            disabled={actioning}
                            title="Keeps them blocked, just removes this entry"
                            className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground disabled:opacity-50"
                          >
                            <XIcon size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>

        {/* Support */}
        <div className="space-y-3">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider pl-1">Support</h3>

          <div className="bg-card border border-card-border rounded-2xl overflow-hidden">
            <button onClick={() => setShowFaq((v) => !v)} className="w-full flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <HelpCircle size={18} className="text-muted-foreground" />
                <p className="text-sm font-medium">FAQ</p>
              </div>
              <ChevronRight size={16} className={`text-muted-foreground transition-transform ${showFaq ? "rotate-90" : ""}`} />
            </button>
            {showFaq && (
              <div className="border-t border-border">
                {FAQ_ITEMS.map((item, i) => (
                  <div key={i} className="border-b border-border last:border-b-0">
                    <button
                      onClick={() => setOpenFaqIndex(openFaqIndex === i ? null : i)}
                      className="w-full flex items-center justify-between p-4 text-left"
                    >
                      <span className="text-sm font-medium pr-3">{item.q}</span>
                      <ChevronRight size={14} className={`text-muted-foreground shrink-0 transition-transform ${openFaqIndex === i ? "rotate-90" : ""}`} />
                    </button>
                    {openFaqIndex === i && (
                      <p className="text-xs text-muted-foreground px-4 pb-4 leading-relaxed">{item.a}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <a
            href="mailto:support@deeplyapp.com"
            className="flex items-center justify-between bg-card border border-card-border rounded-2xl p-4"
          >
            <div className="flex items-center gap-3">
              <LifeBuoy size={18} className="text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Contact Support</p>
                <p className="text-xs text-muted-foreground">support@deeplyapp.com</p>
              </div>
            </div>
            <ChevronRight size={16} className="text-muted-foreground" />
          </a>
        </div>

        {/* Admin — only visible if the account has any admin access */}
        {adminAccess?.isAdmin && (
          <button
            onClick={() => setShowAdminDashboard(true)}
            className="w-full flex items-center justify-between bg-card border border-primary/30 rounded-2xl p-4"
          >
            <div className="flex items-center gap-3">
              <Shield size={18} className="text-primary" />
              <div className="text-left">
                <p className="text-sm font-medium">Admin Dashboard</p>
                <p className="text-xs text-muted-foreground">
                  {adminAccess.isSuperAdmin ? "Full access" : adminAccess.scopes.join(", ").replace(/_/g, " ")}
                </p>
              </div>
            </div>
            <ChevronRight size={16} className="text-primary" />
          </button>
        )}

        {/* About */}
        <div className="bg-card border border-card-border rounded-2xl p-5">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">About</h3>
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

        {/* Danger Zone */}
        <div className="bg-card border border-destructive/30 rounded-2xl p-4">
          <button
            onClick={() => {
              setShowDeleteSection((v) => !v);
              setDeleteConfirmText("");
              setDeletePassword("");
            }}
            className="w-full flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <Trash2 size={18} className="text-destructive" />
              <div className="text-left">
                <p className="text-sm font-medium text-destructive">Delete Account</p>
                <p className="text-xs text-muted-foreground">Permanently remove all your data</p>
              </div>
            </div>
            <ChevronRight size={16} className={`text-destructive/60 transition-transform ${showDeleteSection ? "rotate-90" : ""}`} />
          </button>

          {showDeleteSection && (
            <div className="mt-4 pt-4 border-t border-destructive/20 space-y-3">
              <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                <AlertTriangle size={16} className="text-destructive shrink-0 mt-0.5" />
                <div className="text-xs text-destructive/80 space-y-1">
                  <p className="font-semibold">This cannot be undone.</p>
                  <p>Deleting your account permanently erases your profile, photos, matches, and messages.</p>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Type DELETE to confirm</label>
                <Input
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="DELETE"
                  className="bg-background border-destructive/30 h-11 rounded-xl"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Your password</label>
                <Input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Password"
                  className="bg-background border-destructive/30 h-11 rounded-xl"
                />
              </div>

              <Button
                onClick={handleDeleteAccount}
                disabled={deleteConfirmText !== "DELETE" || !deletePassword || isDeleting}
                className="w-full h-11 rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isDeleting ? "Deleting..." : "Permanently Delete My Account"}
              </Button>
            </div>
          )}
        </div>
      </div>

      {showAdminDashboard && adminAccess && (
        <AdminDashboard access={adminAccess as any} onClose={() => setShowAdminDashboard(false)} />
      )}
    </div>
  );
}
