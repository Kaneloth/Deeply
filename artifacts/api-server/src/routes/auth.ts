import { Router, type IRouter } from "express";
import { supabase } from "../lib/supabase";
import { requireAuth } from "../middlewares/auth";
import { recordGrantForAbuseCheck } from "../lib/sparks-helper";

const router: IRouter = Router();

// ============================================================
// Grant abuse prevention — normalizes an email to catch the common
// "infinite email addresses" trick most providers unintentionally
// support: Gmail (and Googlemail) ignore dots in the local part
// entirely, and virtually every major provider (Gmail, Outlook,
// Yahoo, iCloud, etc.) supports "+tag" addressing where everything
// after a "+" is stripped by the provider but still delivers to the
// same real inbox. Both let someone register what looks like dozens
// of unique addresses that are all actually the same mailbox — this
// normalization collapses them back to one canonical form so the
// grant-cooldown check in sparks-helper.ts can actually catch that.
//
// This is deliberately a simple, best-effort normalization, not a
// full email-provider-aware library — it specifically targets the
// two tricks that are trivial for anyone to discover and repeat, not
// every possible provider-specific quirk.
function normalizeEmail(email: string): string {
  const trimmed = email.toLowerCase().trim();
  const atIndex = trimmed.lastIndexOf("@");
  if (atIndex === -1) return trimmed;

  const localPart = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);

  const withoutPlusTag = localPart.split("+")[0];

  const isGmail = domain === "gmail.com" || domain === "googlemail.com";
  const finalLocalPart = isGmail ? withoutPlusTag.replace(/\./g, "") : withoutPlusTag;
  const finalDomain = isGmail ? "gmail.com" : domain; // treat googlemail.com as identical to gmail.com

  return `${finalLocalPart}@${finalDomain}`;
}

// Referral system — see referral_system_migration.sql for the full
// format rationale (DLY-0000XXX, 175,760,000 possible codes) and the
// one-time backfill this exact same generation logic mirrors for
// pre-existing profiles.
const REFERRAL_CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const REFERRAL_CODE_DIGITS = "0123456789";

function generateReferralCode(): string {
  let code = "DLY-";
  for (let i = 0; i < 4; i++) code += REFERRAL_CODE_DIGITS[Math.floor(Math.random() * REFERRAL_CODE_DIGITS.length)];
  for (let i = 0; i < 3; i++) code += REFERRAL_CODE_CHARS[Math.floor(Math.random() * REFERRAL_CODE_CHARS.length)];
  return code;
}

/** Assigns a unique referral code to a newly-created profile row,
 *  retrying with a freshly generated code on the rare collision
 *  (Postgres unique_violation, code 23505) rather than failing the
 *  whole signup over it — with ~175 million possible codes, a
 *  collision should be exceptionally rare, but signup must never be
 *  blocked by one regardless. Gives up silently after a handful of
 *  attempts rather than retrying forever; a missing code here is
 *  recoverable later (support can backfill one manually), but a
 *  signup that never completes over it would not be. */
async function assignReferralCode(userId: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode();
    const { error } = await supabase.from("profiles").update({ referral_code: code }).eq("id", userId);
    if (!error) return;
    if (error.code !== "23505") {
      console.error(`Failed to assign referral code for userId=${userId}: ${error.message}`);
      return;
    }
    // Unique violation — loop again with a freshly generated code.
  }
  console.error(`Failed to assign a unique referral code for userId=${userId} after 5 attempts`);
}

// Used by the referral fraud-flagging checks (see profile.ts's PUT
// /profile/me) — a shared IP between a referrer and their new user is
// one signal among several, not a hard block on its own.
//
// req.ip/req.socket.remoteAddress would just report Netlify's own
// internal proxy address, not the actual visitor — x-forwarded-for is
// what Netlify's edge layer sets to the real client IP. It can contain
// a comma-separated chain if multiple proxies were involved; the first
// entry is the original client, which is the one that matters here.
function getClientIp(req: { headers: Record<string, string | string[] | undefined> }): string | null {
  const header = req.headers["x-forwarded-for"];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  return value.split(",")[0].trim() || null;
}

