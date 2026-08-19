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
