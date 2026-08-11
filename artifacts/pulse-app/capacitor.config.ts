import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'za.co.deeplydating.app',
  appName: 'Deeply',
  webDir: 'dist/public', // NOT plain 'dist' — this project's Vite build outputs to dist/public/index.html, confirmed from the actual build output

  // No `server` block — deliberately removed. It previously set
  // hostname: 'app.deeplydating.co.za' + androidScheme: 'https', under
  // the assumption this was needed for cookie-domain matching. It
  // wasn't: this app uses Bearer tokens in localStorage, not cookies,
  // for auth (see AuthContext.tsx) — so that setting was solving a
  // problem this app doesn't have.
  //
  // Worse, it was the actual cause of every API call failing natively.
  // Confirmed via live on-device debug logging: Capacitor intercepts
  // ANY request matching that configured hostname as a request for a
  // locally bundled file — even a fully-qualified, absolute fetch() URL
  // to that exact address, not just relative paths that happen to
  // resolve against it. The main.tsx fetch patch correctly rewrote
  // relative "/api/..." calls to the full remote URL, confirmed in the
  // debug logs — but since that URL still pointed at the same
  // configured hostname, Capacitor intercepted it anyway and returned
  // the app's own bundled index.html instead of a real network response.
  //
  // Without this hostname override, the WebView's origin defaults to
  // Capacitor's own internal scheme (not app.deeplydating.co.za), so a
  // fetch() to the real, external app.deeplydating.co.za domain is now
  // a genuine cross-origin network request — not something Capacitor's
  // local-asset loader has any reason to intercept.
  //
  // IMPORTANT: this makes API calls from the native app a real
  // cross-origin request. The backend's CORS configuration needs to
  // explicitly allow whatever origin Capacitor's WebView now reports
  // (commonly https://localhost on Android) — check api-server's CORS
  // allowed-origins list if login still fails after this change with a
  // CORS-related error rather than the previous HTML-instead-of-JSON one.

  android: {
    // Standard, safe default — keeps WebView debugging available for
    // `chrome://inspect` while testing on a connected device, harmless
    // in production builds.
    webContentsDebuggingEnabled: true,
  },
};

export default config;