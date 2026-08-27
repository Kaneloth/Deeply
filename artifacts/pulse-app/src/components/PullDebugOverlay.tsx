import { useEffect, useState } from "react";
import { getPullDebugEntries, subscribePullDebug, clearPullDebugEntries } from "@/lib/pullDebugLog";

// TEMPORARY — see pullDebugLog.ts's file-level comment. Renders a
// small, collapsible, always-on-top panel showing the last ~60 pull-
// to-refresh gesture events in real time, since there's no accessible
// console on the native app to check this any other way. Collapsed by
// default (just a small tappable tab) so it doesn't block testing the
// actual gesture underneath it.
export function PullDebugOverlay() {
  const [entries, setEntries] = useState(getPullDebugEntries());
  const [expanded, setExpanded] = useState(false);

  useEffect(() => subscribePullDebug(() => setEntries(getPullDebugEntries())), []);

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="fixed bottom-24 right-3 z-[9999] w-9 h-9 rounded-full bg-black/80 text-white text-[10px] font-bold flex items-center justify-center shadow-lg"
      >
        {entries.length}
      </button>
    );
  }

  return (
    <div className="fixed inset-x-2 bottom-24 z-[9999] max-h-[45vh] rounded-xl bg-black/90 text-white text-[10px] font-mono flex flex-col shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1.5 bg-black/40 shrink-0">
        <span className="font-bold">Pull Debug ({entries.length})</span>
        <div className="flex gap-2">
          <button onClick={clearPullDebugEntries} className="px-2 py-0.5 rounded bg-white/20">
            Clear
          </button>
          <button onClick={() => setExpanded(false)} className="px-2 py-0.5 rounded bg-white/20">
            Hide
          </button>
        </div>
      </div>
      <div className="overflow-y-auto flex-1 px-2 py-1 space-y-0.5">
        {entries.length === 0 ? (
          <p className="opacity-50 italic">No events yet — try a pull.</p>
        ) : (
          entries.map((e, i) => (
            <p key={i} className="leading-tight break-words">
              <span className="opacity-50">{e.time}</span> {e.message}
            </p>
          ))
        )}
      </div>
    </div>
  );
}
