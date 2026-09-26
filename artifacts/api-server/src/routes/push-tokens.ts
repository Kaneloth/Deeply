import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { supabase } from "../lib/supabase";

const router: IRouter = Router();

/** POST /api/push/register-token — called once on login/app-resume by
 *  the frontend's pushNotifications.ts after Capacitor hands back a
 *  fresh FCM registration token. Upserts on the TOKEN, not (user_id,
 *  token) — see push_tokens_migration.sql's doc comment: this is what
 *  re-homes a shared device to whichever account is currently logged in,
 *  instead of silently notifying whoever registered that token first. */
router.post("/push/register-token", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { token, platform } = req.body as { token?: string; platform?: string };

  if (!token) {
    res.status(400).json({ error: "token is required" });
    return;
  }

  const { error } = await supabase.from("push_tokens").upsert(
    {
      user_id: userId,
      token,
      platform: platform === "ios" || platform === "web" ? platform : "android",
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "token" },
  );

  if (error) {
    res.status(500).json({ error: `Failed to register push token: ${error.message}` });
    return;
  }

  res.sendStatus(204);
});

/** POST /api/push/unregister-token — called on logout, so a shared or
 *  reissued device stops receiving this account's notifications the
 *  moment it's no longer signed in, rather than waiting for a future
 *  login on some other account to overwrite the row via register-token
 *  above. Scoped to the caller's own user_id — deleting a token you
 *  don't own does nothing (matches().eq(user_id) below), not an error,
 *  since the caller has no way of knowing who currently owns it. */
router.post("/push/unregister-token", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { token } = req.body as { token?: string };

  if (!token) {
    res.status(400).json({ error: "token is required" });
    return;
  }

  await supabase.from("push_tokens").delete().eq("user_id", userId).eq("token", token);

  res.sendStatus(204);
});

export default router;