/** POST /api/auth/signup */
router.post("/auth/signup", async (req, res): Promise<void> => {
  const { email, password, device_id } = req.body as {
    email?: string;
    password?: string;
    // Native-only (see AuthPage.tsx) — Capacitor's Device.getId(),
    // absent entirely for web signups. Optional throughout this whole
    // route; a missing value just means this specific defense doesn't
    // apply to this signup, not an error.
    device_id?: string;
  };

  if (!email || !password) {
    res.status(400).json({ error: "email and password are required" });
    return;
  }

  // Blocks Google's own Firebase Test Lab bot accounts, used by Google
  // Play's "Pre-launch report" feature — an automated crawler that
  // randomly taps through the app on every new release upload to catch
  // crashes before real users see them. Confirmed via a real occurrence:
  // it can accidentally complete a sign-in (random taps sometimes land
  // on the right buttons), then continues tapping incoherently through
  // everything after, which is why it never completes onboarding — it's
  // not a real person, and blocking it here means no fake account (auth
  // user + profile row) ever gets created for it at all, rather than
  // needing to clean one up after the fact. This specific email domain
  // is exclusively used for this purpose — never a genuine signup.
  if (email.toLowerCase().endsWith("@cloudtestlabaccounts.com")) {
    res.status(400).json({ error: "Signups from this address are not permitted." });
    return;
  }

  // Same blocklist checked in /auth/record-google-signup below, for the
  // same confirmed spam-signup pattern — but genuinely more effective
  // here specifically: this route runs before supabase.auth.signUp() is
  // ever called, so a blocked device is prevented from creating an
  // account at all, rather than needing to be deleted after the fact
  // (which is all the Google sign-in path can do, since Supabase
  // creates that account directly, client-side, before this backend
  // ever sees the request).
  if (device_id) {
    const { data: blocked } = await supabase.from("blocked_device_ids").select("device_id").eq("device_id", device_id).maybeSingle();
    if (blocked) {
      res.status(403).json({ error: "This device is not permitted to create an account." });
      return;
    }
  }

  // Name is no longer collected here — the signup screen asking for it
  // duplicated the Name field onboarding already asks for right after
  // (and for Google sign-in, that name gets auto-populated from Google's
  // own profile data without ever being confirmed by the person at all).
  // Collecting it once, during onboarding, avoids both problems — see
  // OnboardingPage.tsx and profile.ts. options.data is passed as an
  // empty object rather than omitted entirely, since Supabase's signUp
  // still expects the `options` shape even with nothing in `data`.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: {} },
  });

  if (error) {
    res.status(400).json({ error: error.message });
    return;
  }

  if (!data.user) {
    res.status(400).json({ error: "Signup failed" });
    return;
  }

  // The on_auth_user_created trigger creates this profiles row, but its
  // effects aren't guaranteed to be immediately visible to this
  // separate connection right after signUp() returns — this exact
  // project has already confirmed this same class of read-after-write
  // lag repeatedly elsewhere (matches, video_calls, profiles itself in
  // the account-deletion flow). If this row doesn't exist yet from this
  // connection's view, the updates below would silently match ZERO
  // rows — which Postgres/PostgREST report as { error: null }, not an
  // error — meaning both the device/email/IP capture AND the referral
  // code assignment could silently no-op with nothing ever logged,
  // while looking identical to success. Verifying existence first, with
  // a short retry, closes that gap rather than assuming the row is
  // instantly visible on this connection.
  let profileRowExists = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: existing } = await supabase.from("profiles").select("id").eq("id", data.user.id).maybeSingle();
    if (existing) {
      profileRowExists = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (!profileRowExists) {
    console.error(`profiles row never became visible for userId=${data.user.id} after signup — device/email/IP capture and referral code assignment both skipped`);
  }

  // Stored as soon as the auth user exists, before the email-confirmed
  // check below — a profiles row for this user id already exists by
  // this point (created via the on_auth_user_created trigger), and
  // these two values need to be captured regardless of whether this
  // signup still needs email confirmation, so the grant-cooldown check
  // in sparks-helper.ts has them available from this account's very
  // first monthly grant, whenever that ends up happening.
  if (profileRowExists) {
    await supabase
      .from("profiles")
      .update({
        signup_device_id: device_id ?? null,
        normalized_email: normalizeEmail(email),
        signup_ip: getClientIp(req),
      })
      .eq("id", data.user.id);
  }

  // Recorded immediately at signup, not left to only happen reactively
  // whenever the first monthly grant eventually processes (which this
  // account might delete itself before ever reaching) — see
  // recordGrantForAbuseCheck's own comment in sparks-helper.ts for the
  // confirmed real-world gap this closes.
  if (profileRowExists) {
    await recordGrantForAbuseCheck(data.user.id, device_id ?? null, normalizeEmail(email)).catch((err) =>
      console.error(`Failed to record signup for abuse check, userId=${data.user.id}:`, err),
    );
  }

  if (profileRowExists) {
    await assignReferralCode(data.user.id);
  }

  if (!data.session) {
    res.status(201).json({
      requiresEmailConfirmation: true,
      user: { id: data.user.id, email: data.user.email },
    });
    return;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", data.user.id)
    .single();

  res.status(201).json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_in: data.session.expires_in,
    user: { id: data.user.id, email: data.user.email },
    profile,
  });
});

