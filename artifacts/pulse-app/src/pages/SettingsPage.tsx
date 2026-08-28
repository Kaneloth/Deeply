import { useState, useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { BiometricAuth, AndroidBiometryStrength } from "@aparajita/capacitor-biometric-auth";
import {
  useAuth,
  getSignInMethod,
  getCurrentRefreshToken,
  enableBiometricSignIn,
  disableBiometricSignIn,
  type SignInMethod,
} from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useTextSize, type TextSize } from "@/contexts/TextSizeContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/PageHeader";
import { useToast } from "@/hooks/use-toast";
import { useLocation, Link } from "wouter";
import { Shield } from "lucide-react";
import { PhoneVerificationFlow } from "@/components/PhoneVerificationFlow";
import {
  LogOut, Moon, Sun, Type, Lock, HelpCircle, LifeBuoy, Trash2,
  ChevronRight, AlertTriangle, Eye, EyeOff, Mail, EyeOff as IncognitoIcon,
  ShieldOff, X as XIcon, ScanEye, Send, FileText, ShieldCheck,
  Fingerprint, Loader2, Info, CheckCheck, Phone, Users,
} from "lucide-react";

// Registers biometric sign-in on this device. Native: OS-level fingerprint
// via Capacitor. Web: WebAuthn platform authenticator (Touch ID, Windows
// Hello, Android Chrome's fingerprint prompt), for browsers that support
// it. Throws with a user-facing message on failure/unavailability.
async function registerBiometric(email: string | null) {
  if (Capacitor.isNativePlatform()) {
    // strongBiometryIsAvailable specifically means fingerprint-tier
    // (Class 3) biometry — most devices classify face unlock as "weak"
    // (Class 2), so checking this instead of isAvailable keeps this
    // fingerprint-only, matching what we actually prompt for below.
    const check = await BiometricAuth.checkBiometry();
    if (!check.strongBiometryIsAvailable) {
      throw new Error(
        check.strongCode === "biometryNotEnrolled"
          ? "No fingerprint enrolled on this device. Add one in your device settings first, then try again."
          : "Fingerprint authentication is not available on this device."
      );
    }
    // Confirm it actually works before turning the setting on, so we
    // never flip signInMethod to "biometric" without having proven it
    // succeeds.
    await BiometricAuth.authenticate({
      reason: "Confirm it's you to enable biometric sign-in",
      androidTitle: "Deeply",
      androidSubtitle: "Set up biometric sign-in",
      androidBiometryStrength: AndroidBiometryStrength.strong,
    });
    return;
  }

  // Web — independent capability from the native path above, for
  // browsers with a platform authenticator.
  if (!window.PublicKeyCredential) {
    throw new Error("Fingerprint authentication is not supported on this device or browser.");
  }
  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: "Deeply", id: window.location.hostname },
      user: {
        id: new TextEncoder().encode(email ?? "deeply-user"),
        name: email ?? "user",
        displayName: email ?? "User",
      },
      pubKeyCredParams: [
        { alg: -7, type: "public-key" },
        { alg: -257, type: "public-key" },
      ],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
      timeout: 60000,
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("Fingerprint enrollment failed.");
  const raw = credential.rawId;
  localStorage.setItem("deeply_biometric_credential_id", btoa(String.fromCharCode(...new Uint8Array(raw))));
}

