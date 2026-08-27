// TEMPORARY DEBUG UTILITY for investigating the "pull-to-refresh
// glitches on the first attempt" report on Search/Invites. Safe to
// delete entirely (this file, PullDebugOverlay.tsx, and the logging
// calls added to AppShell.tsx and PullToRefreshContext.tsx) once the
// investigation concludes — same disposable pattern as the original
// pullDebugLog.ts used earlier this session for the "needs two pulls"
// bug, which was deleted after that root cause was confirmed.
//
// In-memory only, no persistence — logs reset on every reload, which is
// fine since the goal is watching one gesture attempt at a time live,
// not reviewing history across sessions.

interface PullDebugEntry {
  time: string;
  message: string;
}

const MAX_ENTRIES = 60;
let entries: PullDebugEntry[] = [];
const listeners = new Set<() => void>();

export function logPullDebug(message: string) {
  const time = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  entries = [...entries, { time, message }].slice(-MAX_ENTRIES);
  listeners.forEach((l) => l());
}

export function getPullDebugEntries(): PullDebugEntry[] {
  return entries;
}

export function subscribePullDebug(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearPullDebugEntries() {
  entries = [];
  listeners.forEach((l) => l());
}
