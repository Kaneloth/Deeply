import crypto from "node:crypto";

const PACKAGE_NAME = "za.co.deeplydating.app"; // must match capacitor.config.ts appId exactly

// Thrown specifically when Google reports a purchase as test-type (see
// the purchaseType check below) — exported so sparks.ts's catch block
// can distinguish this from a genuine verification failure and show a
// message that actually explains what happened.
export class TestPurchaseError extends Error {
  constructor() {
    super("Purchase was made from a license testing account or non-production track — not a real payment");
    this.name = "TestPurchaseError";
  }
}

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function loadServiceAccount(): ServiceAccountKey {
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not set");
  }
  return JSON.parse(raw);
}

// Cache the access token between calls — each is valid ~1hr, so signing
// a fresh JWT and round-tripping to Google on literally every purchase
// verification would be wasteful.
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const key = loadServiceAccount();
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(key.private_key);
  const jwt = `${unsigned}.${base64url(signature)}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => "");
    throw new Error(`Failed to obtain Google access token: ${tokenRes.status} ${body}`);
  }

  const tokenBody = (await tokenRes.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: tokenBody.access_token, expiresAt: Date.now() + tokenBody.expires_in * 1000 };
  return cachedToken.token;
}

/** Verifies a purchase token against the Play Developer API, then
 *  consumes it — required for consumable products (Sparks) so the same
 *  SKU can be bought again, and this also satisfies Google's
 *  acknowledge-within-3-days requirement (consuming implicitly
 *  acknowledges). Throws if the purchase isn't genuinely valid; the
 *  caller must not grant Sparks unless this resolves successfully. */
export async function verifyAndConsumeGooglePurchase(productId: string, purchaseToken: string): Promise<void> {
  const accessToken = await getAccessToken();

  const getRes = await fetch(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/purchases/products/${productId}/tokens/${purchaseToken}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!getRes.ok) {
    const body = await getRes.text().catch(() => "");
    throw new Error(`Google Play purchase lookup failed: ${getRes.status} ${body}`);
  }

  const purchase = (await getRes.json()) as { purchaseState: number; purchaseType?: number };

  // purchaseState: 0 = Purchased, 1 = Canceled, 2 = Pending.
  if (purchase.purchaseState !== 0) {
    throw new Error(`Purchase is not in a completed state (purchaseState=${purchase.purchaseState})`);
  }

  // purchaseType is only set at all when the purchase did NOT go through
  // the standard billing flow — 0 = Test (bought from a license tester
  // account, or from a build still confined to a Play Console testing
  // track rather than Production), 1 = Promo, 2 = Rewarded. This is the
  // permanent safeguard against a real-money bundle being "purchased"
  // for free — rejecting purchaseType === 0 here holds regardless of
  // which track the installing app came from. A distinct error class
  // (not a plain Error) so sparks.ts's catch block can tell this case
  // apart from a genuine verification failure and surface a message
  // that actually explains what happened, rather than a generic
  // "couldn't verify" that reads as a bug to a real user who's simply
  // still on an old testing-track install.
  if (purchase.purchaseType === 0) {
    throw new TestPurchaseError();
  }

  const consumeRes = await fetch(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/purchases/products/${productId}/tokens/${purchaseToken}:consume`,
    { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!consumeRes.ok) {
    const body = await consumeRes.text().catch(() => "");
    // The purchase WAS verified as valid above, so Sparks still get
    // granted by the caller — but log loudly, since a failed consume
    // means this exact token can't be re-verified later if something
    // downstream needs to re-check it.
    console.error(`Failed to consume Google Play purchase ${purchaseToken}: ${consumeRes.status} ${body}`);
  }
}