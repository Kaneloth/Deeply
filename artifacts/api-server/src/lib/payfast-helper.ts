import crypto from "node:crypto";

const PAYFAST_MODE = process.env.PAYFAST_MODE === "live" ? "live" : "sandbox";
const PAYFAST_HOST = PAYFAST_MODE === "live" ? "www.payfast.co.za" : "sandbox.payfast.co.za";

const MERCHANT_ID = process.env.PAYFAST_MERCHANT_ID;
const MERCHANT_KEY = process.env.PAYFAST_MERCHANT_KEY;
const PASSPHRASE = process.env.PAYFAST_PASSPHRASE || undefined; // optional — omit entirely if not set on your PayFast account, including an empty passphrase in the signature breaks it

// PayFast's backend is PHP, and their signature check re-derives the
// string using PHP's urlencode() — which differs from JS's
// encodeURIComponent() in ways that silently break signatures if not
// corrected: PHP encodes spaces as "+" (not "%20"), PHP additionally
// escapes a few characters ( ! ' ( ) * ~ ) that encodeURIComponent
// leaves untouched. This function corrects all of these so the string
// byte-matches what PayFast's PHP server computes.
function phpUrlEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, "+")
    .replace(/[!'()*~]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

// The signature is NOT alphabetical — it must follow this exact field
// order, taken directly from PayFast's own integration documentation.
// Fields with an empty/undefined value are skipped entirely, both from
// the signature string and the actual form submission.
const CHECKOUT_FIELD_ORDER = [
  "merchant_id", "merchant_key", "return_url", "cancel_url", "notify_url",
  "name_first", "name_last", "email_address", "cell_number",
  "m_payment_id", "amount", "item_name", "item_description",
  "custom_str1", "custom_str2", "custom_str3", "custom_str4", "custom_str5",
  "email_confirmation", "confirmation_address",
] as const;

function generateCheckoutSignature(data: Record<string, string | undefined>): string {
  let pfOutput = "";
  for (const key of CHECKOUT_FIELD_ORDER) {
    const val = data[key];
    if (val !== undefined && val !== "") {
      pfOutput += `${key}=${phpUrlEncode(val.trim())}&`;
    }
  }
  let getString = pfOutput.slice(0, -1); // drop trailing &
  if (PASSPHRASE) {
    getString += `&passphrase=${phpUrlEncode(PASSPHRASE.trim())}`;
  }
  return crypto.createHash("md5").update(getString).digest("hex");
}

export interface PayfastCheckoutParams {
  m_payment_id: string;
  amount: string; // must be a plain decimal string with 2 places, e.g. "79.00" — not a number, not currency-formatted
  item_name: string;
  custom_str1: string; // used to carry userId + bundleId through to the ITN webhook
  name_first?: string;
  email_address?: string;
  return_url: string;
  cancel_url: string;
  notify_url: string;
}

/** Builds the fields (including signature) for a PayFast "onsite/offsite
 *  redirect" checkout — POST these as a hidden form to action_url,
 *  which redirects the user to PayFast's hosted payment page. */
export function buildPayfastCheckout(params: PayfastCheckoutParams) {
  if (!MERCHANT_ID || !MERCHANT_KEY) {
    throw new Error("PAYFAST_MERCHANT_ID / PAYFAST_MERCHANT_KEY are not set");
  }

  const fields: Record<string, string | undefined> = {
    merchant_id: MERCHANT_ID,
    merchant_key: MERCHANT_KEY,
    return_url: params.return_url,
    cancel_url: params.cancel_url,
    notify_url: params.notify_url,
    name_first: params.name_first,
    email_address: params.email_address,
    m_payment_id: params.m_payment_id,
    amount: params.amount,
    item_name: params.item_name,
    custom_str1: params.custom_str1,
  };

  const signature = generateCheckoutSignature(fields);

  return {
    action_url: `https://${PAYFAST_HOST}/eng/process`,
    fields: { ...fields, signature },
  };
}

/** Validates an incoming ITN (Instant Transaction Notification) POST.
 *  Per PayFast's own required security checks: (1) signature validity,
 *  (2) confirm with PayFast's server directly — more robust than
 *  matching PayFast's source IP ranges, which can change over time.
 *  Does NOT check the amount — the caller must do that separately
 *  against whatever amount was actually expected for this transaction,
 *  since only the caller knows what was originally charged. */
export async function validateItn(body: Record<string, string>): Promise<boolean> {
  const { signature: receivedSignature, ...rest } = body;

  // ITN payloads are signed using the fields AS RECEIVED, in whatever
  // order they arrive in the POST body — NOT the checkout field order
  // above, and NOT alphabetical. This relies on Express's urlencoded
  // body parser preserving field order from the raw POST body into
  // req.body, which holds true for the standard parser.
  //
  // IMPORTANT: unlike checkout signature generation (where empty
  // optional fields get skipped, per PayFast's documented rule for that
  // direction), every field is included here, even blank ones. The ITN
  // is a complete, fixed payload PayFast constructs and signs on their
  // own side — there's no confirmed evidence their own ITN signing
  // skips blanks the same way, and PayFast ITN payloads routinely carry
  // many blank fields (unused custom_str/custom_int slots, empty
  // name_last, etc.) that must still be included for the signature to
  // match.
  let pfOutput = "";
  for (const [key, val] of Object.entries(rest)) {
    if (val !== undefined) {
      pfOutput += `${key}=${phpUrlEncode(String(val).trim())}&`;
    }
  }
  let getString = pfOutput.slice(0, -1);
  if (PASSPHRASE) {
    getString += `&passphrase=${phpUrlEncode(PASSPHRASE.trim())}`;
  }
  const expectedSignature = crypto.createHash("md5").update(getString).digest("hex");

  // TEMPORARY — remove once the signature mismatch is resolved.
  console.error("PAYFAST ITN DEBUG raw body:", JSON.stringify(rest));
  console.error("PAYFAST ITN DEBUG computed string:", getString);
  console.error("PAYFAST ITN DEBUG expected signature:", expectedSignature);
  console.error("PAYFAST ITN DEBUG received signature:", receivedSignature);
  console.error("PAYFAST ITN DEBUG passphrase configured:", PASSPHRASE ? "yes" : "no");

  if (expectedSignature !== receivedSignature) {
    console.error("PayFast ITN signature mismatch");
    return false;
  }

  const validateRes = await fetch(`https://${PAYFAST_HOST}/eng/query/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(rest).toString(),
  });
  const validateText = (await validateRes.text()).trim();

  if (validateText !== "VALID") {
    console.error(`PayFast server-side validation returned: ${validateText}`);
    return false;
  }

  return true;
}