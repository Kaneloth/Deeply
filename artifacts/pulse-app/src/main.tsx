import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { setBaseUrl } from '@workspace/api-client-react';

import App from './App';

import './index.css';

// ============================================================
// TEMPORARY DEBUG PANEL — remove once the login issue is
// diagnosed. Shows a visible, on-screen log of exactly what's
// happening, since device remote-debugging isn't available.
// ============================================================
const debugPanel = document.createElement('div');
debugPanel.id = '__debug_panel__';
debugPanel.style.cssText =
  'position:fixed;top:0;left:0;right:0;max-height:45vh;overflow-y:auto;' +
  'background:rgba(0,0,0,0.92);color:#0f0;font-size:10px;font-family:monospace;' +
  'padding:8px;z-index:999999;white-space:pre-wrap;word-break:break-all;' +
  'border-bottom:2px solid #0f0;';
document.body.appendChild(debugPanel);

function debugLog(msg: string) {
  const line = document.createElement('div');
  line.textContent = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
  debugPanel.appendChild(line);
  debugPanel.scrollTop = debugPanel.scrollHeight;
}

debugLog(`Capacitor.isNativePlatform() = ${Capacitor.isNativePlatform()}`);
debugLog(`Capacitor.getPlatform() = ${Capacitor.getPlatform()}`);

if (Capacitor.isNativePlatform()) {
  const API_ORIGIN = 'https://app.deeplydating.co.za';
  debugLog(`Native platform detected — patching fetch, API_ORIGIN = ${API_ORIGIN}`);

  setBaseUrl(API_ORIGIN);
  debugLog('setBaseUrl called');

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    debugLog(`fetch() called with: ${rawUrl}`);

    let finalInput = input;
    if (typeof input === 'string' && input.startsWith('/api/')) {
      finalInput = `${API_ORIGIN}${input}`;
      debugLog(`Rewritten to: ${finalInput}`);
    } else if (input instanceof Request && input.url.startsWith('/api/')) {
      finalInput = new Request(`${API_ORIGIN}${input.url}`, input);
      debugLog(`Rewritten (Request object) to: ${API_ORIGIN}${input.url}`);
    } else {
      debugLog(`NOT rewritten — didn't match string+/api/ or Request+/api/ pattern`);
    }

    try {
      const response = await originalFetch(finalInput, init);
      const cloned = response.clone();
      const bodyPreview = await cloned.text();
      debugLog(`Response status: ${response.status}, first 150 chars: ${bodyPreview.slice(0, 150)}`);
      return response;
    } catch (err) {
      debugLog(`fetch threw an error: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  };
} else {
  debugLog('NOT native platform — no patching applied (this would be wrong if running in the Android app!)');
}

createRoot(document.getElementById('root')!).render(<App />);
