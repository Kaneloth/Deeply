import { supabase } from "./supabase";
import { getSparksSummary } from "./sparks-helper";

// ---------------------------------------------------------------------------
// Extras: bonus items a Sparks package can include. Which extras each package
// carries (and how many) is edited by the admin and stored as JSON on the
// spark_bundles row.
// ---------------------------------------------------------------------------

export type ExtraType = "rewind" | "boost" | "reshuffle" | "unlimited_reshuffle" | "incognito_pass";

export interface BundleExtra {
  type: ExtraType;
  amount?: number; // rewind / boost / reshuffle / incognito_pass: how many
  hours?: number; // incognito_pass: length of each pass
  days?: number; // unlimited_reshuffle: how many days
}

export const EXTRA_TYPES: ExtraType[] = ["rewind", "boost", "reshuffle", "unlimited_reshuffle", "incognito_pass"];

const intInRange = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;

/** Validates admin input strictly (throws with a readable message). */
export function validateExtras(raw: unknown): BundleExtra[] {
  if (!Array.isArray(raw)) throw new Error("extras must be a list");
  if (raw.length > 10) throw new Error("A package can have at most 10 extras");
  return raw.map((item, i): BundleExtra => {
    const e = item as Record<string, unknown>;
    const type = e?.type as ExtraType;
    const where = `Extra #${i + 1}`;
    if (!EXTRA_TYPES.includes(type)) throw new Error(`${where}: unknown type`);
    if (type === "unlimited_reshuffle") {
      const days = intInRange(e.days, 1, 365);
      if (days === null) throw new Error(`${where}: days must be a whole number from 1 to 365`);
      return { type, days };
    }
    const amount = intInRange(e.amount, 1, 1000);
    if (amount === null) throw new Error(`${where}: amount must be a whole number from 1 to 1000`);
    if (type === "incognito_pass") {
      const hours = intInRange(e.hours, 1, 720);
      if (hours === null) throw new Error(`${where}: hours must be a whole number from 1 to 720`);
      return { type, amount, hours };
    }
    return { type, amount };
  });
}

/** Lenient version for fulfilment: silently drops anything malformed, so a bad
 *  stored value can never block a purchase from completing. */
