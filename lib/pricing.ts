// Pricing rules — pure, client-safe. Suggests a retail price from the supplier
// cost (COGS) and the competitor prices the Stage 1 scrape read. Display only:
// nothing here feeds a prompt, the Google Doc or Shopify.
import type { ProductScrape, ProductScrapePage } from "@/lib/product";

export interface PricingRules {
  /** Retail must be at least this many times COGS. */
  min_multiple: number;
  /** Cents the price ends in (0.95 → 28.95). */
  ending: number;
  /** Compare-at sits this many whole dollars above the price. */
  compare_at_min: number;
  compare_at_max: number;
  /** Per-item discount for each bundle tier; index 0 is the single (always 0). */
  bundle_discounts: number[];
}

export const DEFAULT_PRICING_RULES: PricingRules = { min_multiple: 4, ending: 0.95, compare_at_min: 5, compare_at_max: 10, bundle_discounts: [0, 0.2, 0.25] };

export interface Money { amount: number; currency: string }
export interface MarketBand { low: number; median: number; high: number; n: number }
export interface CompetitorPrice { url: string; price: number; currency: string }
export type PriceFit = "in range" | "above market" | "below market";

export interface BundleTier {
  /** Listing units in this tier (what one scraped COGS buys, times qty). */
  qty: number;
  /** Per-item discount against the single price, 0–0.9. */
  discount: number;
  price: number;
  compare_at: number;
  /** Price or compare-at typed by hand; not recomputed until Reset. */
  manual?: boolean;
}

export interface Bundles {
  tiers: BundleTier[];
  source: "rules" | "ai" | "manual";
  /** Set once the quantity suggestion has run for this run (success or not). */
  ai_at?: string;
  at: string;
}

export interface ProductPricing {
  cogs: number;
  cogs_currency: string;
  cogs_source: "scrape" | "manual";
  price: number;
  compare_at: number;
  fit: PriceFit | null;
  band: MarketBand | null;
  competitors: CompetitorPrice[];
  source: "auto" | "manual";
  rules: PricingRules;
  bundles?: Bundles;
  at: string;
}

export function round2(x: number): number { return Math.round(x * 100) / 100; }

/** Validate + coerce a rules object; returns an error string when unusable. */
export function validateRules(x: unknown): string | null {
  const r = x as Partial<PricingRules> | null;
  if (!r || typeof r !== "object") return "rules object required";
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  if (!num(r.min_multiple) || (r.min_multiple as number) < 1) return "Minimum multiple must be a number ≥ 1";
  if (!num(r.ending) || (r.ending as number) < 0 || (r.ending as number) >= 1) return "Price ending must be between 0 and 0.99";
  if (!num(r.compare_at_min) || (r.compare_at_min as number) < 0) return "Compare-at minimum must be ≥ 0";
  if (!num(r.compare_at_max) || (r.compare_at_max as number) < (r.compare_at_min as number)) return "Compare-at maximum must be ≥ the minimum";
  if (r.bundle_discounts !== undefined) {
    const err = validateBundleDiscounts(r.bundle_discounts);
    if (err) return err;
  }
  return null;
}

export function validateBundleDiscounts(x: unknown): string | null {
  if (!Array.isArray(x) || x.length < 1 || x.length > 6) return "Bundle discounts need 1–6 tiers";
  if (x.some((d) => typeof d !== "number" || !Number.isFinite(d) || d < 0 || d >= 0.9)) return "Each bundle discount must be between 0 and 89%";
  if (x[0] !== 0) return "The first tier is the single — its discount is 0";
  return null;
}

/** "0, 20, 25" → [0, 0.2, 0.25]; null when unparsable. */
export function parseBundleDiscounts(text: string): number[] | null {
  const parts = text.split(/[,\s/]+/).map((t) => t.trim()).filter(Boolean);
  if (!parts.length) return null;
  const out: number[] = [];
  for (const t of parts) {
    const n = Number(t.replace("%", ""));
    if (!Number.isFinite(n)) return null;
    out.push(round2(n / 100));
  }
  return out;
}

