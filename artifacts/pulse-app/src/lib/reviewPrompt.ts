import { Capacitor } from "@capacitor/core";

// Local-only, on-device storage — a deliberate, accepted tradeoff:
// simpler than syncing this to the backend, at the cost of resetting
// if the app is reinstalled or the person switches devices. For a
// review prompt specifically (low-stakes, not something that breaks
// anything if it fires a little more than intended after a reinstall),
// this tradeoff was judged worth the simplicity.
const COUNT_KEY = "review_prompt_count";
const LAST_PROMPTED_AT_KEY = "review_prompt_last_at";

// Even if someone hits both trigger conditions repeatedly, don't ask
// more than this many times ever, and never within this many days of
// the last ask. Google's own API never reports whether someone actually
// left a review — only that the request was made — so this is the only
// lever available for "don't keep asking someone who's already said no
// (silently, by dismissing) several times."
const MAX_LIFETIME_PROMPTS = 4;
const COOLDOWN_DAYS = 90;

function getCount(): number {
  return Number(localStorage.getItem(COUNT_KEY) ?? "0");
}

function getLastPromptedAt(): number | null {
  const raw = localStorage.getItem(LAST_PROMPTED_AT_KEY);
  return raw ? Number(raw) : null;
}

function recordPrompt(): void {
  localStorage.setItem(COUNT_KEY, String(getCount() + 1));
  localStorage.setItem(LAST_PROMPTED_AT_KEY, String(Date.now()));
}

function isEligible(): boolean {
  if (getCount() >= MAX_LIFETIME_PROMPTS) return false;
  const lastPromptedAt = getLastPromptedAt();
  if (lastPromptedAt && Date.now() - lastPromptedAt < COOLDOWN_DAYS * 24 * 60 * 60 * 1000) return false;
  return true;
}

/** Call this right after a genuine positive moment (a completed video
 *  call, reaching the 3rd match) — never on a timer, never after
 *  anything negative. Silently does nothing on web (the underlying
 *  plugin is native-only) or once the cooldown/lifetime cap says this
 *  isn't the right moment, so callers never need to check eligibility
 *  themselves first — just call this at the moment the positive event
 *  actually happens. */
export async function maybeRequestReview(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (!isEligible()) return;

  try {
    // Imported dynamically rather than at the top of the file — this
    // plugin's native module doesn't exist on web at all, and a static
    // top-level import could break the web build/bundle even though
    // the isNativePlatform() check above already prevents this code
    // from actually running there.
    const { AppReview } = await import("@capawesome/capacitor-app-review");
    await AppReview.requestReview();
    recordPrompt();
  } catch {
    // Silent — if the native call itself fails for any reason, this
    // is a nice-to-have feature, not something worth surfacing an
    // error for. Deliberately does NOT call recordPrompt() in this
    // path, so a genuine failure (as opposed to Google's own silent
    // throttling, which still counts as "asked" from this app's own
    // perspective) doesn't count against the lifetime cap.
  }
}

/** Call this every time a match celebration is shown, from any of the
 *  places a match can happen (a normal swipe match, a voice-question-
 *  reply match, a message-request match — DiscoverPage.tsx has all
 *  three). Fires the review prompt exactly once, the moment this
 *  becomes the 3rd match ever — not the 1st or 2nd (too early to have
 *  a real opinion yet), and not again at the 4th/5th/etc. (a one-time
 *  milestone, not a recurring trigger — the video-call trigger and the
 *  overall cooldown/cap already cover "ask again later if warranted").
 *  The backend's own match count isn't surfaced in the swipe response
 *  at all, so this tracks locally rather than adding a new network
 *  call just for this — same local-only tradeoff already accepted for
 *  the review-prompt state itself. */
const MATCH_COUNT_KEY = "review_prompt_match_count";
const MATCH_MILESTONE = 3;

export function recordMatchAndMaybeRequestReview(): void {
  const newCount = Number(localStorage.getItem(MATCH_COUNT_KEY) ?? "0") + 1;
  localStorage.setItem(MATCH_COUNT_KEY, String(newCount));
  if (newCount === MATCH_MILESTONE) {
    maybeRequestReview().catch(() => {});
  }
}

