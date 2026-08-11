import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';

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
// The workaround: patch the global fetch, natively only, to rewrite any
// "/api/..." call to the real, absolute remote URL before the request
// goes out — bypassing Capacitor's local-asset interception entirely.
// Every existing fetch("/api/...") call throughout the whole app keeps
// working completely unchanged; only native builds get this rewrite,
// so web behavior is untouched.
if (Capacitor.isNativePlatform()) {
  // Keep in sync with server.hostname in capacitor.config.ts.
  const API_ORIGIN = 'https://app.deeplydating.co.za';
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