export function normalizeRules(x: unknown): PricingRules {
  if (validateRules(x)) return { ...DEFAULT_PRICING_RULES };
  const r = x as PricingRules;
  const bundle_discounts = validateBundleDiscounts(r.bundle_discounts) ? [...DEFAULT_PRICING_RULES.bundle_discounts] : r.bundle_discounts.map((d) => round2(d));
  return { min_multiple: r.min_multiple, ending: round2(r.ending), compare_at_min: Math.round(r.compare_at_min), compare_at_max: Math.round(r.compare_at_max), bundle_discounts };
}

const CURRENCY_SYMBOL: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };

/** "14.49 EUR", "$3.21", "14,49 €", "US $3.21", "3.21 USD" → { amount, currency }. */
export function parseMoney(s: string | null | undefined): Money | null {
  if (!s) return null;
  const str = String(s).trim();
  let currency = "USD";
  const code = str.match(/\b(USD|EUR|GBP|CAD|AUD|CHF|SEK|NOK|DKK|PLN|CZK|JPY|CNY)\b/i);
  if (code) currency = code[1].toUpperCase();
  else if (/€/.test(str)) currency = "EUR";
  else if (/£/.test(str)) currency = "GBP";
  const m = str.match(/\d[\d.,]*/);
  if (!m) return null;
  let raw = m[0].replace(/[.,]$/, "");
  const lastDot = raw.lastIndexOf("."), lastComma = raw.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // Both present: the later one is the decimal separator.
    raw = lastDot > lastComma ? raw.replace(/,/g, "") : raw.replace(/\./g, "").replace(",", ".");
  } else if (lastComma >= 0) {
    // Only commas: "14,49" is a decimal, "1,234" is thousands.
    const tail = raw.length - lastComma - 1;
    raw = tail === 2 ? raw.replace(",", ".") : raw.replace(/,/g, "");
  } else if (lastDot >= 0) {
    const tail = raw.length - lastDot - 1;
    if (tail === 3 && raw.indexOf(".") === lastDot && raw.length > 5) raw = raw.replace(".", "");
  }
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount: round2(amount), currency };
}

export function fmtMoney(amount: number, currency = "USD"): string {
  const sym = CURRENCY_SYMBOL[currency];
  const n = amount.toFixed(2);
  return sym ? `${sym}${n}` : `${n} ${currency}`;
}

/** Smallest value ≥ x that ends in `ending` (28.31 → 28.95; 28.96 → 29.95). */
export function toEnding(x: number, ending: number): number {
  let v = Math.floor(x) + ending;
  if (v < x - 1e-9) v += 1;
  return round2(v);
}

export function marketBand(prices: number[]): MarketBand | null {
  const xs = prices.filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  const median = xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
  return { low: xs[0], median: round2(median), high: xs[xs.length - 1], n: xs.length };
}

export function fitFor(price: number, band: MarketBand | null): PriceFit | null {
  if (!band) return null;
  if (price > band.high + 1e-9) return "above market";
  if (price < band.low - 1e-9) return "below market";
  return "in range";
}

/** Competitors set the range, the rules set the floor. */
export function suggestPrice(cogs: number, band: MarketBand | null, rules: PricingRules): { price: number; floor: number; target: number | null } {
  const floor = toEnding(cogs * rules.min_multiple, rules.ending);
  if (!band) return { price: floor, floor, target: null };
  const target = toEnding(band.median * 0.95, rules.ending);
  return { price: Math.max(floor, target), floor, target };
}

export function compareAtFor(price: number, rules: PricingRules): number {
  const bump = Math.min(rules.compare_at_max, Math.max(rules.compare_at_min, Math.round(price * 0.25)));
  return round2(price + bump);
}

// ---- Bundles (Kaching-style quantity tiers) --------------------------------

/** Next whole dollar up, then the ending (198.68 → 199.95, 201.00 → 201.95); a value already on the ending stays. */
export function roundUpToEnding(x: number, ending: number): number {
  const cents = round2(x - Math.floor(x));
  if (Math.abs(cents - ending) < 0.005) return round2(x);
  return round2(Math.ceil(x) + ending);
}

/** Tier price: qty × single × (1 − discount), rounded up to the ending. */
export function tierPrice(single: number, qty: number, discount: number, rules: PricingRules): number {
  return roundUpToEnding(single * qty * (1 - discount), rules.ending);
}

