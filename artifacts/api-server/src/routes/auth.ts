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

  // No session means Supabase created the account but is waiting on email
  // confirmation before issuing a session. This is a SUCCESS case, not an
  // error — the frontend should show a "check your email" message rather
  // than logging the user in immediately.
  if (!data.session) {
    res.status(201).json({
      requiresEmailConfirmation: true,
      user: { id: data.user.id, email: data.user.email },
    });
    return;
  }

  // Email confirmation is off (or already confirmed) — a session came back
  // immediately, so log the user in right away as before.
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", data.user.id)
    .single();

  res.status(201).json({
    access_token: data.session.access_token,
    user: { id: data.user.id, email: data.user.email },
    profile,
  });
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
    // Give a clearer message when the real cause is an unconfirmed email,
    // rather than a generic "invalid credentials".
    const message =
      error?.message === "Email not confirmed"
        ? "Please confirm your email before logging in. Check your inbox for the confirmation link."
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
    user: { id: data.user.id, email: data.user.email },
    profile,
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