// Opens external legal pages properly on native (a real, dismissible
// in-app browser sheet via Capacitor) instead of a plain <a href>, which
// can inconsistently hijack the app's own WebView instead of opening a
// separate browser — trapping the user outside the app's navigation
// with no clean way back in.
async function openExternalLink(url: string) {
  if (Capacitor.isNativePlatform()) {
    await Browser.open({ url });
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

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

  const [signInMethod, setSignInMethodState] = useState<SignInMethod>("password");
  const [biometricLoading, setBiometricLoading] = useState(false);

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

  const [showSupportForm, setShowSupportForm] = useState(false);
  const [supportMessage, setSupportMessage] = useState("");
  const [isSendingSupport, setIsSendingSupport] = useState(false);

  const [showDeleteSection, setShowDeleteSection] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const [isIncognito, setIsIncognito] = useState(false);
  const [incognitoEnabled, setIncognitoEnabled] = useState(false);
  const [isTogglingIncognito, setIsTogglingIncognito] = useState(false);

  const [profileViewsVisible, setProfileViewsVisible] = useState(true);
  const [isTogglingProfileViews, setIsTogglingProfileViews] = useState(false);

  // Deliberately independent of receiving/paying for read receipts on
  // OTHER people's messages — this only controls whether THIS user's own
  // read activity is ever visible to whoever they're talking to. Unlike
  // WhatsApp (where turning off read receipts also blocks you from
  // seeing anyone else's), turning this off has zero effect on this
  // user's own ability to separately pay to unlock read receipts on
  // their own sent messages — see ChatPage.tsx's Receipts button, which
  // is governed entirely by this match's own read_receipt_unlocks row,
  // not by this setting at all. Default true (matches the DB column's
  // own default) so existing users keep today's behavior until they
  // actively choose to turn it off.
  const [shareReadReceipts, setShareReadReceipts] = useState(true);
  const [isTogglingReadReceipts, setIsTogglingReadReceipts] = useState(false);

  // Phone number / verification state — see PhoneVerificationFlow for
  // the actual entry+OTP UI, shared with onboarding.
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [showPhoneForm, setShowPhoneForm] = useState(false);
  const [isLoadingPhoneStatus, setIsLoadingPhoneStatus] = useState(true);

  // Block Contacts entry point — gated on phone verification per the
  // spec (the actual contact picker + manual-add flow lives on its own
  // page, since it needs native contacts access and its own permission
  // handling; this is just the Settings entry point and the
  // not-yet-verified prompt).
  const [showBlockContactsPrompt, setShowBlockContactsPrompt] = useState(false);

  const fetchPhoneStatus = async () => {
    setIsLoadingPhoneStatus(true);
    try {
      const res = await fetch("/api/phone/status", { headers: { Authorization: `Bearer ${token}` } });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setPhoneNumber(body.phone_number ?? null);
        setPhoneVerified(!!body.phone_verified);
      }
    } catch {
      // Silent — non-critical, section just shows "No phone number added".
    } finally {
      setIsLoadingPhoneStatus(false);
    }
  };

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
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to update");
      setIsIncognito(next);
      toast({
        title: next ? "Incognito mode on" : "Incognito mode off",
        description: next
          ? "You're now hidden from Discover and Search. This costs 5 Sparks per day while active."
          : "You're visible in Discover and Search again.",
      });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to update incognito mode.",
        variant: "destructive",
      });
    } finally {
      setIsTogglingIncognito(false);
    }
  };

  const handleToggleProfileViews = async () => {
    const next = !profileViewsVisible;
    setIsTogglingProfileViews(true);
    try {
      const res = await fetch("/api/profile/me", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ notify_profile_views: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to update");
      setProfileViewsVisible(next);
      toast({
        title: next ? "Profile views on" : "Profile views off",
        description: next
          ? "You'll see who viewed your profile, and they'll see you viewed theirs."
          : "Your views stay private, and you won't see who viewed you either — it goes both ways.",
      });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to update profile views setting.",
        variant: "destructive",
      });
    } finally {
      setIsTogglingProfileViews(false);
    }
  };

  const handleToggleReadReceipts = async () => {
    const next = !shareReadReceipts;
    setIsTogglingReadReceipts(true);
    try {
      const res = await fetch("/api/profile/me", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ share_read_receipts: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to update");
      setShareReadReceipts(next);
      toast({
        title: next ? "Read receipts sharing on" : "Read receipts sharing off",
        description: next
          ? "Matches who've paid to unlock receipts can see when you've read their messages."
          : "No one can see when you've read their messages, even if they've paid to unlock receipts. You can still separately unlock receipts to see when others read yours.",
      });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to update read receipts setting.",
        variant: "destructive",
      });
    } finally {
      setIsTogglingReadReceipts(false);
    }
  };

  useEffect(() => {
    setSignInMethodState(getSignInMethod());
  }, []);

  const toggleSignInMethod = async () => {
    const switchingTo: SignInMethod = signInMethod === "password" ? "biometric" : "password";

    if (switchingTo === "biometric") {
      setBiometricLoading(true);
      try {
        await registerBiometric(email);
        const refreshToken = getCurrentRefreshToken();
        if (!refreshToken) throw new Error("Missing session — please log in again and retry.");
        enableBiometricSignIn(refreshToken);
        setSignInMethodState("biometric");
        toast({
          title: "Biometric sign-in enabled",
          description: "You can now sign in with your fingerprint.",
        });
      } catch (err) {
        toast({
          title: "Error",
          description: err instanceof Error ? err.message : "Biometric setup failed.",
          variant: "destructive",
        });
      } finally {
        setBiometricLoading(false);
      }
    } else {
      disableBiometricSignIn();
      setSignInMethodState("password");
      toast({ title: "Sign-in method changed to Password" });
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
        if (body) {
          setIsIncognito(!!body.is_incognito);
          setProfileViewsVisible(body.notify_profile_views ?? true);
          setShareReadReceipts(body.share_read_receipts ?? true);
        }
      })
      .catch(() => {});
    fetch("/api/app-settings", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (body) setIncognitoEnabled(body.incognito_enabled === true);
      })
      .catch(() => {});
    fetchBlockedUsers();
    fetchPhoneStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    fetch("/api/admin/me", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => setAdminAccess(body))
      .catch(() => {});
  }, [token]);

  const handleSendSupportMessage = async () => {
    if (!supportMessage.trim() || isSendingSupport) return;
    setIsSendingSupport(true);
    try {
      const res = await fetch("/api/support/message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message: supportMessage.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to send message");
      }
      toast({ title: "Message sent", description: "Our team will get back to you by email." });
      setSupportMessage("");
      setShowSupportForm(false);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to send message.",
        variant: "destructive",
      });
    } finally {
      setIsSendingSupport(false);
    }
  };

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
              onClick={() => setShowPhoneForm((v) => !v)}
              className="w-full flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <Phone size={18} className={phoneVerified ? "text-primary" : "text-muted-foreground"} />
                <div className="text-left">
                  <p className="text-sm font-medium">Phone Number</p>
                  <p className="text-xs text-muted-foreground">
                    {isLoadingPhoneStatus
                      ? "Loading..."
                      : phoneVerified
                      ? `Verified: ${phoneNumber}`
                      : "No phone number added"}
                  </p>
                </div>
              </div>
              {!showPhoneForm && (
                <span className="text-xs font-medium text-primary shrink-0">
                  {phoneVerified ? "Update" : "Add"}
                </span>
              )}
            </button>

            {showPhoneForm && (
              <div className="mt-4 pt-4 border-t border-border">
                <PhoneVerificationFlow
                  onVerified={(number) => {
                    setPhoneNumber(number);
                    setPhoneVerified(true);
                    setShowPhoneForm(false);
                  }}
                  onCancel={() => setShowPhoneForm(false)}
                />
              </div>
            )}
          </div>

          <div className="bg-card border border-card-border rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {signInMethod === "biometric" ? (
                  <Fingerprint size={18} className="text-primary" />
                ) : (
                  <Lock size={18} className="text-muted-foreground" />
                )}
                <div className="text-left">
                  <p className="text-sm font-medium">Sign-in method</p>
                  <p className="text-xs text-muted-foreground">
                    Currently: {signInMethod === "biometric" ? "Fingerprint / Biometric" : "Password"}
                  </p>
                </div>
              </div>
              <Button
                onClick={toggleSignInMethod}
                disabled={biometricLoading}
                variant="outline"
                className="h-9 rounded-xl text-xs px-3 gap-1.5"
              >
                {biometricLoading && <Loader2 size={12} className="animate-spin" />}
                Switch to {signInMethod === "password" ? "Biometric" : "Password"}
              </Button>
            </div>
            {signInMethod === "biometric" ? (
              <>
                <p className="text-xs text-muted-foreground mt-3 pl-8">
                  Your fingerprint is registered on this device. The Sign In button on the login screen will prompt your fingerprint directly.
                </p>
                <div className="mt-2 pl-8 flex items-start gap-1.5">
                  <Info size={13} className="text-muted-foreground shrink-0 mt-0.5" />
                  <p className="text-[11px] text-muted-foreground">
                    Using a new device? Switch to Password and then back to Biometric to register your fingerprint there too.
                  </p>
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground mt-3 pl-8">
                Switch to Biometric to use your device fingerprint sensor at login. You'll be prompted to scan your finger once to register.
              </p>
            )}
          </div>

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
            onClick={handleToggleProfileViews}
            disabled={isTogglingProfileViews}
            className="w-full flex items-center justify-between bg-card border border-card-border rounded-2xl p-4 disabled:opacity-60"
          >
            <div className="flex items-center gap-3">
              <ScanEye size={18} className="text-muted-foreground" />
              <div className="text-left">
                <p className="text-sm font-medium">Profile Views</p>
                <p className="text-xs text-muted-foreground">
                  {profileViewsVisible
                    ? "See who viewed you — they'll see you viewed them too"
                    : "Off — your views are private, and you won't see who viewed you"}
                </p>
              </div>
            </div>
            <div className={`h-6 w-10 rounded-full relative transition-colors shrink-0 ${profileViewsVisible ? "bg-primary" : "bg-secondary"}`}>
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${profileViewsVisible ? "right-1" : "left-1"}`} />
            </div>
          </button>

          {/* Unlike WhatsApp's read-receipts toggle, turning this off does
              NOT also block this user from separately paying to see when
              THEIR OWN sent messages are read — that's governed entirely
              by that specific match's own read-receipts unlock (see
              ChatPage.tsx), completely independent of this setting. This
              only ever controls whether THIS user's own read activity is
              visible to others. A match who's already paid to unlock
              receipts on this user specifically will simply stop seeing
              "Read" the moment this is turned off — see messages.ts's
              GET /matches/:matchId/messages, which checks this setting
              (not just whether receipts were paid for) before ever
              reporting a message as read. Anyone trying to newly PAY to
              unlock receipts on this user while this is off is stopped
              and told why before spending anything — see POST
              /matches/:matchId/read-receipts/unlock's own check. */}
          <button
            onClick={handleToggleReadReceipts}
            disabled={isTogglingReadReceipts}
            className="w-full flex items-center justify-between bg-card border border-card-border rounded-2xl p-4 disabled:opacity-60"
          >
            <div className="flex items-center gap-3">
              <CheckCheck size={18} className="text-muted-foreground" />
              <div className="text-left">
                <p className="text-sm font-medium">Share Read Receipts</p>
                <p className="text-xs text-muted-foreground">
                  {shareReadReceipts
                    ? "Matches who unlock receipts can see when you've read their messages"
                    : "Off — no one can see when you've read their messages"}
                </p>
              </div>
            </div>
            <div className={`h-6 w-10 rounded-full relative transition-colors shrink-0 ${shareReadReceipts ? "bg-primary" : "bg-secondary"}`}>
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${shareReadReceipts ? "right-1" : "left-1"}`} />
            </div>
          </button>

          {incognitoEnabled && (
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
                    {isIncognito ? "Hidden from Discover & Search · 5 Sparks/day" : "Visible in Discover & Search"}
                  </p>
                </div>
              </div>
              <div className={`h-6 w-10 rounded-full relative transition-colors ${isIncognito ? "bg-primary" : "bg-secondary"}`}>
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${isIncognito ? "right-1" : "left-1"}`} />
              </div>
            </button>
          )}

          <div className="bg-card border border-card-border rounded-2xl overflow-hidden">
            <button
              onClick={() => {
                if (phoneVerified) {
                  // TODO: navigate to the dedicated contact-picker page
                  // once built (needs native contacts access + its own
                  // permission flow).
                  setLocation("/block-contacts");
                } else {
                  setShowBlockContactsPrompt((v) => !v);
                }
              }}
              className="w-full flex items-center justify-between p-4"
            >
              <div className="flex items-center gap-3">
                <Users size={18} className="text-muted-foreground" />
                <div className="text-left">
                  <p className="text-sm font-medium">Block Contacts</p>
                  <p className="text-xs text-muted-foreground">
                    {phoneVerified ? "Hide people from your contacts" : "Requires phone verification"}
                  </p>
                </div>
              </div>
              <ChevronRight size={16} className={`text-muted-foreground transition-transform ${showBlockContactsPrompt ? "rotate-90" : ""}`} />
            </button>

            {!phoneVerified && showBlockContactsPrompt && (
              <div className="border-t border-border p-4 space-y-3">
                <p className="text-xs text-muted-foreground">
                  To block people from your contact list, we need your phone number. You haven't added one yet.
                </p>
                <div className="flex gap-2">
                  <Button
                    onClick={() => {
                      setShowBlockContactsPrompt(false);
                      setShowPhoneForm(true);
                    }}
                    className="flex-1 h-10 rounded-xl bg-gradient-accent border-0 text-sm"
                  >
                    Add Phone Number
                  </Button>
                  <Button
                    onClick={() => setShowBlockContactsPrompt(false)}
                    variant="outline"
                    className="flex-1 h-10 rounded-xl text-sm"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>

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

          <div className="bg-card border border-card-border rounded-2xl p-4">
            <button
              onClick={() => setShowSupportForm((v) => !v)}
              className="w-full flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <LifeBuoy size={18} className="text-muted-foreground" />
                <div className="text-left">
                  <p className="text-sm font-medium">Contact Support</p>
                  <p className="text-xs text-muted-foreground">Send our team a message</p>
                </div>
              </div>
              <ChevronRight size={16} className={`text-muted-foreground transition-transform ${showSupportForm ? "rotate-90" : ""}`} />
            </button>

            {showSupportForm && (
              <div className="mt-4 pt-4 border-t border-border space-y-3">
                <textarea
                  value={supportMessage}
                  onChange={(e) => setSupportMessage(e.target.value)}
                  placeholder="What's going on? The more detail, the faster we can help."
                  rows={5}
                  maxLength={4000}
                  className="w-full bg-background border border-card-border rounded-xl p-3 text-sm resize-none focus:outline-none focus:border-primary/50"
                />
                <p className="text-xs text-muted-foreground">
                  We'll reply to {email ?? "your account email"}.
                </p>
                <Button
                  onClick={handleSendSupportMessage}
                  disabled={!supportMessage.trim() || isSendingSupport}
                  className="w-full h-11 rounded-xl bg-gradient-accent border-0"
                >
                  <Send size={16} className="mr-2" />
                  {isSendingSupport ? "Sending..." : "Send Message"}
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Admin — only visible if the account has any admin access */}
        {adminAccess?.isAdmin && (
          <Link
            href="/admin"
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
          </Link>
        )}

        {/* Legal */}
        <div className="space-y-3">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider pl-1">Legal</h3>

          <div className="bg-card border border-card-border rounded-2xl overflow-hidden">
            <button
              onClick={() => openExternalLink("https://deeplydating.co.za/privacy")}
              className="w-full flex items-center justify-between p-4 border-b border-border"
            >
              <div className="flex items-center gap-3">
                <ShieldCheck size={18} className="text-muted-foreground" />
                <p className="text-sm font-medium">Privacy Policy</p>
              </div>
              <ChevronRight size={16} className="text-muted-foreground" />
            </button>
            <button
              onClick={() => openExternalLink("https://deeplydating.co.za/terms")}
              className="w-full flex items-center justify-between p-4"
            >
              <div className="flex items-center gap-3">
                <FileText size={18} className="text-muted-foreground" />
                <p className="text-sm font-medium">Terms of Service</p>
              </div>
              <ChevronRight size={16} className="text-muted-foreground" />
            </button>
          </div>
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
    </div>
  );
}