export function tierCompareAt(compareAt: number, qty: number): number {
  return round2(compareAt * qty);
}

export function defaultQtys(rules: PricingRules): number[] {
  return rules.bundle_discounts.map((_, i) => i + 1);
}

/** The bundle ladder for a single price / compare-at at the given quantities. */
export function buildBundles(
  p: { price: number; compare_at: number },
  qtys: number[],
  rules: PricingRules,
  meta: { source: Bundles["source"]; ai_at?: string },
): Bundles {
  const tiers: BundleTier[] = qtys.map((qty, i) => {
    const discount = rules.bundle_discounts[i] ?? rules.bundle_discounts[rules.bundle_discounts.length - 1] ?? 0;
    return { qty, discount, price: tierPrice(p.price, qty, discount, rules), compare_at: tierCompareAt(p.compare_at, qty) };
  });
  return { tiers, source: meta.source, ...(meta.ai_at ? { ai_at: meta.ai_at } : {}), at: new Date().toISOString() };
}

/** Recompute every non-manual tier from a new single price / compare-at. */
export function rebuildBundles(bundles: Bundles, p: { price: number; compare_at: number }, rules: PricingRules): Bundles {
  return {
    ...bundles,
    tiers: bundles.tiers.map((t) => t.manual ? t : { ...t, price: tierPrice(p.price, t.qty, t.discount, rules), compare_at: tierCompareAt(p.compare_at, t.qty) }),
    at: new Date().toISOString(),
  };
}

/** Validate a stored bundles block; returns an error string when unusable. */
export function validateBundles(x: unknown): string | null {
  const b = x as Partial<Bundles> | null;
  if (!b || typeof b !== "object") return "bundles object required";
  if (!Array.isArray(b.tiers) || b.tiers.length < 1 || b.tiers.length > 6) return "bundles need 1–6 tiers";
  let prev = 0;
  for (const t of b.tiers as Partial<BundleTier>[]) {
    if (!t || typeof t !== "object") return "bad tier";
    if (!Number.isInteger(t.qty) || (t.qty as number) < 1 || (t.qty as number) <= prev) return "tier quantities must be whole numbers, strictly increasing";
    prev = t.qty as number;
    if (typeof t.discount !== "number" || !Number.isFinite(t.discount) || t.discount < 0 || t.discount >= 0.9) return "tier discount must be between 0 and 0.9";
    if (typeof t.price !== "number" || !(t.price > 0) || typeof t.compare_at !== "number" || !(t.compare_at > 0)) return "tier price and compare_at must be positive";
  }
  if (!["rules", "ai", "manual"].includes(String(b.source))) return "bundles.source must be rules, ai or manual";
  if (b.ai_at !== undefined && (typeof b.ai_at !== "string" || Number.isNaN(Date.parse(b.ai_at)))) return "bundles.ai_at must be an ISO date";
  return null;
}

/**
 * Checks drawn from the pricing-strategy / marketing-psychology rules: charm
 * ending, anchor above price, each tier a better per-item deal than the last,
 * no more than four tiers, a round-up that crossed a left digit, per-item
 * multiple not collapsing.
 */
export function bundleWarnings(p: { cogs: number; price: number; bundles?: Bundles }, rules: PricingRules): string[] {
  const out: string[] = [];
  const tiers = p.bundles?.tiers ?? [];
  if (!tiers.length) return out;
  const endingTxt = `.${String(Math.round(rules.ending * 100)).padStart(2, "0")}`;
  if (tiers.length > 4) out.push(`${tiers.length} bundle tiers — three or four is the limit shoppers compare`);
  let prevUnit = Infinity;
  let prevDiscount = -1;
  tiers.forEach((t, i) => {
    const name = i === 0 ? "single" : `${t.qty}-pack`;
    const cents = round2(t.price - Math.floor(t.price));
    if (Math.abs(cents - rules.ending) > 0.005) out.push(`${name} doesn't end in ${endingTxt}`);
    if (t.compare_at <= t.price + 1e-9) out.push(`${name} compare-at is not above its price`);
    const unit = t.price / t.qty;
    if (i > 0 && unit >= prevUnit - 1e-9) out.push(`${name} is not cheaper per item than the tier before it`);
    if (i > 0 && t.discount + 1e-9 < prevDiscount) out.push(`${name} discount is smaller than the tier before it`);
    prevUnit = unit; prevDiscount = t.discount;
    if (unit < p.cogs * 2 - 1e-9) out.push(`${name} is under 2× COGS per item (${fmtMoney(round2(unit))})`);
    // Round-up that crossed a $10 / $100 line the raw price sat under.
    const raw = p.price * t.qty * (1 - t.discount);
    for (const line of [10, 100, 1000]) {
      if (raw < line && t.price >= line && !t.manual) {
        const under = round2(line - 1 + rules.ending);
        out.push(`${name} rounded across $${line} — ${fmtMoney(under)} keeps the left digit`);
      }
    }
  });
  return out;
}

