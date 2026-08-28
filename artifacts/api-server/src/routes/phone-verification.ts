import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { supabase } from "../lib/supabase";
import { sendSms } from "../lib/bulksms-helper";
import {
  generateOtpCode,
  hashOtpCode,
  isValidE164,
  OTP_EXPIRY_MS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_MAX_ATTEMPTS,
  OTP_LOCKOUT_MS,
} from "../lib/phone-otp-helper";

const router: IRouter = Router();

/** POST /api/phone/send-otp — sends (or resends) a 6-digit code to the
 *  given phone number. Generates the code and sends it via BulkSMS
 *  BEFORE writing anything to phone_otp_verifications, so a failed SMS
 *  send never leaves a "ghost" OTP row implying a code was delivered
 *  when it wasn't. */
router.post("/phone/send-otp", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { phone_number: phoneNumber } = req.body as { phone_number?: string };

  if (!phoneNumber || !isValidE164(phoneNumber)) {
    res.status(400).json({ error: "Please enter a valid phone number" });
    return;
  }

  // Server-side enforcement of the 30-second resend cooldown — the
  // spec's greyed-out button is a UI nicety, not a substitute for this,
  // since the endpoint itself is directly callable regardless of what
  // the UI currently shows.
  const { data: existing } = await supabase
    .from("phone_otp_verifications")
    .select("last_sent_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    const sinceLastSend = Date.now() - new Date(existing.last_sent_at).getTime();
    if (sinceLastSend < OTP_RESEND_COOLDOWN_MS) {
      res.status(429).json({
        error: "Please wait before requesting another code",
        retryAfterMs: OTP_RESEND_COOLDOWN_MS - sinceLastSend,
      });
      return;
    }
  }

  const code = generateOtpCode();
  const smsResult = await sendSms(phoneNumber, `Your Deeply verification code is ${code}. It expires in 10 minutes.`);

  if (!smsResult.success) {
    res.status(502).json({ error: smsResult.errorMessage ?? "We couldn't send the code. Please check your number and try again." });
    return;
  }

  const nowIso = new Date().toISOString();
  const { error: upsertError } = await supabase.from("phone_otp_verifications").upsert(
    {
      user_id: userId,
      phone_number: phoneNumber,
      code_hash: hashOtpCode(code),
      attempt_count: 0,
      locked_until: null,
      expires_at: new Date(Date.now() + OTP_EXPIRY_MS).toISOString(),
      last_sent_at: nowIso,
    },
    { onConflict: "user_id" },
  );

  if (upsertError) {
    res.status(500).json({ error: `Failed to record verification attempt: ${upsertError.message}` });
    return;
  }

  res.json({ sent: true });
});

/** POST /api/phone/verify-otp — checks the submitted code against the
 *  pending attempt for this user. On success, writes the verified
 *  phone number onto the profile and clears the OTP row. */
router.post("/phone/verify-otp", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { code } = req.body as { code?: string };

  if (!code || !/^\d{6}$/.test(code)) {
    res.status(400).json({ error: "Invalid code. Please try again." });
    return;
  }

  const { data: pending } = await supabase
    .from("phone_otp_verifications")
    .select("phone_number, code_hash, attempt_count, locked_until, expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (!pending) {
    res.status(400).json({ error: "No verification in progress — please request a new code" });
    return;
  }

  if (pending.locked_until && new Date(pending.locked_until).getTime() > Date.now()) {
    res.status(429).json({ error: "Too many attempts. Please try again in 30 minutes." });
    return;
  }

  if (new Date(pending.expires_at).getTime() < Date.now()) {
    res.status(400).json({ error: "Code expired. Please request a new one." });
    return;
  }

  if (hashOtpCode(code) !== pending.code_hash) {
    const newAttemptCount = pending.attempt_count + 1;
    const isNowLocked = newAttemptCount >= OTP_MAX_ATTEMPTS;
    await supabase
      .from("phone_otp_verifications")
      .update({
        attempt_count: newAttemptCount,
        locked_until: isNowLocked ? new Date(Date.now() + OTP_LOCKOUT_MS).toISOString() : null,
      })
      .eq("user_id", userId);

    res.status(400).json({
      error: isNowLocked ? "Too many attempts. Please try again in 30 minutes." : "Invalid code. Please try again.",
    });
    return;
  }

  const { error: profileUpdateError } = await supabase
    .from("profiles")
    .update({ phone_number: pending.phone_number, phone_verified: true })
    .eq("id", userId);

  if (profileUpdateError) {
    // 23505 = unique violation on profiles_phone_number_verified_unique
    // — someone else already has this exact number verified.
    if (profileUpdateError.code === "23505") {
      res.status(409).json({ error: "This phone number is already linked to another account." });
      return;
    }
    res.status(500).json({ error: `Failed to save phone number: ${profileUpdateError.message}` });
    return;
  }

  await supabase.from("phone_otp_verifications").delete().eq("user_id", userId);

  res.json({ verified: true, phone_number: pending.phone_number });
});

/** GET /api/phone/status — current verification state, for the
 *  Settings page ("No phone number added" vs "Verified: [number]"). */
router.get("/phone/status", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("phone_number, phone_verified")
    .eq("id", userId)
    .single();

  if (error || !profile) {
    res.status(500).json({ error: "Failed to load phone status" });
    return;
  }

  res.json({ phone_number: profile.phone_verified ? profile.phone_number : null, phone_verified: profile.phone_verified });
});

export default router;
