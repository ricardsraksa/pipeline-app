import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireSession } from "@/lib/auth";
import { getRun, updateRun, recordUsage } from "@/lib/db";
import { getModel } from "@/lib/models";
import { parseProductScrape } from "@/lib/product";
import { buildBundles, defaultQtys, type Bundles, type ProductPricing } from "@/lib/pricing";
import { getPricingRules } from "@/lib/pricing-store";

export const maxDuration = 120;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 90_000 });

// Picks the quantity for each bundle tier from how the product is used. The
// discounts come from the pricing rules; the model only returns quantities.
// Nothing it says is stored or shown — the quantities are the whole output.
const SYSTEM = `You set the quantities for a store's bundle offer: a ladder of tiers (single, 2 pack, 3 pack …) sold at a per-item discount that grows with quantity.

Quantities are in listing units: one unit is what the supplier listing sells as one order (one strip, one pair, one 4-pack).

Rules:
- Default to 1, 2, 3 … (one tier per discount given). Keep the default unless the product is used in a fixed set.
- A fixed set means the customer needs a specific count for one use: stair lights (one per step; a house has 12–16 steps), chair-leg pads (4 per chair), curtain rings, a pair of anything sold singly. Then the smallest tier is the count for one typical use and the next tiers are the next realistic counts.
- When the listing itself is already a multi-pack (10pcs, set of 4), the unit is that pack — keep 1, 2, 3.
- Quantities are whole numbers, strictly increasing, and there must be exactly as many as there are discount tiers.
- The operator's note, when present, overrides these rules.`;

const TOOL: Anthropic.Tool = {
  name: "submit_bundle_quantities",
  description: "Submit the quantity for each bundle tier.",
  input_schema: {
    type: "object",
    properties: {
      quantities: { type: "array", items: { type: "integer" }, description: "One whole number per tier, strictly increasing." },
    },
    required: ["quantities"],
  },
};

export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { runId?: unknown; note?: unknown };
  const runId = body.runId;
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
  if (typeof runId !== "number" || !Number.isInteger(runId)) {
    return Response.json({ success: false, error: "runId (integer) required" }, { status: 400 });
  }
  const run = await getRun(runId);
  if (!run) return Response.json({ success: false, error: "Run not found" }, { status: 404 });

  let pricing: ProductPricing | null = null;
  try { pricing = run.product_pricing ? JSON.parse(run.product_pricing) as ProductPricing : null; } catch { pricing = null; }
  if (!pricing || !(pricing.price > 0) || !(pricing.compare_at > 0)) {
    return Response.json({ success: false, error: "No price on this run yet" }, { status: 400 });
  }

  const rules = await getPricingRules();
  const tiersWanted = rules.bundle_discounts.length;
  const page = parseProductScrape(run.product_scrape)?.pages.find((p) => p.role === "product");
  const description = run.product_description_edited || run.product_description_ai || run.product_description || "";
  const options = page?.options ?? {};
  const variantTitles = (page?.variants ?? []).map((v) => (v.title ?? "").trim()).filter(Boolean).slice(0, 60);

  const user = [
    `LISTING TITLE: ${page?.title ?? "(unknown)"}`,
    page?.sold ? `SOLD: ${page.sold}` : "",
    "",
    "PRODUCT:",
    description.slice(0, 6000) || "(no description)",
    "",
    "LISTING OPTIONS:",
    Object.entries(options).map(([n, vals]) => `- ${n}: ${vals.join(", ")}`).join("\n") || "(none)",
    variantTitles.length ? `\nSKU TITLES:\n${variantTitles.join("\n")}` : "",
    run.stage1_one_pager ? `\nRESEARCH ONE-PAGER:\n${run.stage1_one_pager.slice(0, 8000)}` : "",
    "",
    `TIERS: ${tiersWanted} (per-item discounts ${rules.bundle_discounts.map((d) => `${Math.round(d * 100)}%`).join(" / ")})`,
    `DEFAULT QUANTITIES: ${defaultQtys(rules).join(", ")}`,
    note ? `\nOPERATOR NOTE: ${note}` : "",
    "",
    "Submit the quantities now.",
  ].filter((l) => l !== "").join("\n");

  const stamp = (bundles: Bundles | undefined, extra: Partial<Bundles>): Bundles => ({
    tiers: bundles?.tiers ?? [],
    source: bundles?.source ?? "rules",
    at: new Date().toISOString(),
    ...bundles,
    ...extra,
  });
  const persist = async (bundles: Bundles) => {
    const next: ProductPricing = { ...pricing!, bundles, at: new Date().toISOString() };
    await updateRun(runId, { product_pricing: JSON.stringify(next), last_updated_at: next.at });
    return next;
  };

  try {
    const model = await getModel("pricing");
    const msg = await anthropic.messages.stream({
      model,
      max_tokens: 8_000,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "submit_bundle_quantities" },
      messages: [{ role: "user", content: user }],
    }).finalMessage();
    void recordUsage(runId, "pricing: bundle quantities", model, msg.usage);
    const block = msg.content.find((b) => b.type === "tool_use");
    const raw = block && block.type === "tool_use" ? (block.input as { quantities?: unknown }).quantities : null;
    const qtys = Array.isArray(raw) ? raw.map((q) => Math.round(Number(q))) : [];
    const valid = qtys.length === tiersWanted && qtys.every((q, i) => Number.isInteger(q) && q >= 1 && (i === 0 || q > qtys[i - 1]));
    if (!valid) {
      // Mark the attempt so the card doesn't retry on every poll; the button remains.
      await persist(stamp(pricing.bundles, { ai_at: new Date().toISOString() }));
      return Response.json({ success: false, error: `The model returned no usable quantities (stop: ${msg.stop_reason})` }, { status: 502 });
    }
    // Hand-typed tiers survive an automatic run; "Suggest again" (a note or an
    // explicit press) rebuilds every tier.
    const explicit = body.note !== undefined;
    const fresh = buildBundles(pricing, qtys, rules, { source: "ai", ai_at: new Date().toISOString() });
    const keepManual = !explicit && pricing.bundles?.tiers.some((t) => t.manual);
    const bundles = keepManual ? { ...fresh, tiers: pricing.bundles!.tiers } : fresh;
    const next = await persist(bundles);
    return Response.json({ success: true, pricing: next });
  } catch (err) {
    await persist(stamp(pricing.bundles, { ai_at: new Date().toISOString() })).catch(() => {});
    return Response.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
