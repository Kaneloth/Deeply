export interface DebugLogEntry {
  id: number;
  time: string;
  message: string;
  durationMs?: number;
  level: "info" | "warn" | "error";
}

let entries: DebugLogEntry[] = [];
let nextId = 1;
const listeners = new Set<(entries: DebugLogEntry[]) => void>();

const MAX_ENTRIES = 60;

function notify() {
  for (const l of listeners) l(entries);
}

export function debugLog(message: string, opts?: { durationMs?: number; level?: DebugLogEntry["level"] }) {
  const entry: DebugLogEntry = {
    id: nextId++,
    time: new Date().toLocaleTimeString(undefined, { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }) +
      "." + String(new Date().getMilliseconds()).padStart(3, "0"),
    message,
    durationMs: opts?.durationMs,
    level: opts?.level ?? "info",
  };
  entries = [...entries, entry].slice(-MAX_ENTRIES);
  notify();
  // Also real console.log for anyone who DOES have devtools access —
  // this overlay is a supplement, not a replacement.
  // eslint-disable-next-line no-console
  console.log(`[debug] ${entry.time} ${message}${opts?.durationMs != null ? ` (${opts.durationMs}ms)` : ""}`);
}

export function subscribeDebugLog(listener: (entries: DebugLogEntry[]) => void): () => void {
  listeners.add(listener);
  listener(entries);
  return () => listeners.delete(listener);
}

export function clearDebugLog() {
  entries = [];
  notify();
}

// Patches console.error/warn so React's OWN internal warnings (duplicate
// keys, unstable component identity causing unexpected remounts, etc.)
// show up in this same on-screen panel — previously only manual
// debugLog() calls were visible here, meaning React's own diagnostic
// output about exactly this class of bug was invisible without real
// devtools access. Call once, early (e.g. at the top of App.tsx).
let consolePatched = false;
export function patchConsoleIntoDebugLog() {
  if (consolePatched) return;
  consolePatched = true;

  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);

  console.error = (...args: unknown[]) => {
    originalError(...args);
    debugLog(`[console.error] ${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}`, {
      level: "error",
    });
  };
  console.warn = (...args: unknown[]) => {
    originalWarn(...args);
    debugLog(`[console.warn] ${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}`, {
      level: "warn",
    });
  };
}

// Convenience helper: times an async operation and logs it automatically,
// whether it succeeds or throws.
export async function timeIt<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    debugLog(label, { durationMs: Math.round(performance.now() - start) });
    return result;
  } catch (err) {
    debugLog(`${label} — FAILED: ${err instanceof Error ? err.message : String(err)}`, {
      durationMs: Math.round(performance.now() - start),
      level: "error",
    });
    throw err;
  }
}
