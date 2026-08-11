import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'za.co.deeplydating.app',
  appName: 'Deeply',
  webDir: 'dist', // Vite's default production build output

  server: {
    // CRITICAL: every fetch() call throughout this codebase uses relative
    // paths — fetch("/api/discover/queue", ...), fetch("/api/notifications", ...),
    // etc. — never a full https://app.deeplydating.co.za/... URL. That's
    // fine on the web, where relative paths resolve against whatever
    // domain the page is loaded from. But a native app's WebView loads
    // bundled local files (file://), not a real domain — so those same
    // relative calls would try to hit "file:///api/..." and fail
    // completely, breaking every single API call in the app.
    //
    // Setting hostname here makes the WebView's origin *behave* as if
    // it's running on app.deeplydating.co.za, without actually fetching
    // the page contents from the network — the bundled local files
    // (from webDir above) still load instantly, same as any native app.
    // Only the *origin* the browser reports (and therefore what relative
    // fetch() calls resolve against) changes. This means zero code
    // changes needed across the entire frontend — every existing
    // fetch("/api/...") call keeps working exactly as-is.
    hostname: 'app.deeplydating.co.za',
    androidScheme: 'https',
  },

  android: {
    // Standard, safe default — keeps WebView debugging available for
    // `chrome://inspect` while testing on a connected device, harmless
    // in production builds.
    webContentsDebuggingEnabled: true,
  },
};

export default config;