import { Router, type IRouter } from "express";
import { supabase } from "../lib/supabase";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

// ============================================================
// Grant abuse prevention — normalizes an email to catch the common
// "infinite email addresses" trick most providers unintentionally
// support: Gmail (and Googlemail) ignore dots in the local part
// entirely, and virtually every major provider (Gmail, Outlook,
// Yahoo, iCloud, etc.) supports "+tag" addressing where everything
// after a "+" is stripped by the provider but still delivers to the
// same real inbox. Both let someone register what looks like dozens
// of unique addresses that are all actually the same mailbox — this
// normalization collapses them back to one canonical form so the
// grant-cooldown check in sparks-helper.ts can actually catch that.
//
// This is deliberately a simple, best-effort normalization, not a
// full email-provider-aware library — it specifically targets the
// two tricks that are trivial for anyone to discover and repeat, not
// every possible provider-specific quirk.
function normalizeEmail(email: string): string {
  const trimmed = email.toLowerCase().trim();
  const atIndex = trimmed.lastIndexOf("@");
  if (atIndex === -1) return trimmed;

  const localPart = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);

  const withoutPlusTag = localPart.split("+")[0];

  const isGmail = domain === "gmail.com" || domain === "googlemail.com";
  const finalLocalPart = isGmail ? withoutPlusTag.replace(/\./g, "") : withoutPlusTag;
  const finalDomain = isGmail ? "gmail.com" : domain; // treat googlemail.com as identical to gmail.com

  return `${finalLocalPart}@${finalDomain}`;
}

/** POST /api/auth/signup */
router.post("/auth/signup", async (req, res): Promise<void> => {
  const { email, password, device_id } = req.body as {
    email?: string;
    password?: string;
    // Native-only (see AuthPage.tsx) — Capacitor's Device.getId(),
    // absent entirely for web signups. Optional throughout this whole
    // route; a missing value just means this specific defense doesn't
    // apply to this signup, not an error.
    device_id?: string;
  };

  if (!email || !password) {
    res.status(400).json({ error: "email and password are required" });
    return;
  }

  // Name is no longer collected here — the signup screen asking for it
  // duplicated the Name field onboarding already asks for right after
  // (and for Google sign-in, that name gets auto-populated from Google's
  // own profile data without ever being confirmed by the person at all).
  // Collecting it once, during onboarding, avoids both problems — see
  // OnboardingPage.tsx and profile.ts. options.data is passed as an
  // empty object rather than omitted entirely, since Supabase's signUp
  // still expects the `options` shape even with nothing in `data`.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: {} },
  });

  if (error) {
    res.status(400).json({ error: error.message });
    return;
  }

  if (!data.user) {
    res.status(400).json({ error: "Signup failed" });
    return;
  }

  // Stored as soon as the auth user exists, before the email-confirmed
  // check below — a profiles row for this user id already exists by
  // this point (created via the on_auth_user_created trigger), and
  // these two values need to be captured regardless of whether this
  // signup still needs email confirmation, so the grant-cooldown check
  // in sparks-helper.ts has them available from this account's very
  // first monthly grant, whenever that ends up happening.
  await supabase
    .from("profiles")
    .update({
      signup_device_id: device_id ?? null,
      normalized_email: normalizeEmail(email),
    })
    .eq("id", data.user.id);

  if (!data.session) {
    res.status(201).json({
      requiresEmailConfirmation: true,
      user: { id: data.user.id, email: data.user.email },
    });
    return;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", data.user.id)
    .single();

  res.status(201).json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_in: data.session.expires_in,
    user: { id: data.user.id, email: data.user.email },
    profile,
  });
});

/** POST /api/auth/verify-otp */
router.post("/auth/verify-otp", async (req, res): Promise<void> => {
  const { email, code } = req.body as { email?: string; code?: string };

  if (!email || !code) {
    res.status(400).json({ error: "email and code are required" });
    return;
  }

  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: code,
    type: "signup",
  });

  if (error || !data.user || !data.session) {
    res.status(400).json({ error: error?.message ?? "Invalid or expired code" });
    return;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", data.user.id)
    .single();

  res.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_in: data.session.expires_in,
    user: { id: data.user.id, email: data.user.email },
    profile,
  });
});

/** POST /api/auth/resend-otp */
router.post("/auth/resend-otp", async (req, res): Promise<void> => {
  const { email } = req.body as { email?: string };

  if (!email) {
    res.status(400).json({ error: "email is required" });
    return;
  }

  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
  });

  if (error) {
    res.status(400).json({ error: error.message });
    return;
  }

  res.sendStatus(204);
});

/** POST /api/auth/login */
router.post("/auth/login", async (req, res): Promise<void> => {
  const { email, password } = req.body as {
    email?: string;
    password?: string;
  };

  if (!email || !password) {
    res.status(400).json({ error: "email and password are required" });
    return;
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user || !data.session) {
    const message =
      error?.message === "Email not confirmed"
        ? "Please confirm your email before logging in. Check your inbox for the confirmation code."
        : (error?.message ?? "Invalid credentials");
    res.status(401).json({ error: message });
    return;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", data.user.id)
    .single();

  // A session was just issued by signInWithPassword above — if this
  // account is banned/suspended, invalidate it immediately and refuse the
  // login outright, rather than letting them in and only blocking their
  // next request (which requireAuth also enforces, but with a much less
  // clear error for the person trying to sign in).
  if (profile?.banned) {
    await supabase.auth.admin.signOut(data.session.access_token);
    res.status(403).json({
      error: "This account has been banned.",
      code: "BANNED",
      reason: profile.ban_reason ?? undefined,
    });
    return;
  }
  if (profile?.suspended_until && new Date(profile.suspended_until) > new Date()) {
    await supabase.auth.admin.signOut(data.session.access_token);
    res.status(403).json({
      error: "This account is temporarily suspended.",
      code: "SUSPENDED",
      reason: profile.suspension_reason ?? undefined,
      suspendedUntil: profile.suspended_until,
    });
    return;
  }

  res.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_in: data.session.expires_in,
    user: { id: data.user.id, email: data.user.email },
    profile,
  });
});

