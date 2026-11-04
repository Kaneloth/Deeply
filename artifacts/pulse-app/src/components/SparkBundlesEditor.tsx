import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type ExtraType = "rewind" | "boost" | "reshuffle" | "unlimited_reshuffle" | "incognito_pass";
interface Extra {
  type: ExtraType;
  amount?: number;
  hours?: number;
  days?: number;
}
interface Bundle {
  id: string;
  name: string;
  price_zar: number;
  sparks: number;
  google_product_id: string;
  extras: Extra[];
}

const TYPE_LABELS: Record<ExtraType, string> = {
  rewind: "Rewinds",
  boost: "Profile Boosts (5h each)",
  reshuffle: "Discover Reshuffles",
  unlimited_reshuffle: "Unlimited Reshuffles (timed)",
  incognito_pass: "Incognito passes",
};

function describe(e: Extra): string {
  switch (e.type) {
    case "rewind":
      return `${e.amount} Rewind${e.amount === 1 ? "" : "s"}`;
    case "boost":
      return `${e.amount} Profile Boost${e.amount === 1 ? "" : "s"}`;
    case "reshuffle":
      return `${e.amount} Discover Reshuffle${e.amount === 1 ? "" : "s"}`;
    case "unlimited_reshuffle":
      return `Unlimited Reshuffles for ${e.days} day${e.days === 1 ? "" : "s"}`;
    case "incognito_pass":
      return `${e.amount} Incognito pass${e.amount === 1 ? "" : "es"} × ${e.hours}h`;
  }
}

function BundleCard({ bundle, token, toast, onSaved }: { bundle: Bundle; token: string | null; toast: any; onSaved: (b: Bundle) => void }) {
  const [price, setPrice] = useState(String(bundle.price_zar));
  const [sparks, setSparks] = useState(String(bundle.sparks));
  const [extras, setExtras] = useState<Extra[]>(bundle.extras);
  const [saving, setSaving] = useState(false);

  const [newType, setNewType] = useState<ExtraType>("rewind");
  const [newAmount, setNewAmount] = useState("1");
  const [newHours, setNewHours] = useState("24");
  const [newDays, setNewDays] = useState("7");

  const dirty =
    price !== String(bundle.price_zar) ||
    sparks !== String(bundle.sparks) ||
    JSON.stringify(extras) !== JSON.stringify(bundle.extras);

  const addExtra = () => {
    const amount = Number(newAmount);
    const hours = Number(newHours);
    const days = Number(newDays);
    let extra: Extra;
    if (newType === "unlimited_reshuffle") {
      if (!Number.isInteger(days) || days < 1) return toast({ title: "Enter a number of days", variant: "destructive" });
      extra = { type: newType, days };
    } else {
      if (!Number.isInteger(amount) || amount < 1) return toast({ title: "Enter how many", variant: "destructive" });
      if (newType === "incognito_pass") {
        if (!Number.isInteger(hours) || hours < 1) return toast({ title: "Enter the pass length in hours", variant: "destructive" });
        extra = { type: newType, amount, hours };
      } else {
        extra = { type: newType, amount };
      }
    }
    setExtras((prev) => [...prev, extra]);
  };

  const save = async () => {
    const priceNum = Number(price);
    const sparksNum = Number(sparks);
    if (!Number.isFinite(priceNum) || priceNum < 5) return toast({ title: "Price must be at least R5", variant: "destructive" });
    if (!Number.isInteger(sparksNum) || sparksNum < 1) return toast({ title: "Sparks must be a whole number", variant: "destructive" });
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/spark-bundles/${bundle.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ price_zar: priceNum, sparks_amount: sparksNum, extras }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to save");
      }
      onSaved({ ...bundle, price_zar: priceNum, sparks: sparksNum, extras });
      toast({ title: `${bundle.name} updated` });
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const numInput = "h-9 text-sm bg-background border-card-border rounded-lg text-right";

  return (
    <div className="bg-card border border-card-border rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{bundle.name}</p>
        <p className="text-[10px] text-muted-foreground">Google Play ID: {bundle.google_product_id}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-muted-foreground space-y-1">
          Price (ZAR)
          <Input type="number" min={5} value={price} onChange={(e) => setPrice(e.target.value)} className={numInput} />
        </label>
        <label className="text-xs text-muted-foreground space-y-1">
          Sparks
          <Input type="number" min={1} value={sparks} onChange={(e) => setSparks(e.target.value)} className={numInput} />
        </label>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">Free extras included</p>
        {extras.length === 0 && <p className="text-xs text-muted-foreground italic">None</p>}
        {extras.map((e, i) => (
          <div key={i} className="flex items-center justify-between bg-background border border-card-border rounded-lg px-3 py-2">
            <span className="text-sm">{describe(e)}</span>
            <button onClick={() => setExtras((prev) => prev.filter((_, idx) => idx !== i))} aria-label="Remove extra" className="text-muted-foreground">
              <X size={15} />
            </button>
          </div>
        ))}

        <div className="flex flex-wrap items-end gap-2 pt-1">
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value as ExtraType)}
            className="h-9 bg-background border border-card-border rounded-lg px-2 text-xs flex-1 min-w-[150px]"
          >
            {(Object.keys(TYPE_LABELS) as ExtraType[]).map((t) => (
              <option key={t} value={t}>{TYPE_LABELS[t]}</option>
            ))}
          </select>
          {newType === "unlimited_reshuffle" ? (
            <label className="text-[10px] text-muted-foreground">
              Days
              <Input type="number" min={1} value={newDays} onChange={(e) => setNewDays(e.target.value)} className={`${numInput} w-16`} />
            </label>
          ) : (
            <label className="text-[10px] text-muted-foreground">
              How many
              <Input type="number" min={1} value={newAmount} onChange={(e) => setNewAmount(e.target.value)} className={`${numInput} w-16`} />
            </label>
          )}
          {newType === "incognito_pass" && (
            <label className="text-[10px] text-muted-foreground">
              Hours each
              <Input type="number" min={1} value={newHours} onChange={(e) => setNewHours(e.target.value)} className={`${numInput} w-16`} />
            </label>
          )}
          <Button size="sm" variant="secondary" onClick={addExtra} className="h-9 text-xs">Add</Button>
        </div>
      </div>

      <Button size="sm" disabled={!dirty || saving} onClick={save} className="h-9 text-xs w-full">
        {saving ? <Loader2 size={13} className="animate-spin" /> : dirty ? "Save changes" : "Saved"}
      </Button>
    </div>
  );
}

