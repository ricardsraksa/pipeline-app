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
}

export const DEFAULT_PRICING_RULES: PricingRules = { min_multiple: 4, ending: 0.95, compare_at_min: 5, compare_at_max: 10 };

export interface Money { amount: number; currency: string }
export interface MarketBand { low: number; median: number; high: number; n: number }
export interface CompetitorPrice { url: string; price: number; currency: string }
export type PriceFit = "in range" | "above market" | "below market";

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
  return null;
}

export function normalizeRules(x: unknown): PricingRules {
  if (validateRules(x)) return { ...DEFAULT_PRICING_RULES };
  const r = x as PricingRules;
  return { min_multiple: r.min_multiple, ending: round2(r.ending), compare_at_min: Math.round(r.compare_at_min), compare_at_max: Math.round(r.compare_at_max) };
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
  return {
    cogs: cogs.amount,
    cogs_currency: cogs.currency,
    cogs_source: cogsOverride ? "manual" : "scrape",
    price,
    compare_at: compareAtFor(price, rules),
    fit: fitFor(price, band),
    band,
    competitors,
    source: "auto",
    rules,
    at: new Date().toISOString(),
  };
}