/** POST /api/auth/verify-otp */
router.post("/auth/verify-otp", async (req, res): Promise<void> => {
  const { email, code } = req.body as { email?: string; code?: string };

  if (!email || !code) {
    res.status(400).json({ error: "email and code are required" });
    return;
  }

  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: code,
    type: "signup",
  });

  if (error || !data.user || !data.session) {
    res.status(400).json({ error: error?.message ?? "Invalid or expired code" });
    return;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", data.user.id)
    .single();

  res.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_in: data.session.expires_in,
    user: { id: data.user.id, email: data.user.email },
    profile,
  });
});

/** POST /api/auth/resend-otp */
router.post("/auth/resend-otp", async (req, res): Promise<void> => {
  const { email } = req.body as { email?: string };

  if (!email) {
    res.status(400).json({ error: "email is required" });
    return;
  }

  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
  });

  if (error) {
    res.status(400).json({ error: error.message });
    return;
  }

  res.sendStatus(204);
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
    const message =
      error?.message === "Email not confirmed"
        ? "Please confirm your email before logging in. Check your inbox for the confirmation code."
        : (error?.message ?? "Invalid credentials");
    res.status(401).json({ error: message });
    return;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", data.user.id)
    .single();

  // A session was just issued by signInWithPassword above — if this
  // account is banned/suspended, invalidate it immediately and refuse the
  // login outright, rather than letting them in and only blocking their
  // next request (which requireAuth also enforces, but with a much less
  // clear error for the person trying to sign in).
  if (profile?.banned) {
    await supabase.auth.admin.signOut(data.session.access_token);
    res.status(403).json({
      error: "This account has been banned.",
      code: "BANNED",
      reason: profile.ban_reason ?? undefined,
    });
    return;
  }
  if (profile?.suspended_until && new Date(profile.suspended_until) > new Date()) {
    await supabase.auth.admin.signOut(data.session.access_token);
    res.status(403).json({
      error: "This account is temporarily suspended.",
      code: "SUSPENDED",
      reason: profile.suspension_reason ?? undefined,
      suspendedUntil: profile.suspended_until,
    });
    return;
  }

  res.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_in: data.session.expires_in,
    user: { id: data.user.id, email: data.user.email },
    profile,
  });
});

/** POST /api/auth/refresh — silently renew an expired/expiring access
 *  token using the long-lived refresh token, so users don't get logged
 *  out every hour. */
