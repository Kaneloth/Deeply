import { Router, type IRouter } from "express";
import { supabase } from "../lib/supabase";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

/** POST /api/auth/signup */
router.post("/auth/signup", async (req, res): Promise<void> => {
  const { email, password, name, age } = req.body as {
    email?: string;
    password?: string;
    name?: string;
    age?: number;
  };

  if (!email || !password || !name || !age) {
    res.status(400).json({ error: "email, password, name, and age are required" });
    return;
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name, age } },
  });

  if (error) {
    res.status(400).json({ error: error.message });
    return;
  }

  if (!data.user) {
    res.status(400).json({ error: "Signup failed" });
    return;
  }

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

export default router;