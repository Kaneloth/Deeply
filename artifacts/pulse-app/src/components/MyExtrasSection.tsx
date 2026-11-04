import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";

interface Inventory {
  rewind: number;
  boost: number;
  reshuffle: number;
  unlimited_reshuffle_until: string | null;
  incognito_passes: { hours: number; quantity: number }[];
  incognito_until: string | null;
  incognito_available: boolean;
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const fmtHours = (h: number) => (h % 24 === 0 ? `${h / 24} day${h / 24 === 1 ? "" : "s"}` : `${h}h`);

/** "My Extras" — bonus items from Sparks packages. Rewinds and Reshuffles are
 *  used automatically when the person uses those features; Boosts and
 *  Incognito passes are activated here. Renders nothing if they own nothing. */
export function MyExtrasSection({ token, refreshKey }: { token: string | null; refreshKey?: unknown }) {
  const { toast } = useToast();
  const [inv, setInv] = useState<Inventory | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/sparks/extras", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => !cancelled && setInv(body))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token, refreshKey, reloadTick]);

  const activate = async (key: string, url: string, body?: object, successTitle?: string) => {
    setBusy(key);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      toast({ title: successTitle ?? "Done" });
      setReloadTick((n) => n + 1);
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Something went wrong", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  if (!inv) return null;
  const hasPasses = inv.incognito_passes.length > 0;
  const nothing =
    inv.rewind === 0 && inv.boost === 0 && inv.reshuffle === 0 && !inv.unlimited_reshuffle_until && !hasPasses && !inv.incognito_until;
  if (nothing) return null;

  const rowCls = "flex items-center justify-between gap-3 py-2 border-b border-border/50 last:border-b-0";
  const btnCls = "h-8 px-4 rounded-lg bg-gradient-accent text-white text-xs font-semibold disabled:opacity-60 shrink-0";

  return (
    <div>
      <h3 className="text-sm font-semibold mb-2">My Extras</h3>
      <div className="bg-background border border-card-border rounded-2xl px-4 py-1">
        {inv.rewind > 0 && (
          <div className={rowCls}>
            <div>
              <p className="text-sm font-medium">{inv.rewind} Rewind{inv.rewind === 1 ? "" : "s"}</p>
              <p className="text-xs text-muted-foreground">Used automatically when you undo a swipe</p>
            </div>
          </div>
        )}
        {inv.unlimited_reshuffle_until && (
          <div className={rowCls}>
            <div>
              <p className="text-sm font-medium">Unlimited Reshuffles</p>
              <p className="text-xs text-muted-foreground">Active until {fmtDate(inv.unlimited_reshuffle_until)}</p>
            </div>
          </div>
        )}
        {inv.reshuffle > 0 && (
          <div className={rowCls}>
            <div>
              <p className="text-sm font-medium">{inv.reshuffle} Discover Reshuffle{inv.reshuffle === 1 ? "" : "s"}</p>
              <p className="text-xs text-muted-foreground">Used automatically after your free weekly reshuffle</p>
            </div>
          </div>
        )}
        {inv.boost > 0 && (
          <div className={rowCls}>
            <div>
              <p className="text-sm font-medium">{inv.boost} Profile Boost{inv.boost === 1 ? "" : "s"}</p>
              <p className="text-xs text-muted-foreground">Get seen first for 5 hours</p>
            </div>
            <button className={btnCls} disabled={busy !== null} onClick={() => activate("boost", "/api/profile/boost", undefined, "Boost activated")}>
              {busy === "boost" ? "..." : "Use"}
            </button>
          </div>
        )}
        {inv.incognito_until && (
          <div className={rowCls}>
            <div>
              <p className="text-sm font-medium">Incognito is on</p>
              <p className="text-xs text-muted-foreground">Until {fmtDate(inv.incognito_until)}</p>
            </div>
          </div>
        )}
        {inv.incognito_available &&
          inv.incognito_passes.map((p) => (
            <div key={p.hours} className={rowCls}>
              <div>
                <p className="text-sm font-medium">
                  {p.quantity} Incognito pass{p.quantity === 1 ? "" : "es"} · {fmtHours(p.hours)}
                </p>
                <p className="text-xs text-muted-foreground">Browse privately. Switches off by itself.</p>
              </div>
              <button
                className={btnCls}
                disabled={busy !== null}
                onClick={() => activate(`inc-${p.hours}`, "/api/sparks/extras/incognito/activate", { hours: p.hours }, "Incognito activated")}
              >
                {busy === `inc-${p.hours}` ? "..." : "Activate"}
              </button>
            </div>
          ))}
      </div>
    </div>
  );
}
