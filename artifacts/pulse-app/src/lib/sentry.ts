/**
 * Sentry error monitoring initialisation — Capacitor-aware, so it
 * captures native-level Android crashes (via @sentry/capacitor) in
 * addition to JavaScript errors inside the WebView, not just the latter.
 *
 * Call initSentry() once at the very top of main.tsx, before React renders.
 *
 * Required environment variable (set in Netlify → Site settings → Env vars):
 *   VITE_SENTRY_DSN — the DSN string from your Sentry project
 *
 * If the variable is missing or empty, Sentry stays disabled silently
 * (useful during local development when you don't want noise).
 */

import * as Sentry from "@sentry/capacitor";
import * as SentryReact from "@sentry/react";

export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return; // Disabled locally or if DSN not yet configured

  // Initialized via @sentry/capacitor directly (not @sentry/react) — this
  // is what actually wires up native-level Android crash reporting on
  // top of JS error capture. @sentry/react's role here is supplying its
  // own integrations/exports (ErrorBoundary, browser tracing) into this
  // same init call, not owning the init itself — unlike Angular's setup,
  // which needs a two-step "forward the init" handoff for its own
  // framework-level bootstrapping, React doesn't need that.
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE, // "production" | "development"

    // Capture 100% of errors; sample 10% of performance traces in production
    sampleRate: 1.0,
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 0,

    attachStacktrace: true,

    integrations: [
      SentryReact.browserTracingIntegration(),
      // Records a short replay video clip around each error
      SentryReact.replayIntegration({
        maskAllText: false,
        blockAllMedia: false,
      }),
    ],

    // Replay: capture 0% of normal sessions, 100% of sessions with an error
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
  });
}

/**
 * Call this after login to attach the user's identity to error reports.
 *   setUser({ id: profile.id, email })
 * Call setUser(null) on logout.
 */
export function setUser(user: { id: string; email?: string } | null) {
  Sentry.setUser(user);
}

/**
 * Manually capture an exception already handled in a try/catch but still
 * worth recording.
 *   captureError(err, { context: "uploadPhoto" });
 */
export function captureError(error: unknown, extras: Record<string, unknown> = {}) {
  Sentry.withScope((scope) => {
    Object.entries(extras).forEach(([k, v]) => scope.setExtra(k, v));
    Sentry.captureException(error);
  });
}

// Re-export the ErrorBoundary component (from @sentry/react — capacitor
// doesn't provide its own React-specific UI components) so main.tsx can
// wrap the app in it.
export const SentryErrorBoundary = SentryReact.ErrorBoundary;
