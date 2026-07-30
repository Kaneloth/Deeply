import { type Request, type Response, type NextFunction } from "express";
import { supabase } from "./supabase";

// Hardcoded on purpose — this account's admin status must not be
// modifiable through any database state, so it can never be tampered
// with or accidentally revoked by another admin's action.
export const SUPER_ADMIN_EMAIL = "kaneloth@skootlink.co.za";

export type AdminScope = "manage_reports" | "manage_users" | "manage_sparks" | "view_analytics";

export function isSuperAdmin(email: string | undefined | null): boolean {
  return !!email && email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();
}

/** Middleware factory — requires the caller to be either the super-admin,
 *  or a regular admin whose admin_scopes include the given scope. Must be
 *  used after requireAuth (needs req.user). */
export function requireAdminScope(scope: AdminScope) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (isSuperAdmin(req.user?.email)) {
      next();
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("is_admin, admin_scopes")
      .eq("id", req.user!.id)
      .single();

    if (!profile?.is_admin || !profile.admin_scopes?.includes(scope)) {
      res.status(403).json({ error: "You don't have permission to do this" });
      return;
    }

    next();
  };
}

/** Middleware — only the hardcoded super-admin may pass. Used for
 *  granting/revoking admin access itself, which is deliberately not a
 *  grantable scope. */
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!isSuperAdmin(req.user?.email)) {
    res.status(403).json({ error: "Only the super-admin can manage admin access" });
    return;
  }
  next();
}
