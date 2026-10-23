import { useEffect, useState } from "react";

const LABELS: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  store_search: "App Store / Play Store search",
  google: "Google",
  friend: "A friend / referral",
  event: "Campus or club event",
  other: "Other",
};

type Result = { total: number; no_answer: number; sources: { source: string; count: number }[] };

function isoDaysAgo(n: number) {
  const d = new Date(Date.now() + 2 * 3600 * 1000 - n * 86400000); // SA time
  return d.toISOString().slice(0, 10);
}

export function AcquisitionSourcesCard({ token }: { token: string | null }) {
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    fetch(`/api/admin/acquisition-sources?${qs.toString()}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((body) => !cancelled && setData(body))
      .catch(() => !cancelled && setFailed(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [from, to, token]);

  const answered = data ? data.total - data.no_answer : 0;
  const rows = data ? [...data.sources].sort((a, b) => b.count - a.count) : [];
  const preset = (days: number | null) => {
    setFrom(days === null ? "" : isoDaysAgo(days));
    setTo(days === null ? "" : isoDaysAgo(0));
  };

  return (
    <div className="bg-card border border-card-border rounded-2xl p-4">
      <p className="text-sm font-medium">How people found Deeply</p>
      <p className="text-xs text-muted-foreground mb-3">By signup date. Self-reported, so use it as a guide.</p>

      <div className="flex gap-2 mb-2">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="flex-1 min-w-0 bg-secondary rounded-lg px-2 h-9 text-xs" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="flex-1 min-w-0 bg-secondary rounded-lg px-2 h-9 text-xs" />
      </div>
      <div className="flex gap-2 mb-4">
        {[
          { label: "Today", d: 0 },
          { label: "7 days", d: 7 },
          { label: "30 days", d: 30 },
          { label: "All time", d: null },
        ].map((p) => (
          <button key={p.label} onClick={() => preset(p.d)} className="text-xs px-2.5 py-1 rounded-full bg-secondary text-muted-foreground">
            {p.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : failed || !data ? (
        <p className="text-xs text-destructive">Could not load. Has the SQL migration been run?</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const pct = answered > 0 ? Math.round((r.count / answered) * 100) : 0;
            return (
              <div key={r.source}>
                <div className="flex justify-between text-xs mb-1">
                  <span>{LABELS[r.source] ?? r.source}</span>
                  <span className="text-muted-foreground">{r.count} · {pct}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground pt-2">
            {answered} answered · {data.no_answer} skipped or joined before this question · {data.total} signups
          </p>
        </div>
      )}
    </div>
  );
}
