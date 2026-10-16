// Stage 1 · Product — shared types and pure helpers (safe to import from
// client components: no Node APIs here).
//
// The stage has two halves: scrapling reads every URL the operator pasted
// (product listing + brand/competitor pages), then the analyst model writes a
// 120-word factual description from that text and the photos. The operator
// reviews the description and ticks the photos the run may use before the
// research stage starts.

export interface ProductScrapePage {
  url: string;
  role: "product" | "competitor";
  ok: boolean;
  error?: string;
  rateLimited?: boolean;
  /** The server has no scraper; the Mac worker is expected to fill this page in. */
  deferred?: boolean;
  /** "text-only" or "browser" — which fetch path the scraper needed. */
  mode?: string;
  title?: string;
  price?: string | null;
  rating?: string;
  reviews?: string;
  sold?: string;
  store?: string;
  specs?: string;
  options?: Record<string, string[]>;
  variants?: { title: string | null; price: string | null; available?: boolean }[];
  scraped_text?: string;
  long_description?: string;
  /** Copy OCR'd out of the description images (Mac runs only). */
  image_text?: string;
  positioning?: Record<string, string | string[]>;
  image_urls: string[];
  description_image_urls: string[];
}

export interface ProductScrape {
  pages: ProductScrapePage[];
  scraped_at: string;
  /** "hosted" = the app's own scraper; "local" = pushed from the Mac script. */
  source: "hosted" | "local";
}

export function parseProductScrape(json: string | null | undefined): ProductScrape | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as ProductScrape;
    if (!v || !Array.isArray(v.pages)) return null;
    return v;
  } catch {
    return null;
  }
}

export function productPageOf(scrape: ProductScrape | null): ProductScrapePage | null {
  return scrape?.pages.find((p) => p.role === "product") ?? null;
}

/** Every photo the operator can tick at the gate, deduped, product first. */
export function productCandidateImages(scrape: ProductScrape | null, uploaded: string[]): {
  url: string;
  group: "uploaded" | "product" | "description" | "competitor";
}[] {
  const out: { url: string; group: "uploaded" | "product" | "description" | "competitor" }[] = [];
  const seen = new Set<string>();
  const add = (url: string, group: "uploaded" | "product" | "description" | "competitor") => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({ url, group });
  };
  for (const u of uploaded) add(u, "uploaded");
  const prod = productPageOf(scrape);
  for (const u of prod?.image_urls ?? []) add(u, "product");
  for (const u of prod?.description_image_urls ?? []) add(u, "description");
  for (const p of scrape?.pages ?? []) {
    if (p.role !== "competitor") continue;
    for (const u of p.image_urls) add(u, "competitor");
  }
  return out;
}

// Per-page text handed to the analyst. Generous: the specs it must not miss
// often sit deep in the seller's description.
const TEXT_CAP_PER_PAGE = 40_000;

/** Default selection at the gate: the product's own gallery photos. */
export function defaultSelectedImages(scrape: ProductScrape | null, uploaded: string[]): string[] {
  const prod = productPageOf(scrape);
  const picks = [...uploaded, ...(prod?.image_urls ?? [])];
  return picks.filter((u, i, a) => a.indexOf(u) === i).slice(0, 10);
}

/**
 * The analyst's user message: each page's text, labelled by role, plus the
 * photos as vision blocks (the seller's description images often carry the
 * only real spec sheet, so they go in too).
 */
