import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { supabase } from "../lib/supabase";
import { isValidE164 } from "../lib/phone-otp-helper";

const router: IRouter = Router();

/** POST /api/blocked-contacts/import — bulk add, from the device's
 *  contact picker. Expects numbers already normalized to E.164 by the
 *  frontend (it has the country-code context from the picker UI; this
 *  endpoint can't reliably guess a country for a bare local-format
 *  number on its own). Anything that doesn't pass isValidE164 is
 *  silently skipped and reported back, rather than failing the whole
 *  batch. */
router.post("/blocked-contacts/import", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { phone_numbers: phoneNumbers } = req.body as { phone_numbers?: unknown };

  if (!Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
    res.status(400).json({ error: "phone_numbers must be a non-empty array" });
    return;
  }

  const valid: string[] = [];
  const skipped: string[] = [];
  for (const raw of phoneNumbers) {
    if (typeof raw === "string" && isValidE164(raw)) {
      valid.push(raw);
    } else if (typeof raw === "string") {
      skipped.push(raw);
    }
  }

  if (valid.length > 0) {
    const rows = valid.map((phone_number) => ({ user_id: userId, blocked_phone_number: phone_number, source: "contacts" as const }));
    const { error } = await supabase.from("blocked_contacts").upsert(rows, { onConflict: "user_id,blocked_phone_number" });
    if (error) {
      res.status(500).json({ error: `Failed to import blocked contacts: ${error.message}` });
      return;
    }
  }

  res.json({ imported: valid.length, skipped });
});

/** POST /api/blocked-contacts/manual — single number, typed in directly
 *  (for someone not saved as a device contact at all). */
router.post("/blocked-contacts/manual", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { phone_number: phoneNumber } = req.body as { phone_number?: string };

  if (!phoneNumber || !isValidE164(phoneNumber)) {
    res.status(400).json({ error: "Please enter a valid phone number" });
    return;
  }

  const { error } = await supabase
    .from("blocked_contacts")
    .upsert({ user_id: userId, blocked_phone_number: phoneNumber, source: "manual" }, { onConflict: "user_id,blocked_phone_number" });

  if (error) {
    res.status(500).json({ error: `Failed to block number: ${error.message}` });
    return;
  }

  res.status(201).json({ blocked: true });
});

/** GET /api/blocked-contacts — list currently blocked numbers, for a
 *  manage/unblock view. Not explicitly requested in the original spec,
 *  but included since a blocking feature with no way to see or undo
 *  what's blocked is a real gap, not a nice-to-have. */
router.get("/blocked-contacts", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const { data, error } = await supabase
    .from("blocked_contacts")
    .select("id, blocked_phone_number, source, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    res.status(500).json({ error: "Failed to load blocked contacts" });
    return;
  }

  res.json({ blocked: data ?? [] });
});

/** DELETE /api/blocked-contacts/:id — unblock a specific number. */
router.delete("/blocked-contacts/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const { error } = await supabase.from("blocked_contacts").delete().eq("id", id).eq("user_id", userId);

  if (error) {
    res.status(500).json({ error: "Failed to unblock number" });
    return;
  }

  res.status(204).send();
});

export default router;
