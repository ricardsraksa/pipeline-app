// Everything the pipeline knows about one product, as one block of text for
// the question assistant. It reads the same effective values every stage
// reads (lib/run-context.ts), so an answer is about the product as it now
// stands, edits included.
import type { Run } from "@/lib/db";
import { parseProductScrape, productPageOf } from "@/lib/product";
import { parseSelectedAngles } from "@/lib/angles";
import { parseStoredMarketPosition, marketBlock } from "@/lib/market";
import { effectiveCopy, effectiveDescription, editsBlock } from "@/lib/run-context";
import { onePagerForDownstream } from "@/lib/research-edits";
import type { ProductPricing } from "@/lib/pricing";
import { audienceBlock, parseStoredAudience } from "@/lib/audience";

const cap = (s: string | null | undefined, n: number) => {
  const t = (s ?? "").trim();
  return t.length > n ? `${t.slice(0, n)}\n[…cut for length]` : t;
};
const json = <T,>(raw: string | null | undefined, fallback: T): T => {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
};
const section = (title: string, body: string) => (body.trim() ? `## ${title}\n${body.trim()}` : "");

export function buildProductContext(run: Run): string {
  const scrape = parseProductScrape(run.product_scrape);
  const page = productPageOf(scrape);
  const name = run.brand_name ?? run.product_name ?? "(unnamed)";

  // The listing as the supplier sells it: options, SKUs, specs.
  const options = Object.entries(page?.options ?? {}).map(([k, v]) => `- ${k}: ${v.join(", ")}`).join("\n");
  const skus = (page?.variants ?? []).slice(0, 60).map((v) => `- ${v.title ?? "?"}${v.price ? ` — ${v.price}` : ""}${v.available === false ? " (sold out)" : ""}`).join("\n");
  const edited = json<{ options?: Record<string, string[]> } | null>(run.product_variants_edited, null);
  const editedOptions = edited?.options ? Object.entries(edited.options).map(([k, v]) => `- ${k}: ${v.join(", ")}`).join("\n") : "";
  const listing = [
    page?.title ? `Title: ${page.title}` : "",
    page?.price ? `Supplier price: ${page.price}` : "",
    page?.specs ? `Specs: ${page.specs}` : "",
    page?.sold ? `Sold: ${page.sold}` : "",
    options ? `Option groups on the listing:\n${options}` : "",
    editedOptions ? `Option groups as the operator restructured them (these are what goes to Shopify):\n${editedOptions}` : "",
    skus ? `SKUs:\n${skus}` : "",
    page?.long_description ? `Seller description:\n${cap(page.long_description, 4000)}` : "",
    page?.image_text ? `Text printed in the listing images (size charts often live here):\n${cap(page.image_text, 3000)}` : "",
  ].filter(Boolean).join("\n\n");

  const pricing = json<ProductPricing | null>(run.product_pricing, null);
  const pricingText = pricing ? [
    `COGS ${pricing.cogs} ${pricing.cogs_currency} · price ${pricing.price} · compare-at ${pricing.compare_at}`,
    pricing.band ? `Competitors ${pricing.band.low}–${pricing.band.high}, median ${pricing.band.median}` : "",
    pricing.bundles?.tiers?.length ? `Bundles: ${pricing.bundles.tiers.map((t) => `${t.qty} × → ${t.price} (cmp ${t.compare_at})`).join("; ")}` : "",
  ].filter(Boolean).join("\n") : "";

  const angle = parseSelectedAngles(run.product_angle_selected)[0];
  const angleText = angle ? `${angle.title}\nProblem: ${angle.problem}\nMechanism: ${angle.mechanism}\nHook: ${angle.hook}` : "";
  const market = marketBlock(parseStoredMarketPosition(run.market_position));

  const prompts = json<Array<{ index?: number; category?: string; overlay_text?: string }>>(run.stage3_remaining_prompts_edited ?? run.stage3_remaining_prompts, []);
  const images = json<Array<{ index?: number; status?: string; verdict?: string; user_override?: string | null }>>(run.stage3_remaining_images, []);
  const imagesText = prompts.map((p) => {
    const im = images.find((x) => x.index === p.index);
    const state = im ? (im.status === "done" ? (im.user_override ?? im.verdict ?? "done") : "failed") : "not generated";
    return `- #${p.index} ${p.category ?? ""}${p.overlay_text ? ` — "${p.overlay_text}"` : ""} (${state})`;
  }).join("\n");
  const ads = json<Array<{ index?: number; concept_label?: string; headline?: string }>>(run.ads_prompts_edited ?? run.ads_prompts, []);
  const adsText = ads.map((a) => `- ${a.concept_label ?? "ad"}: "${a.headline ?? ""}"`).join("\n");

  const competitors = json<string[]>(run.competitor_urls, []);
  const compPages = (scrape?.pages ?? []).filter((p) => p.role === "competitor" && p.ok);
  const compText = competitors.map((u) => {
    const pg = compPages.find((p) => p.url === u);
    return `- ${u}${pg?.price ? ` — ${pg.price}` : ""}${pg?.title ? ` — ${pg.title}` : ""}`;
  }).join("\n");

  return [
    `# ${run.product_code ? `${run.product_code} · ` : ""}${name}`,
    section("Who it is for", audienceBlock(parseStoredAudience(run.audience))),
    section("Product description (as the operator has it)", effectiveDescription(run)),
    section("Supplier listing", listing),
    section("Pricing", pricingText),
    section("Research one-pager", onePagerForDownstream(run)),
    section("Chosen positioning angle", angleText),
    section("Market position", market),
    section("Copy kit", cap(effectiveCopy(run), 12_000)),
    section("Stage 4 images", imagesText),
    section("Stage 5 ads", adsText),
    section("Competitors", compText),
    section("What the operator changed", editsBlock(run, ["product", "research", "angles", "copy", "images", "image_prompts", "ads_briefs"])),
    section("Full research (for customer and market questions)", cap(run.step_research_revised ?? run.step_research, 14_000)),
  ].filter(Boolean).join("\n\n");
}
