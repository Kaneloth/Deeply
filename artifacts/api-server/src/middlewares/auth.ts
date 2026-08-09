import { type Request, type Response, type NextFunction } from "express";
import { supabase } from "../lib/supabase";
import { spendSparks } from "../lib/sparks-helper";
import { getEconomyConfig } from "../lib/economy-config";

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
    .select("banned, ban_reason, suspended_until, suspension_reason, is_incognito, incognito_last_charged_at")
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

  // Incognito costs 5 Sparks per day it stays active, charged once every
  // 24h since the last charge — discourages leaving it on indefinitely.
  // If the balance can't cover it, incognito auto-disables rather than
  // going negative or blocking the request.
  if (profile?.is_incognito) {
    const lastCharged = profile.incognito_last_charged_at ? new Date(profile.incognito_last_charged_at) : null;
    const dueForCharge = !lastCharged || Date.now() - lastCharged.getTime() >= 24 * 60 * 60 * 1000;

    if (dueForCharge) {
      const { cost_incognito_per_day } = await getEconomyConfig();
      const spend = await spendSparks(user.id, cost_incognito_per_day, "Incognito mode (daily)");
      if (spend.success) {
        await supabase
          .from("profiles")
          .update({ incognito_last_charged_at: new Date().toISOString() })
          .eq("id", user.id);
      } else {
        await supabase
          .from("profiles")
          .update({ is_incognito: false, incognito_last_charged_at: null })
          .eq("id", user.id);
      }
    }
  }

  req.user = { id: user.id, email: user.email };
  next();
}