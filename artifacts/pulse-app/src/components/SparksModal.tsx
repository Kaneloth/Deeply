import { useState, useEffect, useRef, useMemo } from "react";
import { Capacitor } from "@capacitor/core";
import { NativePurchases, PURCHASE_TYPE } from "@capgo/native-purchases";
import { useAuth } from "@/contexts/AuthContext";
import { useSparks } from "@/contexts/SparksContext";
import { useToast } from "@/hooks/use-toast";
import { SparkIcon } from "@/components/Icons";
import { X, ChevronDown, Loader2 } from "lucide-react";

interface Bundle {
  id: string;
  sparks: number;
  price_zar: number;
  google_product_id: string;
}

interface SparksSummary {
  balance: number;
  next_grant_at?: string | null;
  next_spark_grant_at?: string | null;
  monthly_grant_amount?: number;
}

interface NativeProduct {
  id: string;
  displayPrice: string;
}

// Maps each row shown in "What uses Sparks?" to the actual admin-
// configurable key it should reflect (see ECONOMY_CONFIG_LABELS in
// profile.ts — these are the exact same keys the admin dashboard's
// Economy Config panel edits, stored in app_settings and returned
// unfiltered by GET /api/app-settings). Previously this whole list was
// a static array of guessed-at numbers that never moved when an admin
// changed a price — same bug class as the monthly grant amount, just
// with twelve numbers instead of one.
//
// "labelTemplate" can reference {daily_free_invites} — the only value
// among these that appears in the LABEL text itself, not just the
// cost. There's no equivalent admin key for the "8" free-photo limit
// mentioned in that row's label (checked ECONOMY_CONFIG_LABELS — no
// such key exists), so that number is left as-is; it appears to be a
// genuinely fixed platform limit rather than an admin-configurable one.
const COST_ITEM_DEFS: { labelTemplate: string; configKey: string; unitSuffix?: string }[] = [
  { labelTemplate: "Send a message", configKey: "cost_send_message" },
  { labelTemplate: "Spark Invite (Super Invite)", configKey: "cost_super_like" },
  { labelTemplate: "Undo a swipe", configKey: "cost_undo_swipe" },
  { labelTemplate: "Withdraw a sent invite", configKey: "cost_undo_swipe" },
  { labelTemplate: "Extra invite past your daily {daily_free_invites} free", configKey: "cost_extra_invite" },
  { labelTemplate: "Unsend a message", configKey: "cost_unsend_message" },
  { labelTemplate: "Unlock read receipts (per match)", configKey: "cost_unlock_read_receipts" },
  { labelTemplate: "Message before matching", configKey: "cost_message_before_match" },
  { labelTemplate: "See who invited you", configKey: "cost_reveal_invites" },
  { labelTemplate: "Extra photo (past 8 free)", configKey: "cost_extra_photo" },
  { labelTemplate: "Profile Boost", configKey: "cost_boost" },
  { labelTemplate: "Incognito Mode", configKey: "cost_incognito_per_day", unitSuffix: "/day" },
];

