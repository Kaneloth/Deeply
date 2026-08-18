import { Router, type IRouter } from "express";
import { supabase } from "../lib/supabase";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

const SUPPORT_INBOX = "support@deeplydating.co.za";
const MAX_MESSAGE_LENGTH = 4000;

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Fires the best-effort Brevo notification for a saved support message.
 *  Deliberately time-bounded: this must never be able to hold up the
 *  client-facing response. Without a hard timeout, a slow or hanging
 *  Brevo request can push the whole handler's execution time past a
 *  Netlify function timeout — the client sees a failure while the
 *  message (already durably saved by the caller) and the eventual email
 *  both still go through in the background, producing exactly the "shows
 *  failed, arrives later" symptom this was built to avoid. 5s is
 *  generous for a small JSON POST; if Brevo can't respond by then, this
 *  is treated the same as any other best-effort failure — logged, not
 *  surfaced to the user, message stays saved either way. */
async function sendSupportEmailNotification(params: {
  replyToEmail: string;
  replyToName?: string;
  subject: string;
  htmlContent: string;
  textContent: string;
  messageId: string;
}): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.error(`BREVO_API_KEY is not set — support message ${params.messageId} saved but no email notification sent`);
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

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
        replyTo: params.replyToName ? { email: params.replyToEmail, name: params.replyToName } : { email: params.replyToEmail },
        subject: params.subject,
        htmlContent: params.htmlContent,
        textContent: params.textContent,
      }),
      signal: controller.signal,
    });

    if (brevoRes.ok) {
      await supabase.from("support_messages").update({ email_sent: true }).eq("id", params.messageId);
    } else {
      const errBody = await brevoRes.text().catch(() => "");
      console.error(`Brevo send failed (message ${params.messageId} still saved): ${brevoRes.status} ${errBody}`);
    }
  } catch (err) {
    const reason = err instanceof Error && err.name === "AbortError" ? "Brevo request timed out after 5s" : err;
    console.error(`Brevo request failed (message ${params.messageId} still saved):`, reason);
  } finally {
    clearTimeout(timeout);
  }
}

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
  await sendSupportEmailNotification({
    replyToEmail: senderEmail,
    replyToName: senderName,
    subject: `Deeply Support Request — ${senderName}`,
    htmlContent: `
      <p><strong>From:</strong> ${escapeHtml(senderName)} (${escapeHtml(senderEmail)})</p>
      <p><strong>User ID:</strong> ${escapeHtml(userId)}</p>
      <hr />
      <p>${escapeHtml(trimmedMessage).replace(/\n/g, "<br />")}</p>
    `,
    textContent: `From: ${senderName} (${senderEmail})\nUser ID: ${userId}\n\n${trimmedMessage}`,
    messageId: saved.id,
  });

  res.sendStatus(204);
});

export default router;