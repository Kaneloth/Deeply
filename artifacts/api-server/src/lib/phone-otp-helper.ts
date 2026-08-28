import crypto from "crypto";

export const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
export const OTP_RESEND_COOLDOWN_MS = 30 * 1000; // 30 seconds
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_LOCKOUT_MS = 30 * 60 * 1000; // 30 minutes

export function generateOtpCode(): string {
  // 6-digit code, zero-padded (crypto.randomInt is cryptographically
  // strong, unlike Math.random — this is a security-relevant code even
  // though it's short-lived).
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

// Hashed rather than stored in plaintext — mainly so a casual DB viewer
// (or a DB leak) can't directly read out an active, usable code. The
// pepper is a fixed server-side secret so the hash can't be
// reconstructed from the DB contents alone. This is defense in depth,
// not the primary protection against brute force — that's the
// attempt-count/lockout logic in the verify route, since a hashed
// 6-digit code (1,000,000 possibilities) is trivially brute-forceable
// offline if an attacker has both the hash and unlimited guesses.
export function hashOtpCode(code: string): string {
  const pepper = process.env.OTP_HASH_PEPPER ?? "";
  if (!pepper) {
    console.error("phone-otp-helper: OTP_HASH_PEPPER is not set — hashing without a pepper");
  }
  return crypto.createHash("sha256").update(`${code}:${pepper}`).digest("hex");
}

// Basic E.164 check: a leading +, then 7–15 digits, first digit non-zero.
// Deliberately not stricter than this — real-world validity (whether a
// given number is actually assignable in a given country) is genuinely
// hard to get right and isn't worth attempting here; the OTP send itself
// is the real validation, since BulkSMS will simply fail to deliver to a
// bogus number.
export function isValidE164(phoneNumber: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(phoneNumber);
}
