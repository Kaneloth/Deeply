import { type Request, type Response, type NextFunction } from "express";
import { supabase } from "../lib/supabase";
// Augment Express Request to carry the authenticated user
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; email?: string };
    }
  }
}
/**
 * Middleware that validates the Supabase JWT from the Authorization header
 * and attaches the user to req.user. Returns 401 if the token is missing
 * or invalid, or 403 if the account is banned/suspended — checked here so
 * a ban/suspension takes effect immediately, not just at next login.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or malformed Authorization header" });
    return;
  }
  const token = authHeader.slice(7);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("banned, ban_reason, suspended_until, suspension_reason")
    .eq("id", user.id)
    .single();

  if (profile?.banned) {
    res.status(403).json({
      error: "This account has been banned.",
      reason: profile.ban_reason ?? undefined,
      code: "BANNED",
    });
    return;
  }

  if (profile?.suspended_until && new Date(profile.suspended_until) > new Date()) {
    res.status(403).json({
      error: "This account is temporarily suspended.",
      reason: profile.suspension_reason ?? undefined,
      suspendedUntil: profile.suspended_until,
      code: "SUSPENDED",
    });
    return;
  }

  req.user = { id: user.id, email: user.email };
  next();
}
