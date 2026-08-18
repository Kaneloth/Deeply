import { Router, type IRouter } from "express";
import { supabase } from "../lib/supabase";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

const SUPPORT_INBOX = "support@deeplydating.co.za";
const MAX_MESSAGE_LENGTH = 4000;

/** POST /api/support/message — the message is ALWAYS written to
 *  support_messages first; that DB write is what determines success or
 *  failure for the user. Sending via Brevo happens after, best-effort —
 *  if Brevo is down or misconfigured, the request still succeeds (the
 *  message is safely stored either way), and email_sent stays false so
 *  a delivery failure can be spotted later by querying for it, rather
 *  than losing the message entirely. */
router.post("/support/message", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { message } = req.body as { message?: string };

  if (!message || !message.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    res.status(400).json({ error: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer` });
    return;
  }

  const { data: userData, error: getUserError } = await supabase.auth.admin.getUserById(userId);
  if (getUserError || !userData.user?.email) {
    res.status(500).json({ error: "Could not verify your account" });
    return;
  }

  const senderEmail = userData.user.email;
  const senderName = (userData.user.user_metadata as { name?: string } | null)?.name ?? senderEmail;
  const trimmedMessage = message.trim();

  // Source of truth — if this fails, the request fails. Nothing about
  // Brevo's availability affects this at all.
  const { data: saved, error: insertError } = await supabase
    .from("support_messages")
    .insert({ user_id: userId, email: senderEmail, message: trimmedMessage })
    .select("id")
    .single();

  if (insertError || !saved) {
    console.error("Failed to save support message:", insertError);
    res.status(500).json({ error: "Failed to send your message. Please try again." });
    return;
  }

  // Best-effort notification from here on — any failure below is logged
  // but never surfaces as an error to the user, since their message is
  // already durably saved.
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.error("BREVO_API_KEY is not set — support message saved but no email notification sent");
    res.sendStatus(204);
    return;
  }

  const escapeHtml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  try {
    const brevoRes = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        sender: { name: "Deeply Support Form", email: SUPPORT_INBOX },
        to: [{ email: SUPPORT_INBOX }],
        replyTo: { email: senderEmail, name: senderName },
        subject: `Deeply Support Request — ${senderName}`,
        htmlContent: `
          <p><strong>From:</strong> ${escapeHtml(senderName)} (${escapeHtml(senderEmail)})</p>
          <p><strong>User ID:</strong> ${escapeHtml(userId)}</p>
          <hr />
          <p>${escapeHtml(trimmedMessage).replace(/\n/g, "<br />")}</p>
        `,
        textContent: `From: ${senderName} (${senderEmail})\nUser ID: ${userId}\n\n${trimmedMessage}`,
      }),
    });

    if (brevoRes.ok) {
      await supabase.from("support_messages").update({ email_sent: true }).eq("id", saved.id);
    } else {
      const errBody = await brevoRes.text().catch(() => "");
      console.error(`Brevo send failed (message ${saved.id} still saved): ${brevoRes.status} ${errBody}`);
    }
  } catch (err) {
    console.error(`Brevo request threw (message ${saved.id} still saved):`, err);
  }

  res.sendStatus(204);
});

/** POST /api/support/blocked-message — for users who can't use the normal
 *  authenticated endpoint above because they're actively banned or
 *  suspended: AuthContext's 403 interceptor calls logout() the moment
 *  blockInfo is set (see AuthContext.tsx), clearing the token BEFORE
 *  BlockedAccountScreen ever renders. So by the time someone sees this
 *  screen, there's no session left to attach requireAuth to.
 *
 *  No auth, no req.user — the email comes straight from the request
 *  body, same trust model as a public "Contact Us" page. This endpoint
 *  never looks up, verifies, or acts on any account by that email; it
 *  only stores the message and forwards it, so a fabricated email can't
 *  be used to do anything beyond mislabeling the sender of a support
 *  ticket.
 *
 *  NOTE: this insert omits user_id entirely (there isn't one to send).
 *  If support_messages.user_id is a NOT NULL column, this insert will
 *  fail — confirm it's nullable before relying on this endpoint. */
router.post("/support/blocked-message", async (req, res): Promise<void> => {
  const { email, message } = req.body as { email?: string; message?: string };

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "A valid email is required" });
    return;
  }
  if (!message || !message.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    res.status(400).json({ error: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer` });
    return;
  }

  const trimmedMessage = message.trim();

  // One automatic retry before giving up — this form is specifically for
  // people already locked out of their account, so a transient blip
  // shouldn't surface as a hard failure if a second attempt would have
  // succeeded. Genuinely persistent failures (bad schema, real RLS
  // misconfig, etc.) still fail after the retry, same as before.
  let saved: { id: string } | null = null;
  let insertError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await supabase
      .from("support_messages")
      .insert({ email, message: trimmedMessage })
      .select("id")
      .single();
    if (result.data) {
      saved = result.data;
      insertError = null;
      break;
    }
    insertError = result.error;
    if (attempt === 0) {
      console.error("Blocked-account support message insert failed, retrying once:", result.error);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  if (insertError || !saved) {
    console.error("Failed to save blocked-account support message:", insertError);
    res.status(500).json({ error: "Failed to send your message. Please try again." });
    return;
  }

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.error("BREVO_API_KEY is not set — support message saved but no email notification sent");
    res.sendStatus(204);
    return;
  }

  const escapeHtml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  try {
    const brevoRes = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        sender: { name: "Deeply Support Form", email: SUPPORT_INBOX },
        to: [{ email: SUPPORT_INBOX }],
        replyTo: { email },
        subject: `Deeply Support Request — Blocked Account (${email})`,
        htmlContent: `
          <p><strong>From:</strong> ${escapeHtml(email)}</p>
          <p><strong>Context:</strong> Submitted from the blocked/suspended account screen — no active session, identity not verified server-side.</p>
          <hr />
          <p>${escapeHtml(trimmedMessage).replace(/\n/g, "<br />")}</p>
        `,
        textContent: `From: ${email}\nContext: Blocked account screen (no active session, unverified)\n\n${trimmedMessage}`,
      }),
    });

    if (brevoRes.ok) {
      await supabase.from("support_messages").update({ email_sent: true }).eq("id", saved.id);
    } else {
      const errBody = await brevoRes.text().catch(() => "");
      console.error(`Brevo send failed (message ${saved.id} still saved): ${brevoRes.status} ${errBody}`);
    }
  } catch (err) {
    console.error(`Brevo request threw (message ${saved.id} still saved):`, err);
  }

  res.sendStatus(204);
});

export default router;