// Temporary, on-screen debug logging for the pull-to-refresh
// investigation — safe to delete entirely once resolved (this file,
// the overlay in AppShell.tsx, and the log calls in this file and
// PullToRefreshContext.tsx). A simple module-level store + subscriber
// pattern rather than React state directly, since the things logging
// (a plain hook effect, a raw DOM touch handler) aren't always in a
// convenient place to hold React state themselves — anything can push
// a line by just calling pullDebugLog(), and the one overlay component
// subscribes to re-render when new lines arrive.
type Listener = () => void;

let lines: string[] = [];
const listeners = new Set<Listener>();
const MAX_LINES = 80;

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