router.post("/auth/refresh", async (req, res): Promise<void> => {
  const { refresh_token } = req.body as { refresh_token?: string };

  if (!refresh_token) {
    res.status(400).json({ error: "refresh_token is required" });
    return;
  }

  const { data, error } = await supabase.auth.refreshSession({ refresh_token });

  if (error || !data.session) {
    res.status(401).json({ error: error?.message ?? "Could not refresh session" });
    return;
  }

  res.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_in: data.session.expires_in,
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

/** GET /api/auth/me — basic account info (email) for Settings, since
 *  profiles doesn't store email itself. Also reports has_password —
 *  Google-only sign-ins have no email/password identity at all, so
 *  there's nothing for them to "change" the first time; the frontend
 *  uses this to show "Create password" instead of "Change password"
 *  and skip asking for a current password that was never set. */
router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const { data, error } = await supabase.auth.admin.getUserById(req.user!.id);
  if (error || !data.user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  const hasPassword = !!data.user.identities?.some((i) => i.provider === "email");
  res.json({ id: data.user.id, email: data.user.email, has_password: hasPassword });
});

/** POST /api/auth/link-google-metadata — captures signup_device_id and
 *  signup_ip for Google sign-ins, closing a confirmed real gap: those
 *  two fields were only ever populated by the email/password
 *  /auth/signup route, which Google OAuth never touches at all
 *  (Supabase handles the token exchange directly, client-side).
 *  Confirmed via a real investigation into a suspected mass-signup
 *  pattern: every single one of ~21 flagged accounts, all created via
 *  Google, had NULL signup_device_id AND signup_ip — meaning the
 *  entire grant-abuse-cooldown system (getAbuseDelayUntil in
 *  sparks-helper.ts) had zero ability to ever detect reuse across
 *  accounts on this specific signup path, regardless of how
 *  unsophisticated the abuse actually was.
 *
 *  Called once, right after a Google sign-in succeeds, from both the
 *  native (AuthPage.tsx) and web (AuthCallbackPage.tsx) flows.
 *
 *  Deliberately only ever writes these fields the FIRST time an
 *  account is seen here — an unconditional overwrite would corrupt the
 *  abuse-detection system by replacing the account's original signup
 *  device/IP with whatever device happens to be used on a LATER,
 *  perfectly ordinary login. */
router.post("/auth/link-google-metadata", requireAuth, async (req, res): Promise<void> => {
  const { device_id } = req.body as { device_id?: string };
  const userId = req.user!.id;

  const { data: profile } = await supabase
    .from("profiles")
    .select("signup_device_id, signup_ip, normalized_email")
    .eq("id", userId)
    .maybeSingle();

  if (!profile) {
    res.sendStatus(204);
    return;
  }

  // Already captured — either by an earlier call to this same endpoint,
  // or (shouldn't happen for a Google-only account, but a safe check
  // regardless) already set via the email/password signup route.
  if (profile.signup_device_id || profile.signup_ip) {
    res.sendStatus(204);
    return;
  }

  await supabase
    .from("profiles")
    .update({ signup_device_id: device_id ?? null, signup_ip: getClientIp(req) })
    .eq("id", userId);

  // Same treatment as the email/password signup flow's own call to this
  // — records this device/email as "used" immediately, closing the same
  // delete-and-resignup grant-abuse gap for Google sign-ins that was
  // already fixed for email/password.
  await recordGrantForAbuseCheck(userId, device_id ?? null, profile.normalized_email).catch((err) =>
    console.error(`Failed to record Google signup for abuse check, userId=${userId}:`, err),
  );

  res.sendStatus(204);
});

/** PUT /api/auth/change-password — requires the current password to be
 *  correct before allowing the change, UNLESS this account has never
 *  had one (Google-only sign-in) — in that case currentPassword is
 *  never even sent by the frontend, and there's genuinely nothing
 *  correct/incorrect to verify it against, so this sets the new
 *  password directly instead. */
router.put("/auth/change-password", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { currentPassword, newPassword } = req.body as {
    currentPassword?: string;
    newPassword?: string;
  };

  if (!newPassword) {
    res.status(400).json({ error: "newPassword is required" });
    return;
  }
  if (newPassword.length < 6) {
    res.status(400).json({ error: "New password must be at least 6 characters" });
    return;
  }

  const { data: userData, error: getUserError } = await supabase.auth.admin.getUserById(userId);
  if (getUserError || !userData.user?.email) {
    res.status(500).json({ error: "Could not verify account" });
    return;
  }

  const hasExistingPassword = !!userData.user.identities?.some((i) => i.provider === "email");

  if (hasExistingPassword) {
    if (!currentPassword) {
      res.status(400).json({ error: "currentPassword is required" });
      return;
    }
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: userData.user.email,
      password: currentPassword,
    });
    if (signInError) {
      res.status(401).json({ error: "Current password is incorrect" });
      return;
    }
  }

  const { error: updateError } = await supabase.auth.admin.updateUserById(userId, { password: newPassword });
  if (updateError) {
    res.status(500).json({ error: `Failed to update password: ${updateError.message}` });
    return;
  }

  res.sendStatus(204);
});

