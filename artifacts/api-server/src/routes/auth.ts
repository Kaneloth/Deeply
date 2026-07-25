import { Router, type IRouter } from "express";
import { supabase } from "../lib/supabase";

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

export default router;