export function pricingWarnings(p: { cogs: number; price: number; compare_at: number }, band: MarketBand | null, rules: PricingRules): string[] {
  const out: string[] = [];
  const minPrice = p.cogs * rules.min_multiple;
  if (p.price < minPrice - 1e-9) out.push(`below ${rules.min_multiple}× COGS (${fmtMoney(minPrice)})`);
  const cents = round2(p.price - Math.floor(p.price));
  if (Math.abs(cents - rules.ending) > 0.005) out.push(`doesn't end in .${String(Math.round(rules.ending * 100)).padStart(2, "0")}`);
  const bump = round2(p.compare_at - p.price);
  if (bump < rules.compare_at_min - 1e-9 || bump > rules.compare_at_max + 1e-9) out.push(`compare-at not $${rules.compare_at_min}–${rules.compare_at_max} above price`);
  if (band) {
    if (p.price > band.high + 1e-9) out.push(`above every competitor (highest ${fmtMoney(band.high)})`);
    if (p.price < band.low - 1e-9) out.push(`below the cheapest competitor (${fmtMoney(band.low)})`);
  }
  return out;
}

function pagePrice(p: ProductScrapePage): Money | null {
  const top = parseMoney(p.price);
  if (top) return top;
  const variants = (p.variants ?? []).map((v) => parseMoney(v.price)).filter((m): m is Money => !!m);
  if (!variants.length) return null;
  return variants.sort((a, b) => a.amount - b.amount)[0];
}

/** Supplier cost (product page) and competitor prices out of a Stage 1 scrape. */
export function pricesFromScrape(scrape: ProductScrape | null): { cogs: Money | null; competitors: CompetitorPrice[] } {
  if (!scrape) return { cogs: null, competitors: [] };
  const product = scrape.pages.find((p) => p.role === "product" && p.ok);
  const cogs = product ? pagePrice(product) : null;
  const competitors = scrape.pages
    .filter((p) => p.role === "competitor" && p.ok)
    .map((p) => ({ url: p.url, money: pagePrice(p) }))
    .filter((x): x is { url: string; money: Money } => !!x.money)
    .map((x) => ({ url: x.url, price: x.money.amount, currency: x.money.currency }));
  return { cogs, competitors };
}

/** The auto suggestion for a run. `cogsOverride` = operator-entered cost. */
export function buildPricing(scrape: ProductScrape | null, rules: PricingRules, cogsOverride?: Money): ProductPricing | null {
  const { cogs: scraped, competitors } = pricesFromScrape(scrape);
  const cogs = cogsOverride ?? scraped;
  if (!cogs) return null;
  const band = marketBand(competitors.filter((c) => c.currency === cogs.currency).map((c) => c.price));
  const { price } = suggestPrice(cogs.amount, band, rules);
  const compare_at = compareAtFor(price, rules);
  return {
    cogs: cogs.amount,
    cogs_currency: cogs.currency,
    cogs_source: cogsOverride ? "manual" : "scrape",
    price,
    compare_at,
    fit: fitFor(price, band),
    band,
    competitors,
    source: "auto",
    rules,
    bundles: buildBundles({ price, compare_at }, defaultQtys(rules), rules, { source: "rules" }),
    at: new Date().toISOString(),
  };
}