/** DELETE /api/auth/account — permanently deletes the profile, the
 *  underlying auth account, and the user's uploaded storage files
 *  (photos, video clips, audio prompts). Requires the current password
 *  to confirm — UNLESS this is a Google-only account with no password
 *  at all, in which case there's nothing to verify and the frontend's
 *  own "type DELETE to confirm" step is the only safeguard available,
 *  same reasoning as change-password above. Without this exception,
 *  a Google-only user could never delete their own account at all. */
/** Shared deletion sequence — extracted from DELETE /auth/account below
 *  so the new automated stale-incomplete-account cleanup can reuse this
 *  exact, already-proven-correct sequence (storage cleanup, profile
 *  delete, verify-then-auth-delete with the read-after-write lag fix)
 *  rather than duplicating it. Deliberately does NOT include the
 *  password-confirmation check — that's specific to a real person
 *  confirming their own deletion, not relevant to an automated cleanup
 *  acting on an account that was never actually claimed by completing
 *  onboarding.
 *
 *  Returns an error message on failure, or null on success — callers
 *  decide what to do with that (respond to a request vs. just log and
 *  continue to the next account in a batch). */
export async function deleteAccountCompletely(userId: string): Promise<string | null> {
  for (const bucket of ["profile-photos", "audio-prompts"]) {
    try {
      const { data: files } = await supabase.storage.from(bucket).list(userId);
      if (files && files.length > 0) {
        const paths = files.map((f) => `${userId}/${f.name}`);
        await supabase.storage.from(bucket).remove(paths);
      }
    } catch {
      // Non-fatal — don't block account deletion if storage cleanup
      // fails for one bucket; the account deletion itself still proceeds.
    }
  }

  const { error: profileDeleteError } = await supabase.from("profiles").delete().eq("id", userId);
  if (profileDeleteError) {
    console.error(`deleteAccountCompletely — profiles.delete() failed for userId=${userId}:`, JSON.stringify(profileDeleteError, null, 2));
    return `Failed to delete account: ${profileDeleteError.message}`;
  }

  let profileRowStillVisible = true;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: stillExists } = await supabase.from("profiles").select("id").eq("id", userId).maybeSingle();
    if (!stillExists) {
      profileRowStillVisible = false;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (profileRowStillVisible) {
    console.error(`deleteAccountCompletely — profile row never became invisible for userId=${userId}, proceeding to auth delete anyway`);
  }

  const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);
  if (deleteError) {
    console.error(
      `deleteAccountCompletely — auth.admin.deleteUser() failed for userId=${userId}: message="${deleteError.message}" status=${deleteError.status} code=${(deleteError as { code?: string }).code}`,
    );
    return `Failed to delete account: ${deleteError.message || "Unknown error — check server logs"}`;
  }

  return null;
}

router.delete("/auth/account", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { password } = req.body as { password?: string };

  const { data: userData, error: getUserError } = await supabase.auth.admin.getUserById(userId);
  if (getUserError || !userData.user?.email) {
    res.status(500).json({ error: "Could not verify account" });
    return;
  }

  const hasExistingPassword = !!userData.user.identities?.some((i) => i.provider === "email");

  if (hasExistingPassword) {
    if (!password) {
      res.status(400).json({ error: "password is required to confirm account deletion" });
      return;
    }
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: userData.user.email,
      password,
    });
    if (signInError) {
      res.status(401).json({ error: "Incorrect password" });
      return;
    }
  }

  const deletionError = await deleteAccountCompletely(userId);
  if (deletionError) {
    res.status(500).json({ error: deletionError });
    return;
  }

  res.sendStatus(204);
});

