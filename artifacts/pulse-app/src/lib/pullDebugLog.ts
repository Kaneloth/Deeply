// Temporary, on-screen debug logging for the pull-to-refresh
// investigation — safe to delete entirely once resolved (this file,
// the overlay in AppShell.tsx, and the log calls in this file and
// PullToRefreshContext.tsx). A simple module-level store + subscriber
// pattern rather than React state directly, since the things logging
// (a plain hook effect, a raw DOM touch handler) aren't always in a
// convenient place to hold React state themselves — anything can push
// a line by just calling pullDebugLog(), and the one overlay component
// subscribes to re-render when new lines arrive.
//
// MAX_LINES raised from 80 to 300 — the first real capture showed
// register/unregister churn (see PullToRefreshContext.tsx) noisy
// enough to plausibly push a single gesture's touchend line out of an
// 80-line buffer before it could be read, which would make a real
// event look like it never happened at all. 300 gives much more room
// before that's a risk, even with the churn also being fixed directly.
type Listener = () => void;

let lines: string[] = [];
const listeners = new Set<Listener>();
const MAX_LINES = 300;

export function pullDebugLog(message: string): void {
  const time = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  lines = [...lines, `${time}  ${message}`].slice(-MAX_LINES);
  listeners.forEach((l) => l());
}

export function getPullDebugLines(): string[] {
  return lines;
}

export function subscribePullDebugLog(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearPullDebugLog(): void {
  lines = [];
  listeners.forEach((l) => l());
}
