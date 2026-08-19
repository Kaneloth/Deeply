import { useEffect, useState } from "react";
import { subscribeDebugLog, clearDebugLog, type DebugLogEntry } from "@/lib/debugLog";

// Temporary diagnostic tool — safe to delete once the native slowness is
// tracked down. Shows a small floating panel with live-updating request
// timings, readable directly off the device with no remote debugging
// connection needed. Tap the badge to expand/collapse; tap "Clear" to
// reset between test runs.
export function DebugOverlay() {
  const [entries, setEntries] = useState<DebugLogEntry[]>([]);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    return subscribeDebugLog(setEntries);
  }, []);

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        style={{
          position: "fixed", bottom: 90, right: 12, zIndex: 9999,
          background: "#111", color: "#0f0", fontSize: 11, padding: "6px 10px",
          borderRadius: 8, border: "1px solid #333", fontFamily: "monospace",
        }}
      >
        debug ({entries.length})
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed", bottom: 0, left: 0, right: 0, maxHeight: "40vh",
        background: "rgba(10,10,10,0.94)", color: "#0f0", fontFamily: "monospace",
        fontSize: 10.5, zIndex: 9999, overflowY: "auto", borderTop: "1px solid #333",
        padding: "6px 8px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, color: "#fff" }}>
        <span>DEBUG LOG ({entries.length})</span>
        <span>
          <button onClick={clearDebugLog} style={{ color: "#fff", marginRight: 12, background: "none", border: "none" }}>
            Clear
          </button>
          <button onClick={() => setExpanded(false)} style={{ color: "#fff", background: "none", border: "none" }}>
            Hide
          </button>
        </span>
      </div>
      {entries.length === 0 && <div style={{ color: "#888" }}>No entries yet.</div>}
      {entries.map((e) => (
        <div
          key={e.id}
          style={{
            color: e.level === "error" ? "#f66" : e.durationMs != null && e.durationMs > 2000 ? "#ff0" : "#0f0",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          [{e.time}] {e.message}
          {e.durationMs != null ? ` — ${e.durationMs}ms` : ""}
        </div>
      ))}
    </div>
  );
}