/** POST /api/auth/forgot-password — sends a password reset email. Always
 *  responds with success regardless of whether the email exists, so this
 *  can't be used to enumerate registered accounts. */
router.post("/auth/forgot-password", async (req, res): Promise<void> => {
  const { email, redirectTo } = req.body as { email?: string; redirectTo?: string };

  if (!email) {
    res.status(400).json({ error: "email is required" });
    return;
  }

  try {
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectTo || undefined,
    });
  } catch {
    // Intentionally swallowed — see the doc comment above.
  }

  res.sendStatus(204);
});

/** POST /api/auth/reset-password — completes a password reset using the
 *  access_token from the recovery email link (extracted client-side from
 *  the URL fragment, since fragments never reach the server directly). */
router.post("/auth/reset-password", async (req, res): Promise<void> => {
  const { accessToken, newPassword } = req.body as { accessToken?: string; newPassword?: string };

  if (!accessToken || !newPassword) {
    res.status(400).json({ error: "accessToken and newPassword are required" });
    return;
  }
  if (newPassword.length < 6) {
    res.status(400).json({ error: "New password must be at least 6 characters" });
    return;
  }

  const {
    data: { user },
    error: getUserError,
  } = await supabase.auth.getUser(accessToken);

  if (getUserError || !user) {
    res.status(401).json({ error: "This reset link is invalid or has expired. Please request a new one." });
    return;
  }

  const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, { password: newPassword });
  if (updateError) {
    res.status(500).json({ error: `Failed to reset password: ${updateError.message}` });
    return;
  }

  res.sendStatus(204);
});

/** POST /api/auth/_internal/backfill-referral-codes — safety net, not a
 *  root-cause fix. Called daily by the
 *  netlify/functions/backfill-referral-codes.mts scheduled function.
 *  Regardless of exactly why a given account ended up without a code
 *  (a signup-time race condition, or any other future cause) — this
 *  catches and fixes it within at most 24 hours, rather than a missing
 *  code being permanent unless someone happens to notice and manually
 *  intervene. Same shared-secret protection as video-calls.ts's
 *  stale-call cleanup route, for the same reason: the caller is a
 *  scheduled function, not a logged-in user with a JWT. */
router.post("/auth/_internal/backfill-referral-codes", async (req, res): Promise<void> => {
  const providedSecret = req.headers["x-internal-cleanup-secret"];
  if (!process.env.INTERNAL_CLEANUP_SECRET || providedSecret !== process.env.INTERNAL_CLEANUP_SECRET) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { data: missing } = await supabase.from("profiles").select("id").is("referral_code", null);

  for (const profile of missing ?? []) {
    await assignReferralCode(profile.id);
  }

  console.log(`backfill-referral-codes: processed ${missing?.length ?? 0} profile(s) missing a referral code`);
  res.status(200).json({ processed: missing?.length ?? 0 });
});

/** POST /api/auth/record-google-signup — closes a confirmed real gap:
 *  signup_device_id, signup_ip, and normalized_email were NEVER being
 *  captured for Google sign-ups at all, only for email/password signups
 *  via /auth/signup above. Google OAuth never touches that route —
 *  Supabase exchanges the token directly, client-side — so there was
 *  never a natural backend hook to capture this for that path.
 *
 *  Confirmed via a real investigation into a suspected mass-signup
 *  pattern: 21 accounts with disposable-looking, bot-generated emails
 *  (name.randomdigits@gmail.com) all showed signup_device_id AND
 *  signup_ip as null — not because they shared a device, but because
 *  the entire abuse-cooldown system (getAbuseDelayUntil in
 *  sparks-helper.ts) has had zero visibility into Google sign-ups this
 *  whole time, regardless of how the accounts were actually created.
 *
 *  Called once, right after a successful Google sign-in, from both the
 *  native flow (AuthPage.tsx's onGoogleSignIn) and the web OAuth
 *  redirect flow (AuthCallbackPage.tsx).
 *
 *  Deliberately idempotent — only ever sets these fields if they're
 *  still null. A person can legitimately sign in via Google again
 *  later from a different device; this must never overwrite the true,
 *  original signup capture with that later login's device/IP instead. */
