import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { setBaseUrl } from '@workspace/api-client-react';

import App from './App';

import './index.css';

// Native-only fix for a well-documented Capacitor limitation: setting
// server.hostname + androidScheme: 'https' in capacitor.config.ts (done
// so the app's origin matches the real domain, e.g. for cookies) has a
// side effect nobody wants — Capacitor treats EVERY request matching
// that hostname as a request for a locally bundled file, API calls
// included. A relative fetch("/api/...") call, which resolves against
// that same hostname, never actually reaches the real server — it gets
// intercepted and served the app's own bundled index.html instead,
// which is exactly why you'd see a "Unexpected token '<', <!DOCTYPE..."
// JSON-parse error: the app tried to parse HTML as JSON.
//
// This is a known, longstanding Capacitor issue (see ionic-team/
// capacitor #6198, #5468, #6875 on GitHub) with no clean built-in fix.
//
// Two separate call paths exist in this app, so two separate fixes:
//
// 1. @workspace/api-client-react (the generated API client) has its own
//    OFFICIAL mechanism for exactly this — setBaseUrl(), explicitly
//    documented as "useful for Expo bundles that need to call a remote
//    API server". This is the correct, intended fix for anything routed
//    through that client — no guessing at path prefixes needed, it
//    prepends the base URL to any relative request.
//
// 2. Everywhere else in the app, plain fetch("/api/...") calls are used
//    directly, not through the generated client. For those, the global
//    fetch patch below rewrites the URL before the request goes out.
//
// Both are native-only; web behavior is completely untouched either way.
if (Capacitor.isNativePlatform()) {
  // Keep in sync with server.hostname in capacitor.config.ts.
  const API_ORIGIN = 'https://app.deeplydating.co.za';

  setBaseUrl(API_ORIGIN);

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/api/')) {
      return originalFetch(`${API_ORIGIN}${input}`, init);
    }
    if (input instanceof Request && input.url.startsWith('/api/')) {
      return originalFetch(new Request(`${API_ORIGIN}${input.url}`, input), init);
    }
    return originalFetch(input, init);
  };
}

createRoot(document.getElementById('root')!).render(<App />);