export function SparksModal({ onClose }: { onClose: () => void }) {
  const { token } = useAuth();
  const { refresh: refreshSparksBadge } = useSparks();
  const { toast } = useToast();

  // Computed once — this never changes over the app's lifetime, so no
  // need to re-check on every render. This is the ONLY thing that
  // decides which payment path is shown; PayFast must never render
  // inside the native app shell, and Google Play Billing is
  // meaningless outside it.
  const isNative = useMemo(() => Capacitor.isNativePlatform(), []);

  const [summary, setSummary] = useState<SparksSummary | null>(null);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [appSettings, setAppSettings] = useState<Record<string, unknown>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const [showCostList, setShowCostList] = useState(false);

  // Native-only: real Google Play product info (price, display name).
  // Google Play policy requires showing the store's own price, never a
  // hardcoded estimate — price_zar above is only ever a PayFast/display
  // fallback for the web path.
  const [nativeProducts, setNativeProducts] = useState<Record<string, NativeProduct>>({});
  const bundlesRef = useRef<Bundle[]>([]);
  bundlesRef.current = bundles;

  useEffect(() => {
    Promise.all([
      fetch("/api/sparks", { headers: { Authorization: `Bearer ${token}` } }).then((res) => (res.ok ? res.json() : null)),
      fetch("/api/sparks/bundles", { headers: { Authorization: `Bearer ${token}` } }).then((res) => (res.ok ? res.json() : [])),
      // Same endpoint already used elsewhere in the app (e.g. the
      // Incognito/Dealbreakers flags) to read admin-configured
      // app_settings values — economy config (all the cost_* keys)
      // lives in that same table, so this is already everything "What
      // uses Sparks?" needs, no new backend route required.
      fetch("/api/app-settings", { headers: { Authorization: `Bearer ${token}` } }).then((res) => (res.ok ? res.json() : {})),
    ])
      .then(([summaryBody, bundlesBody, settingsBody]) => {
        setSummary(summaryBody);
        setBundles(bundlesBody ?? []);
        setAppSettings(settingsBody ?? {});
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [token]);

  // Native only: fetch real product details from Google Play once
  // bundles (and their google_product_id list) are known.
  useEffect(() => {
    if (!isNative || bundles.length === 0) return;
    NativePurchases.getProducts({
      productIdentifiers: bundles.map((b) => b.google_product_id),
      productType: PURCHASE_TYPE.INAPP,
    })
      .then(({ products }) => {
        const byId: Record<string, NativeProduct> = {};
        for (const p of products) byId[p.identifier] = { id: p.identifier, displayPrice: p.priceString };
        setNativeProducts(byId);
      })
      .catch(() => {
        // Silent — buttons fall back to a loading state and stay
        // disabled until product info is available; better than
        // showing a wrong or stale price.
      });
  }, [isNative, bundles]);

  // Native only, runs once: catch up on any purchase that succeeded
  // with Google Play but never made it to our backend (e.g. the app was
  // closed right after paying, before the verification request
  // completed). Once our backend consumes a token it disappears from
  // getPurchases() entirely, so anything still showing up here as
  // PURCHASED genuinely wasn't finalized yet.
  useEffect(() => {
    if (!isNative || !token) return;
    (async () => {
      try {
        const { purchases } = await NativePurchases.getPurchases({ productType: PURCHASE_TYPE.INAPP });
        const ourProductIds = new Set(bundlesRef.current.map((b) => b.google_product_id));
        const stuck = purchases.filter(
          (p) => (p.purchaseState === "PURCHASED" || p.purchaseState === "1") && ourProductIds.has(p.productIdentifier),
        );

        let recovered = false;
        for (const p of stuck) {
          const bundle = bundlesRef.current.find((b) => b.google_product_id === p.productIdentifier);
          if (!bundle || !p.purchaseToken) continue;
          const res = await fetch("/api/sparks/purchase/google", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ bundle_id: bundle.id, purchase_token: p.purchaseToken }),
          }).catch(() => null);
          if (res?.ok) recovered = true;
        }
        if (recovered) refreshSparksBadge();
      } catch {
        // Best-effort catch-up only — never blocks the modal from
        // opening normally.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNative, token]);

  const nextGrantDate = summary?.next_grant_at ?? summary?.next_spark_grant_at;
  const nextGrantLabel = nextGrantDate
    ? new Date(nextGrantDate).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })
    : null;

  // Same fail-safe approach as the monthly-grant fix above: a row is
  // only shown once we actually have a live number for it. Silently
  // falling back to a guessed value here would just reintroduce this
  // exact bug in a slightly different shape.
  const costItems = COST_ITEM_DEFS.reduce<{ label: string; cost: string }[]>((items, def) => {
    const value = appSettings[def.configKey];
    if (typeof value !== "number") return items;
    const dailyFreeInvites = appSettings.daily_free_invites;
    const label =
      typeof dailyFreeInvites === "number"
        ? def.labelTemplate.replace("{daily_free_invites}", String(dailyFreeInvites))
        : def.labelTemplate.replace("your daily {daily_free_invites} free", "your daily free quota");
    items.push({ label, cost: `${value} Sparks${def.unitSuffix ?? ""}` });
    return items;
  }, []);

  const handleGooglePurchase = async (bundle: Bundle) => {
    setPurchasingId(bundle.id);
    try {
      const { isBillingSupported } = await NativePurchases.isBillingSupported();
      if (!isBillingSupported) throw new Error("Purchases aren't supported on this device.");

      const transaction = await NativePurchases.purchaseProduct({
        productIdentifier: bundle.google_product_id,
        productType: PURCHASE_TYPE.INAPP,
        quantity: 1,
        isConsumable: true,
        // Acknowledgment happens server-side, only after our own
        // verification succeeds (see google-play-helper.ts) — not
        // automatically here on-device. This is the plugin's own
        // documented "recommended for security" pattern: it prevents a
        // purchase being irreversibly finalized with Google before we've
        // actually confirmed it and granted Sparks.
        autoAcknowledgePurchases: false,
      });

      const res = await fetch("/api/sparks/purchase/google", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ bundle_id: bundle.id, purchase_token: transaction.purchaseToken }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Purchase failed");

      setSummary((prev) => (prev ? { ...prev, balance: body.balance } : prev));
      refreshSparksBadge();
      toast({ title: "Sparks added", description: `Your new balance is ${body.balance}.` });
    } catch (err) {
      // Don't show a scary error toast just because someone backed out
      // of Google's own purchase sheet — that's not a failure.
      const message = err instanceof Error ? err.message : "Purchase failed.";
      if (!message.toLowerCase().includes("cancel")) {
        toast({ title: "Error", description: message, variant: "destructive" });
      }
    } finally {
      setPurchasingId(null);
    }
  };

  const handlePayfastCheckout = async (bundle: Bundle) => {
    setPurchasingId(bundle.id);
    try {
      const res = await fetch("/api/sparks/checkout/payfast", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ bundle_id: bundle.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to start checkout");

      // A real HTML form POST, not a fetch — this needs to actually
      // navigate the browser away to PayFast's hosted payment page.
      const form = document.createElement("form");
      form.method = "POST";
      form.action = body.action_url;
      for (const [key, value] of Object.entries(body.fields as Record<string, string>)) {
        if (value === undefined || value === null) continue;
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = key;
        input.value = String(value);
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
      // No finally/reset here on the success path — the page is about
      // to navigate away entirely.
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to start checkout.",
        variant: "destructive",
      });
      setPurchasingId(null);
    }
  };

  const handlePurchase = (bundle: Bundle) => (isNative ? handleGooglePurchase(bundle) : handlePayfastCheckout(bundle));

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
              {nextGrantLabel && summary?.monthly_grant_amount != null && (
                <p className="text-xs text-muted-foreground mt-2">
                  Your next free {summary.monthly_grant_amount} Sparks arrive on <span className="text-foreground font-medium">{nextGrantLabel}</span>
                </p>
              )}
            </div>

            {/* Recharge */}
            <div>
              <h3 className="text-sm font-semibold mb-3">Recharge Sparks</h3>
              <div className="space-y-2">
                {bundles.map((bundle) => {
                  const nativeProduct = isNative ? nativeProducts[bundle.google_product_id] : null;
                  const priceLabel = isNative ? (nativeProduct?.displayPrice ?? "...") : `R${bundle.price_zar}`;
                  const isDisabled = purchasingId === bundle.id || (isNative && !nativeProduct);
                  return (
                    <div
                      key={bundle.id}
                      className="flex items-center justify-between bg-background border border-card-border rounded-2xl p-4"
                    >
                      <div className="flex items-center gap-2">
                        <SparkIcon size={16} className="text-primary" />
                        <span className="font-['Syne'] font-bold text-lg">{bundle.sparks}</span>
                      </div>
                      <button
                        onClick={() => handlePurchase(bundle)}
                        disabled={isDisabled}
                        className="h-10 px-5 rounded-xl bg-gradient-accent text-white font-semibold text-sm disabled:opacity-60"
                      >
                        {purchasingId === bundle.id ? "..." : priceLabel}
                      </button>
                    </div>
                  );
                })}
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
                  {costItems.map((item) => (
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