/** POST /api/auth/refresh — silently renew an expired/expiring access
 *  token using the long-lived refresh token, so users don't get logged
 *  out every hour. */
router.post("/auth/refresh", async (req, res): Promise<void> => {
  const { refresh_token } = req.body as { refresh_token?: string };

  if (!refresh_token) {
    res.status(400).json({ error: "refresh_token is required" });
    return;
  }

  const { data, error } = await supabase.auth.refreshSession({ refresh_token });

  if (error || !data.session) {
    res.status(401).json({ error: error?.message ?? "Could not refresh session" });
    return;
  }

  res.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_in: data.session.expires_in,
  });
});

/** POST /api/auth/logout */
router.post("/auth/logout", async (req, res): Promise<void> => {
  const token = req.headers.authorization?.slice(7);
  if (token) {
    await supabase.auth.admin.signOut(token);
  }
  res.sendStatus(204);
});

/** GET /api/auth/me — basic account info (email) for Settings, since
 *  profiles doesn't store email itself. */
router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const { data, error } = await supabase.auth.admin.getUserById(req.user!.id);
  if (error || !data.user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  res.json({ id: data.user.id, email: data.user.email });
});

/** PUT /api/auth/change-password — requires the current password to be
 *  correct before allowing the change. */
router.put("/auth/change-password", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { currentPassword, newPassword } = req.body as {
    currentPassword?: string;
    newPassword?: string;
  };

  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "currentPassword and newPassword are required" });
    return;
  }
  if (newPassword.length < 6) {
    res.status(400).json({ error: "New password must be at least 6 characters" });
    return;
  }

  const { data: userData, error: getUserError } = await supabase.auth.admin.getUserById(userId);
  if (getUserError || !userData.user?.email) {
    res.status(500).json({ error: "Could not verify account" });
    return;
  }

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: userData.user.email,
    password: currentPassword,
  });
  if (signInError) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  const { error: updateError } = await supabase.auth.admin.updateUserById(userId, { password: newPassword });
  if (updateError) {
    res.status(500).json({ error: `Failed to update password: ${updateError.message}` });
    return;
  }

  res.sendStatus(204);
});

/** DELETE /api/auth/account — permanently deletes the profile, the
 *  underlying auth account, and the user's uploaded storage files
 *  (photos, video clips, audio prompts). Requires the current password
 *  to confirm. */
router.delete("/auth/account", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { password } = req.body as { password?: string };

  if (!password) {
    res.status(400).json({ error: "password is required to confirm account deletion" });
    return;
  }

  const { data: userData, error: getUserError } = await supabase.auth.admin.getUserById(userId);
  if (getUserError || !userData.user?.email) {
    res.status(500).json({ error: "Could not verify account" });
    return;
  }

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: userData.user.email,
    password,
  });
  if (signInError) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }

  // Clean up storage files (photos, video clips, audio prompts) before
  // removing the account. Both buckets store files under a `${userId}/`
  // prefix, so we list that "folder" and remove everything in it.
  for (const bucket of ["profile-photos", "audio-prompts"]) {
    try {
      const { data: files } = await supabase.storage.from(bucket).list(userId);
      if (files && files.length > 0) {
        const paths = files.map((f) => `${userId}/${f.name}`);
        await supabase.storage.from(bucket).remove(paths);
      }
    } catch {
      // Non-fatal — don't block account deletion if storage cleanup
      // fails for one bucket; the account deletion itself still proceeds.
    }
  }

  // Delete the profile row explicitly first (in case the FK to auth.users
  // isn't set up with ON DELETE CASCADE), then delete the auth user.
  await supabase.from("profiles").delete().eq("id", userId);

  const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);
  if (deleteError) {
    res.status(500).json({ error: `Failed to delete account: ${deleteError.message}` });
    return;
  }

  res.sendStatus(204);
});

/** POST /api/auth/forgot-password — sends a password reset email. Always
 *  responds with success regardless of whether the email exists, so this
 *  can't be used to enumerate registered accounts. */
router.post("/auth/forgot-password", async (req, res): Promise<void> => {
  const { email, redirectTo } = req.body as { email?: string; redirectTo?: string };

  if (!email) {
    res.status(400).json({ error: "email is required" });
    return;
  }

  try {
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectTo || undefined,
    });
  } catch {
    // Intentionally swallowed — see the doc comment above.
  }

  res.sendStatus(204);
});

/** POST /api/auth/reset-password — completes a password reset using the
 *  access_token from the recovery email link (extracted client-side from
 *  the URL fragment, since fragments never reach the server directly). */
router.post("/auth/reset-password", async (req, res): Promise<void> => {
  const { accessToken, newPassword } = req.body as { accessToken?: string; newPassword?: string };

  if (!accessToken || !newPassword) {
    res.status(400).json({ error: "accessToken and newPassword are required" });
    return;
  }
  if (newPassword.length < 6) {
    res.status(400).json({ error: "New password must be at least 6 characters" });
    return;
  }

  const {
    data: { user },
    error: getUserError,
  } = await supabase.auth.getUser(accessToken);

  if (getUserError || !user) {
    res.status(401).json({ error: "This reset link is invalid or has expired. Please request a new one." });
    return;
  }

  const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, { password: newPassword });
  if (updateError) {
    res.status(500).json({ error: `Failed to reset password: ${updateError.message}` });
    return;
  }

  res.sendStatus(204);
});

export default router;