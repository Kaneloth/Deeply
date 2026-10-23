import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { supabase } from "../lib/supabase";
import { requireAdminScope } from "../lib/admin-auth";

const router: IRouter = Router();

export const ACQUISITION_SOURCES = [
  "tiktok",
  "instagram",
  "facebook",
  "store_search",
  "google",
  "friend",
  "event",
  "other",
] as const;

/**
 * POST /api/profile/me/acquisition-source  { source }
 * Called once, best-effort, right after onboarding completes. Only ever
 * fills a blank value — never overwrites an earlier answer — and only
 * accepts values from the fixed list above.
 */
router.post("/profile/me/acquisition-source", requireAuth, async (req, res): Promise<void> => {
  const { source } = req.body as { source?: string };
  if (typeof source !== "string" || !(ACQUISITION_SOURCES as readonly string[]).includes(source)) {
    res.status(400).json({ error: "Invalid source" });
    return;
  }
  const { error } = await supabase
    .from("profiles")
    .update({ acquisition_source: source })
    .eq("id", req.user!.id)
    .is("acquisition_source", null);
  if (error) {
    console.error("acquisition-source save failed:", error.message);
    res.status(500).json({ error: "Could not save" });
    return;
  }
  res.json({ ok: true });
});

/**
 * GET /api/admin/acquisition-sources?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Counts of how people who finished onboarding in that signup-date range
 * say they found Deeply. Dates are South Africa time (UTC+2), `to` inclusive.
 */
router.get(
  "/admin/acquisition-sources",
  requireAuth,
  requireAdminScope("view_analytics"),
  async (req, res): Promise<void> => {
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    const from = typeof req.query.from === "string" && DATE_RE.test(req.query.from) ? req.query.from : null;
    const to = typeof req.query.to === "string" && DATE_RE.test(req.query.to) ? req.query.to : null;

    const apply = <T extends { gte: any; lt: any }>(q: T): T => {
      let out: any = q;
      if (from) out = out.gte("created_at", `${from}T00:00:00+02:00`);
      if (to) {
        const end = new Date(`${to}T00:00:00+02:00`);
        end.setUTCDate(end.getUTCDate() + 1);
        out = out.lt("created_at", end.toISOString());
      }
      return out;
    };

    const base = () =>
      apply(
        supabase.from("profiles").select("id", { count: "exact", head: true }).eq("onboarding_completed", true) as any,
      );

    const [totalRes, noAnswerRes, ...perSource] = await Promise.all([
      base(),
      base().is("acquisition_source", null),
      ...ACQUISITION_SOURCES.map((s) => base().eq("acquisition_source", s)),
    ]);

    const failed = [totalRes, noAnswerRes, ...perSource].find((r: any) => r.error);
    if (failed) {
      console.error("acquisition-sources query failed:", (failed as any).error.message);
      res.status(500).json({ error: "Could not load" });
      return;
    }

    res.json({
      total: (totalRes as any).count ?? 0,
      no_answer: (noAnswerRes as any).count ?? 0,
      sources: ACQUISITION_SOURCES.map((s, i) => ({ source: s, count: (perSource[i] as any).count ?? 0 })),
    });
  },
);

export default router;
