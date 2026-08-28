/** BulkSMS.com integration for sending SMS (used for phone-number OTP
 *  verification — see phone-verification.ts).
 *
 *  BulkSMS.com's JSON v1 API (https://www.bulksms.com/developer/json/v1/)
 *  authenticates via an "API token" generated in their dashboard, which is
 *  actually a TOKEN ID + TOKEN SECRET pair used together as HTTP Basic
 *  Auth credentials — this is separate from your account login
 *  username/password. If sends are failing with a 401, double-check that
 *  BULKSMS_TOKEN_ID/BULKSMS_TOKEN_SECRET below are the token pair from
 *  your dashboard's "API tokens" section, not your account login itself.
 *
 *  Required env vars:
 *    BULKSMS_TOKEN_ID
 *    BULKSMS_TOKEN_SECRET
 */

const BULKSMS_API_URL = "https://api.bulksms.com/v1/messages";

export interface SendSmsResult {
  success: boolean;
  errorMessage?: string;
}

export async function sendSms(toPhoneNumber: string, body: string): Promise<SendSmsResult> {
  const tokenId = process.env.BULKSMS_TOKEN_ID;
  const tokenSecret = process.env.BULKSMS_TOKEN_SECRET;

  if (!tokenId || !tokenSecret) {
    console.error("BulkSMS: BULKSMS_TOKEN_ID/BULKSMS_TOKEN_SECRET not configured");
    return { success: false, errorMessage: "SMS sending is not configured" };
  }

  const basicAuth = Buffer.from(`${tokenId}:${tokenSecret}`).toString("base64");

  try {
    const response = await fetch(BULKSMS_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/json",
      },
      // BulkSMS's endpoint always expects an array of messages, even for
      // a single send.
      body: JSON.stringify([{ to: toPhoneNumber, body }]),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      console.error(`BulkSMS send failed: ${response.status} ${errorBody}`);
      return { success: false, errorMessage: "We couldn't send the code. Please check your number and try again." };
    }

    return { success: true };
  } catch (err) {
    console.error(`BulkSMS send threw: ${err instanceof Error ? err.message : String(err)}`);
    return { success: false, errorMessage: "We couldn't send the code. Please check your number and try again." };
  }
}
