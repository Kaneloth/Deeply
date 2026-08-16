import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { setBaseUrl } from '@workspace/api-client-react';
import { initSentry, SentryErrorBoundary } from '@/lib/sentry';

import App from './App';

import './index.css';

initSentry();

// Native-only fix so relative API calls actually reach the real backend
// instead of the WebView trying (and failing) to resolve them locally.
// Confirmed working via on-device debug logging during development —
// see capacitor.config.ts for the full story of why this is needed
// (in short: no server.hostname override is set there anymore, so the
// WebView's origin is Capacitor's own internal scheme, not
// app.deeplydating.co.za — meaning a relative fetch("/api/...") call
// has nothing to resolve against unless it's rewritten to the full,
// absolute remote URL first, which is what this does).
//
// Two separate call paths exist in this app, so two separate fixes:
//
// 1. @workspace/api-client-react (the generated API client) has its own
//    built-in mechanism for this — setBaseUrl() — explicitly documented
//    as "useful for Expo bundles that need to call a remote API server."
//
// 2. Everywhere else, plain fetch("/api/...") calls are used directly.
//    For those, the patched fetch below rewrites the URL before the
//    request goes out.
//
// Both are native-only; web behavior is completely untouched either way.
if (Capacitor.isNativePlatform()) {
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

createRoot(document.getElementById('root')!).render(
  <SentryErrorBoundary fallback={<p>Something went wrong. Please refresh.</p>}>
    <App />
  </SentryErrorBoundary>,
);