export function buildAnalystContent(scrape: ProductScrape): Array<
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "url"; url: string } }
> {
  const okPages = scrape.pages.filter((p) => p.ok);
  const parts: string[] = [];
  okPages.forEach((p, i) => {
    const isAli = /aliexpress|alibaba|1688\.com|temu\./i.test(p.url);
    const label = p.role === "product"
      ? (isAli ? "supplier listing — source of truth for specs" : "product listing")
      : "brand / competitor page — positioning example only";
    const text = [p.scraped_text ?? "", p.image_text ? `\nCOPY FROM IMAGES\n${p.image_text}` : ""]
      .join("")
      .slice(0, TEXT_CAP_PER_PAGE);
    parts.push(`URL ${i + 1} (${label}): ${p.url}\n\n${text}`);
  });
  const blocks: Array<{ type: "text"; text: string } | { type: "image"; source: { type: "url"; url: string } }> = [
    {
      type: "text",
      text:
        "Here are the fetched pages. Use all of them. Where a supplier listing and a brand page disagree on specs or details, the supplier listing is the source of truth; " +
        "if no supplier listing is present, write from the brand page(s) you have. " +
        "Describe the product only: ignore seller-side listing information such as customization, OEM/ODM offers, minimum order quantities, wholesale or dropshipping notes, shipping, returns, warranty, seller ratings and promotions.\n\n" +
        parts.join("\n\n" + "=".repeat(60) + "\n\n"),
    },
  ];
  const prod = productPageOf(scrape);
  const photos = [...(prod?.image_urls ?? []).slice(0, 3), ...(prod?.description_image_urls ?? []).slice(0, 6)];
  for (const url of photos) blocks.push({ type: "image", source: { type: "url", url } });
  if (photos.length) blocks.push({ type: "text", text: "The images above are the product listing's photos and the seller's description images (read any specs printed in them). Write the description now." });
  return blocks;
}

// ── Pack counts are the bundle, not variants ────────────────────────────────
// Suppliers list quantities as an option ("Color: 1pcs, 2pcs, 3pcs, 5pcs").
// That is how many units the buyer takes — the Kaching bundle — not a choice
// of colour or size, so a group whose values are all counts is left out of
// the variants. A group mixing a real choice with a count ("c-1pcs",
// "ab-2pcs") stays: it is a choice.

const PACK_UNIT_RE = /^(?:(?:pack|set|box|bundle|lot)\s*(?:of)?\s*)?(\d{1,3})\s*(?:x\s*)?(pcs?|psc|pieces?|packs?|pk|sets?|units?|count|ct|pairs?)\.?$/i;
const PACK_PREFIX_RE = /^(?:pack|set|box|bundle|lot)\s*(?:of)?\s*(\d{1,3})$/i;
const QTY_GROUP_RE = /\b(qty|quantity|pack|package|pcs|number|amount|count|sets?)\b/i;

/** The count in a pack value ("3pcs", "Set of 2", "2 Pieces"), or null. */
export function packCount(value: string, groupName = ""): number | null {
  const v = value.trim();
  const m = v.match(PACK_UNIT_RE) ?? v.match(PACK_PREFIX_RE);
  if (m) return Number(m[1]);
  // A bare number only counts when the group itself says it is a quantity.
  if (/^\d{1,3}$/.test(v) && QTY_GROUP_RE.test(groupName)) return Number(v);
  return null;
}

// "Black-2pcs", "Grey 4 pcs", "c-1pcs": a real choice with a count attached.
const NAMED_COUNT_RE = /^(.*?)[\s\-_/,+(]*(\d{1,3})\s*(pcs?|psc|pieces?|packs?|pk|sets?|units?|pairs?)\.?\)?$/i;

/** Listing options without pack counts, plus the counts found. A group of
 *  counts goes entirely; a group whose values carry a count ("Black-2pcs")
 *  keeps only the choice (Black); a group left with one value is no choice. */
export function splitPackOptions(options: Record<string, string[]> | null | undefined): { options: Record<string, string[]>; packCounts: number[] } {
  const out: Record<string, string[]> = {};
  const counts = new Set<number>();
  for (const [name, values] of Object.entries(options ?? {})) {
    const nums = values.map((v) => packCount(v, name));
    if (values.length && nums.every((n) => n !== null)) { nums.forEach((n) => counts.add(n!)); continue; }
    const parts = values.map((v) => v.trim().match(NAMED_COUNT_RE));
    if (values.length && parts.every((m) => m && m[1].trim())) {
      parts.forEach((m) => counts.add(Number(m![2])));
      const choices = [...new Set(parts.map((m) => m![1].trim()))];
      if (choices.length > 1) out[name] = choices;
      continue;
    }
    if (values.length > 1) out[name] = values;
  }
  return { options: out, packCounts: [...counts].sort((a, b) => a - b) };
}
