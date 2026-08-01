import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSparks } from "@/contexts/SparksContext";
import { useToast } from "@/hooks/use-toast";
import { SparkIcon } from "@/components/Icons";
import { X, ChevronDown, Loader2 } from "lucide-react";

interface Bundle {
  id: string;
  sparks: number;
  price_zar: number;
}

interface SparksSummary {
  balance: number;
  next_grant_at?: string | null;
  next_spark_grant_at?: string | null;
}

const COST_ITEMS: { label: string; cost: string }[] = [
  { label: "Send a message", cost: "10 Sparks" },
  { label: "Spark Invite (Super Invite)", cost: "10 Sparks" },
  { label: "Undo a swipe", cost: "5 Sparks" },
  { label: "Withdraw a sent invite", cost: "5 Sparks" },
  { label: "Extra invite past your daily 15 free", cost: "5 Sparks" },
  { label: "Unsend a message", cost: "10 Sparks" },
  { label: "Unlock read receipts (per match)", cost: "20 Sparks" },
  { label: "Message before matching", cost: "30 Sparks" },
  { label: "See who invited you", cost: "30 Sparks" },
  { label: "Extra photo (past 8 free)", cost: "10 Sparks" },
  { label: "Profile Boost", cost: "50 Sparks" },
  { label: "Incognito Mode", cost: "5 Sparks/day" },
];

export function SparksModal({ onClose }: { onClose: () => void }) {
  const { token } = useAuth();
  const { refresh: refreshSparksBadge } = useSparks();
  const { toast } = useToast();

  const [summary, setSummary] = useState<SparksSummary | null>(null);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const [showCostList, setShowCostList] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/sparks", { headers: { Authorization: `Bearer ${token}` } }).then((res) => (res.ok ? res.json() : null)),
      fetch("/api/sparks/bundles", { headers: { Authorization: `Bearer ${token}` } }).then((res) => (res.ok ? res.json() : [])),
    ])
      .then(([summaryBody, bundlesBody]) => {
        setSummary(summaryBody);
        setBundles(bundlesBody ?? []);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [token]);

  const nextGrantDate = summary?.next_grant_at ?? summary?.next_spark_grant_at;
  const nextGrantLabel = nextGrantDate
    ? new Date(nextGrantDate).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })
    : null;

  const handlePurchase = async (bundleId: string) => {
    setPurchasingId(bundleId);
    try {
      const res = await fetch("/api/sparks/purchase", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ bundle_id: bundleId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Purchase failed");
      setSummary((prev) => (prev ? { ...prev, balance: body.balance } : prev));
      refreshSparksBadge();
      toast({ title: "Sparks added", description: `Your new balance is ${body.balance}.` });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Purchase failed.",
        variant: "destructive",
      });
    } finally {
      setPurchasingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-end" onClick={onClose}>
      <div
        className="w-full max-w-[430px] mx-auto bg-card rounded-t-3xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-card/95 backdrop-blur-sm flex items-center justify-between px-5 pt-5 pb-3 border-b border-card-border z-10">
          <h2 className="font-['Syne'] font-bold text-lg">Sparks</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
            <X size={16} />
          </button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 size={22} className="animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="p-5 space-y-8">
            {/* Balance */}
            <div className="flex flex-col items-center text-center py-2">
              <div className="flex items-center gap-2">
                <SparkIcon size={32} className="text-primary drop-shadow-[0_0_12px_rgba(192,38,211,0.5)]" />
                <span className="text-5xl font-['Syne'] font-extrabold tracking-tighter">{summary?.balance ?? 0}</span>
              </div>
              {nextGrantLabel && (
                <p className="text-xs text-muted-foreground mt-2">
                  Your next free 300 Sparks arrive on <span className="text-foreground font-medium">{nextGrantLabel}</span>
                </p>
              )}
            </div>

            {/* Recharge */}
            <div>
              <h3 className="text-sm font-semibold mb-3">Recharge Sparks</h3>
              <div className="space-y-2">
                {bundles.map((bundle) => (
                  <div
                    key={bundle.id}
                    className="flex items-center justify-between bg-background border border-card-border rounded-2xl p-4"
                  >
                    <div className="flex items-center gap-2">
                      <SparkIcon size={16} className="text-primary" />
                      <span className="font-['Syne'] font-bold text-lg">{bundle.sparks}</span>
                    </div>
                    <button
                      onClick={() => handlePurchase(bundle.id)}
                      disabled={purchasingId === bundle.id}
                      className="h-10 px-5 rounded-xl bg-gradient-accent text-white font-semibold text-sm disabled:opacity-60"
                    >
                      {purchasingId === bundle.id ? "..." : `R${bundle.price_zar}`}
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground text-center mt-3">No auto-renewal — pay for what you use.</p>
            </div>

            {/* What uses Sparks — collapsible */}
            <div>
              <button
                onClick={() => setShowCostList((v) => !v)}
                className="w-full flex items-center justify-between"
              >
                <h3 className="text-sm font-semibold">What uses Sparks?</h3>
                <ChevronDown size={16} className={`text-muted-foreground transition-transform ${showCostList ? "rotate-180" : ""}`} />
              </button>
              {showCostList && (
                <div className="mt-3 space-y-2">
                  {COST_ITEMS.map((item) => (
                    <div key={item.label} className="flex items-center justify-between text-sm py-1.5 border-b border-border/50 last:border-b-0">
                      <span className="text-muted-foreground">{item.label}</span>
                      <span className="font-medium shrink-0 ml-3">{item.cost}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
