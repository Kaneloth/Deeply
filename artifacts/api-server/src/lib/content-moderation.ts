import { logger } from "./logger";

const GOOGLE_VISION_API_KEY = process.env.GOOGLE_CLOUD_VISION_API_KEY;

// Google's SafeSearch likelihood scale: UNKNOWN, VERY_UNLIKELY, UNLIKELY,
// POSSIBLE, LIKELY, VERY_LIKELY. Rejecting at LIKELY/VERY_LIKELY is a
// fairly standard threshold — strict enough to catch real explicit
// content, loose enough to avoid false-positiving on things like beach
// photos or fitness pics. If explicit content is slipping through,
// tighten this further (e.g. reject at POSSIBLE too); if legitimate
// photos keep getting blocked, loosen it to only VERY_LIKELY.
const REJECT_LIKELIHOODS = new Set(["LIKELY", "VERY_LIKELY"]);

export interface SafetyCheckResult {
  safe: boolean;
  reason?: string;
}

/**
 * Runs a photo through Google Cloud Vision's SafeSearch Detection before
 * it's allowed to be saved as a profile photo. Images only — Vision's
 * SafeSearch API doesn't cover video; the 5-second video clip upload
 * path deliberately skips this check (video moderation would need Google
 * Cloud Video Intelligence, a separate, more expensive integration).
 *
 * Fails OPEN on any Vision API error (network issue, quota exhausted,
 * misconfigured key) — an outage in the moderation service shouldn't
 * mean nobody can upload photos at all. Every failure is logged so it's
 * visible rather than silent. If you'd rather fail CLOSED (block uploads
 * entirely when the safety check can't run), flip the two `return {
 * safe: true }` fallbacks below to `{ safe: false, reason: ... }`.
 */
export async function checkImageSafety(buffer: Buffer): Promise<SafetyCheckResult> {
  if (!GOOGLE_VISION_API_KEY) {
    logger.warn("GOOGLE_CLOUD_VISION_API_KEY is not set — skipping photo content moderation");
    return { safe: true };
  }

  try {
    const base64Image = buffer.toString("base64");

    const response = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_VISION_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [
            {
              image: { content: base64Image },
              features: [{ type: "SAFE_SEARCH_DETECTION" }],
            },
          ],
        }),
      },
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      logger.error({ status: response.status, errText }, "Vision API request failed — failing open");
      return { safe: true };
    }

    const data = await response.json();
    const safeSearch = data?.responses?.[0]?.safeSearchAnnotation;

    if (!safeSearch) {
      logger.warn({ data }, "Vision API returned no safeSearchAnnotation — failing open");
      return { safe: true };
    }

    // Deliberately checking `adult` only, not `racy`. Vision's `racy`
    // signal fires on completely normal dating-app content — bikinis,
    // lingerie, beach photos — none of which should be blocked here.
    // `adult` specifically targets actual nudity/explicit sexual content,
    // which is what this check is meant to catch.
    if (REJECT_LIKELIHOODS.has(safeSearch.adult)) {
      return {
        safe: false,
        reason: "This photo appears to contain explicit content and can't be uploaded. Please choose a different photo.",
      };
    }

    return { safe: true };
  } catch (err) {
    logger.error({ err }, "checkImageSafety threw — failing open");
    return { safe: true };
  }
}