router.post("/auth/record-google-signup", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { device_id: deviceId } = req.body as { device_id?: string };

  // Checked first, before anything else — if this device is blocked,
  // the account this Google sign-in just created (via Supabase's own
  // OAuth exchange, which already happened client-side before this
  // endpoint was ever called) is deleted immediately, within this same
  // request, rather than waiting for the 24-hour scheduled cleanup.
  // This can't prevent the Google sign-in itself from succeeding —
  // Supabase creates the account directly, before our backend ever
  // sees the request — but it does mean every future attempt from this
  // exact device becomes pointless in real time rather than eventually.
  if (deviceId) {
    const { data: blocked } = await supabase.from("blocked_device_ids").select("device_id").eq("device_id", deviceId).maybeSingle();
    if (blocked) {
      console.log(`Blocked device_id=${deviceId} attempted signup — deleting userId=${userId} immediately`);
      await deleteAccountCompletely(userId);
      res.status(403).json({ error: "This device is not permitted to create an account." });
      return;
    }
  }

  const { data: existing } = await supabase
    .from("profiles")
    .select("signup_device_id, signup_ip, normalized_email")
    .eq("id", userId)
    .maybeSingle();

  if (existing?.signup_device_id || existing?.signup_ip || existing?.normalized_email) {
    // Already captured — either a prior call to this same endpoint, or
    // (unexpectedly) already set some other way. Never overwrite.
    res.sendStatus(204);
    return;
  }

  const { data: userData } = await supabase.auth.admin.getUserById(userId);
  const email = userData.user?.email;
  const normalizedEmail = email ? normalizeEmail(email) : null;

  await supabase
    .from("profiles")
    .update({
      signup_device_id: deviceId ?? null,
      signup_ip: getClientIp(req),
      normalized_email: normalizedEmail,
    })
    .eq("id", userId);

  await recordGrantForAbuseCheck(userId, deviceId ?? null, normalizedEmail).catch((err) =>
    console.error(`Failed to record Google signup for abuse check, userId=${userId}:`, err),
  );

  res.sendStatus(204);
});

/** POST /api/auth/_internal/delete-stale-incomplete-accounts — safety
 *  net against the spam-signup pattern investigated earlier (disposable
 *  Google accounts, name.randomdigits@gmail.com, that never complete
 *  onboarding). 24-hour window is a deliberate product decision, not an
 *  arbitrary default: the email-delay guidance already shown on the OTP
 *  screen covers up to 20-30 minutes, comfortably within this window —
 *  and since nothing from the onboarding form actually saves until the
 *  final submit, a genuine person returning later isn't saved any real
 *  work by the old incomplete row still existing; they're re-entering
 *  everything from scratch either way. Called every 4 hours by the
 *  delete-stale-incomplete-accounts.mts scheduled function — more
 *  frequently than once a day specifically so an account crossing the
 *  24-hour mark doesn't sit for up to another full day before being
 *  caught, which would work against the actual goal of keeping
 *  accumulated volume down. */
router.post("/auth/_internal/delete-stale-incomplete-accounts", async (req, res): Promise<void> => {
  const providedSecret = req.headers["x-internal-cleanup-secret"];
  if (!process.env.INTERNAL_CLEANUP_SECRET || providedSecret !== process.env.INTERNAL_CLEANUP_SECRET) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: stale } = await supabase
    .from("profiles")
    .select("id")
    .not("onboarding_completed", "is", true)
    .lt("created_at", cutoff);

  let deleted = 0;
  let failed = 0;
  for (const profile of stale ?? []) {
    const error = await deleteAccountCompletely(profile.id);
    if (error) {
      failed += 1;
      console.error(`delete-stale-incomplete-accounts — failed for userId=${profile.id}: ${error}`);
    } else {
      deleted += 1;
    }
  }

  console.log(`delete-stale-incomplete-accounts: deleted=${deleted} failed=${failed}`);
  res.status(200).json({ deleted, failed });
});

export default router;