/** Admin: edit the price, Sparks amount and free extras of each package. */
export function SparkBundlesEditor({ token, toast }: { token: string | null; toast: any }) {
  const [bundles, setBundles] = useState<Bundle[] | null>(null);

  useEffect(() => {
    fetch("/api/admin/spark-bundles", { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error ?? "Failed to load packages");
        setBundles(body);
      })
      .catch((err) => {
        setBundles([]);
        toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to load packages", variant: "destructive" });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 pl-1">Sparks Packages</p>
      <p className="text-xs text-amber-600 dark:text-amber-500 mb-3 pl-1">
        <strong>Price:</strong> changing it here changes what PayFast charges on web. On the Android app the price people see
        and pay comes from Google Play, so update it in Play Console too. The two are never synced.
        <br />
        <strong>Sparks and extras:</strong> always come from here, on both web and Android. Changing the Sparks amount does not
        change what Google Play charges, so check the value for money on Android before changing it.
        <br />
        Changes go live within about 30 seconds. Extras already granted to people are not affected.
      </p>
      {bundles === null ? (
        <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-muted-foreground" /></div>
      ) : bundles.length === 0 ? (
        <p className="text-xs text-muted-foreground pl-1">No packages found.</p>
      ) : (
        <div className="space-y-3">
          {bundles.map((b) => (
            <BundleCard
              key={b.id}
              bundle={b}
              token={token}
              toast={toast}
              onSaved={(updated) => setBundles((prev) => (prev ?? []).map((x) => (x.id === updated.id ? updated : x)))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