export function parseExtrasLenient(raw: unknown): BundleExtra[] {
  if (!Array.isArray(raw)) return [];
  const out: BundleExtra[] = [];
  for (const item of raw) {
    try {
      out.push(...validateExtras([item]));
    } catch {
      // skip
    }
  }
  return out;
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function formatHours(h: number) {
  return h % 24 === 0 ? plural(h / 24, "day", "days") : `${h}h`;
}

/** Shown to users under the Sparks amount, e.g. "3 Rewinds". */
export function describeExtra(e: BundleExtra): string {
  switch (e.type) {
    case "rewind":
      return plural(e.amount ?? 0, "Rewind", "Rewinds");
    case "boost":
      return plural(e.amount ?? 0, "Profile Boost", "Profile Boosts");
    case "reshuffle":
      return plural(e.amount ?? 0, "Discover Reshuffle", "Discover Reshuffles");
    case "unlimited_reshuffle":
      return `Unlimited Reshuffles (${plural(e.days ?? 0, "day", "days")})`;
    case "incognito_pass":
      return `${plural(e.amount ?? 0, "Incognito pass", "Incognito passes")} (${formatHours(e.hours ?? 0)})`;
  }
}

// ---------------------------------------------------------------------------
// Bundles
// ---------------------------------------------------------------------------

export interface SparkBundle {
  id: string;
  sort_order: number;
  name: string;
  price_zar: number;
  sparks: number;
  google_product_id: string;
  extras: BundleExtra[];
  extras_labels: string[];
}

// Used only if the spark_bundles table is missing or empty (e.g. the migration
// hasn't been run yet), so purchases keep working. Mirrors the seed data.
const FALLBACK: Omit<SparkBundle, "extras_labels">[] = [
  { id: "starter", sort_order: 1, name: "Starter", price_zar: 99, sparks: 120, google_product_id: "sparks_starter", extras: [{ type: "rewind", amount: 3 }] },
  { id: "popular", sort_order: 2, name: "Popular", price_zar: 199, sparks: 300, google_product_id: "sparks_popular", extras: [{ type: "reshuffle", amount: 5 }] },
  { id: "date_night", sort_order: 3, name: "Date Night", price_zar: 349, sparks: 600, google_product_id: "sparks_date_night", extras: [{ type: "boost", amount: 1 }] },
  { id: "power_user", sort_order: 4, name: "Power User", price_zar: 599, sparks: 1200, google_product_id: "sparks_power_user", extras: [{ type: "boost", amount: 3 }, { type: "reshuffle", amount: 5 }] },
  { id: "deep_connection", sort_order: 5, name: "Deep Connection", price_zar: 999, sparks: 2500, google_product_id: "sparks_deep_connection", extras: [{ type: "boost", amount: 5 }, { type: "unlimited_reshuffle", days: 7 }, { type: "incognito_pass", amount: 1, hours: 24 }] },
];

const withLabels = (b: Omit<SparkBundle, "extras_labels">): SparkBundle => ({
  ...b,
  extras_labels: b.extras.map(describeExtra),
});

let bundleCache: { value: SparkBundle[]; expiresAt: number } | null = null;
const CACHE_TTL_MS = 30_000;

export function invalidateSparkBundlesCache(): void {
  bundleCache = null;
}

export async function getSparkBundles(): Promise<SparkBundle[]> {
  if (bundleCache && bundleCache.expiresAt > Date.now()) return bundleCache.value;

  let result: SparkBundle[];
  try {
    const { data, error } = await supabase.from("spark_bundles").select("*").order("sort_order", { ascending: true });
    if (error || !data || data.length === 0) {
      if (error) console.error("spark_bundles read failed, using fallback:", error.message);
      result = FALLBACK.map(withLabels);
    } else {
      result = data.map((row: any) =>
        withLabels({
          id: row.id,
          sort_order: row.sort_order,
          name: row.name,
          price_zar: Number(row.price_zar),
          sparks: Number(row.sparks_amount),
          google_product_id: row.google_product_id,
          extras: parseExtrasLenient(row.extras),
        }),
      );
    }
  } catch (err) {
    console.error("spark_bundles read threw, using fallback:", err);
    result = FALLBACK.map(withLabels);
  }

  bundleCache = { value: result, expiresAt: Date.now() + CACHE_TTL_MS };
  return result;
}

// ---------------------------------------------------------------------------
// Granting (called once per completed purchase, after Sparks are credited)
// ---------------------------------------------------------------------------

export async function grantExtras(userId: string, extras: BundleExtra[]): Promise<void> {
  for (const e of extras) {
    if (e.type === "unlimited_reshuffle") {
      const { error } = await supabase.rpc("extend_unlimited_reshuffle", { p_user: userId, p_days: e.days });
      if (error) throw new Error(`unlimited_reshuffle: ${error.message}`);
    } else {
      const { error } = await supabase.rpc("grant_extra", {
        p_user: userId,
        p_type: e.type,
        p_variant: e.type === "incognito_pass" ? e.hours : 0,
        p_qty: e.amount,
      });
      if (error) throw new Error(`${e.type}: ${error.message}`);
    }
  }
}

/** Never throws: the person has already paid and received their Sparks, so a
 *  problem granting extras must not turn the purchase into an error. Every
 *  attempt is written to extras_grant_log so support can fix a failure. */
export async function grantBundleExtrasSafely(
  userId: string,
  rawExtras: unknown,
  source: "google_play" | "payfast",
  bundleId: string,
): Promise<void> {
  const extras = parseExtrasLenient(rawExtras);
  if (extras.length === 0) return;
  let errorText: string | null = null;
  try {
    await grantExtras(userId, extras);
  } catch (err) {
    errorText = err instanceof Error ? err.message : String(err);
    console.error(`EXTRAS GRANT FAILED user=${userId} bundle=${bundleId} source=${source}: ${errorText}`);
  }
  try {
    await supabase.from("extras_grant_log").insert({ user_id: userId, source, bundle_id: bundleId, extras, error: errorText });
  } catch {
    // logging only
  }
}

// ---------------------------------------------------------------------------
// Using extras
// ---------------------------------------------------------------------------

/** Uses up one of the person's items of this type. True if they had one. */
export async function consumeExtra(userId: string, type: "rewind" | "boost" | "reshuffle"): Promise<boolean> {
  const { data, error } = await supabase.rpc("consume_extra", { p_user: userId, p_type: type, p_variant: 0 });
  if (error) {
    console.error(`consume_extra(${type}) failed:`, error.message);
    return false; // fall back to charging Sparks rather than blocking the action
  }
  return data === true;
}

export async function currentBalance(userId: string): Promise<number> {
  return (await getSparksSummary(userId)).balance;
}

async function unlimitedReshuffleActive(userId: string): Promise<boolean> {
  const { data } = await supabase.from("profiles").select("unlimited_reshuffle_until").eq("id", userId).maybeSingle();
  const until = data?.unlimited_reshuffle_until ? new Date(data.unlimited_reshuffle_until).getTime() : 0;
  return until > Date.now();
}

export async function hasReshuffleExtra(userId: string): Promise<boolean> {
  if (await unlimitedReshuffleActive(userId)) return true;
  const { data } = await supabase
    .from("user_extras")
    .select("quantity")
    .eq("user_id", userId)
    .eq("extra_type", "reshuffle")
    .eq("variant", 0)
    .maybeSingle();
  return (data?.quantity ?? 0) > 0;
}

/** Unlimited-reshuffle time is used first (and costs nothing to keep using);
 *  otherwise one reshuffle credit is consumed. True if either covered it. */
export async function applyReshuffleExtra(userId: string): Promise<boolean> {
  if (await unlimitedReshuffleActive(userId)) return true;
  return consumeExtra(userId, "reshuffle");
}

export interface ExtrasInventory {
  rewind: number;
  boost: number;
  reshuffle: number;
  unlimited_reshuffle_until: string | null;
  incognito_passes: { hours: number; quantity: number }[];
  incognito_until: string | null;
}

export async function getExtrasInventory(userId: string): Promise<ExtrasInventory> {
  const [{ data: rows }, { data: profile }] = await Promise.all([
    supabase.from("user_extras").select("extra_type, variant, quantity").eq("user_id", userId).gt("quantity", 0),
    supabase.from("profiles").select("unlimited_reshuffle_until, incognito_until, is_incognito").eq("id", userId).maybeSingle(),
  ]);

  const count = (type: string) =>
    (rows ?? []).filter((r) => r.extra_type === type).reduce((sum, r) => sum + r.quantity, 0);
  const future = (v: string | null | undefined) => (v && new Date(v).getTime() > Date.now() ? v : null);

  return {
    rewind: count("rewind"),
    boost: count("boost"),
    reshuffle: count("reshuffle"),
    unlimited_reshuffle_until: future(profile?.unlimited_reshuffle_until),
    incognito_passes: (rows ?? [])
      .filter((r) => r.extra_type === "incognito_pass")
      .map((r) => ({ hours: r.variant, quantity: r.quantity }))
      .sort((a, b) => a.hours - b.hours),
    incognito_until: profile?.is_incognito ? future(profile?.incognito_until) : null,
  };
}

// ---------------------------------------------------------------------------
// Incognito pass expiry — switches Incognito off for anyone whose pass has run
// out. Runs lazily (at most once a minute per server instance) from the
// Discover queue and profile loads, so no scheduled job is needed.
// ---------------------------------------------------------------------------

let lastExpiryRun = 0;

export async function expireIncognitoIfDue(): Promise<void> {
  if (Date.now() - lastExpiryRun < 60_000) return;
  lastExpiryRun = Date.now();
  try {
    await supabase
      .from("profiles")
      .update({ is_incognito: false, incognito_until: null })
      .lt("incognito_until", new Date().toISOString());
  } catch {
    // best effort
  }
}
