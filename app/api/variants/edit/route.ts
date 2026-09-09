import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireSession } from "@/lib/auth";
import { getRun, updateRun, recordUsage } from "@/lib/db";
import { getModel } from "@/lib/models";
import { parseProductScrape } from "@/lib/product";

export const maxDuration = 120;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 90_000 });

type Variant = { title: string | null; price: string | null; available?: boolean };

const SYSTEM = `You restructure a supplier listing's product options into the option groups a Shopify product needs.

Suppliers often cram several dimensions into one group, e.g. one group named "Emitting Color" whose values are "Silvery 10CM, Silvery 20CM, Black 10CM". Shopify wants those as separate options: Color = Silvery, Black and Size = 10CM, 20CM.

You are given the current option groups, the SKU list, and the operator's instruction. Return the option groups they asked for.

Rules:
- Group names are short, title case, and what a shopper reads: Color, Size, Length, Style, Pack, Plug.
- Values keep the supplier's own wording (do not translate "Silvery" to "Silver" unless asked), but drop duplicated words that now live in another group's name.
- Never invent values a SKU does not support, and never drop a value that exists.
- For every SKU title you are given, return its new title with the values joined by " / " in the same order as the option groups. Map every SKU; do not add or remove any.
- If the instruction cannot be applied (for example splitting a group whose values have only one dimension), return the groups unchanged and say why in "note".`;

const TOOL: Anthropic.Tool = {
  name: "submit_options",
  description: "Submit the restructured option groups and the SKU title mapping.",
  input_schema: {
    type: "object",
    properties: {
      options: {
        type: "array",
        description: "The option groups, in the order they should appear in Shopify.",
        items: {
          type: "object",
          properties: { name: { type: "string" }, values: { type: "array", items: { type: "string" } } },
          required: ["name", "values"],
        },
      },
      variants: {
        type: "array",
        description: "One entry per SKU given: its original title and its new title.",
        items: {
          type: "object",
          properties: { from: { type: "string" }, to: { type: "string" } },
          required: ["from", "to"],
        },
      },
      note: { type: "string", description: "One short line for the operator, or empty." },
    },
    required: ["options"],
  },
};

export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { runId?: unknown; instruction?: unknown };
  const runId = body.runId;
  const instruction = typeof body.instruction === "string" ? body.instruction.trim().slice(0, 1000) : "";
  if (typeof runId !== "number" || !Number.isInteger(runId)) {
    return Response.json({ success: false, error: "runId (integer) required" }, { status: 400 });
  }
  if (instruction.length < 3) {
    return Response.json({ success: false, error: "Say what to change, e.g. “split into Color and Size”" }, { status: 400 });
  }
  const run = await getRun(runId);
  if (!run) return Response.json({ success: false, error: "Run not found" }, { status: 404 });

  // Current state: the operator's edit if there is one, else the listing.
  let options: Record<string, string[]> = {};
  let variants: Variant[] = [];
  try {
    const edited = run.product_variants_edited ? JSON.parse(run.product_variants_edited) as { options?: Record<string, string[]>; variants?: Variant[] } : null;
    if (edited?.options) { options = edited.options; variants = edited.variants ?? []; }
  } catch { /* fall through to the scrape */ }
  if (!Object.keys(options).length) {
    const page = parseProductScrape(run.product_scrape)?.pages.find((p) => p.role === "product");
    options = page?.options ?? {};
    variants = page?.variants ?? [];
  }
  if (!Object.keys(options).length && !variants.length) {
    return Response.json({ success: false, error: "No options on this run yet — press “Re-read listing” first." }, { status: 400 });
  }

  const titles = variants.map((v) => (v.title ?? "").trim()).filter(Boolean);
  const user = [
    "CURRENT OPTION GROUPS:",
    Object.entries(options).map(([n, vals]) => `- ${n}: ${vals.join(", ")}`).join("\n") || "(none)",
    "",
    `SKU TITLES (${titles.length}):`,
    titles.join("\n") || "(none)",
    "",
    `OPERATOR INSTRUCTION: ${instruction}`,
    "",
    "Submit the restructured options now.",
  ].join("\n");

  try {
    const model = await getModel("mechanical");
    const msg = await anthropic.messages.create({
      model,
      max_tokens: 16_000,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "submit_options" },
      messages: [{ role: "user", content: user }],
    });
    void recordUsage(runId, "variants: restructure", model, msg.usage);
    const block = msg.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") {
      return Response.json({ success: false, error: `The model returned no options (stop: ${msg.stop_reason})` }, { status: 502 });
    }
    const input = block.input as { options?: Array<{ name?: unknown; values?: unknown }>; variants?: Array<{ from?: unknown; to?: unknown }>; note?: unknown };
    const nextOptions: Record<string, string[]> = {};
    for (const g of input.options ?? []) {
      const name = typeof g?.name === "string" ? g.name.trim().slice(0, 60) : "";
      const vals = Array.isArray(g?.values) ? g.values.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean) : [];
      if (name && vals.length) nextOptions[name] = [...new Set(vals)].slice(0, 100);
    }
    if (!Object.keys(nextOptions).length) {
      return Response.json({ success: false, error: "The model returned no usable option groups" }, { status: 502 });
    }
    // Rename SKUs by the mapping, keeping the supplier's prices and stock.
    const map = new Map<string, string>();
    for (const m of input.variants ?? []) {
      if (typeof m?.from === "string" && typeof m?.to === "string" && m.to.trim()) map.set(m.from.trim(), m.to.trim().slice(0, 200));
    }
    const nextVariants: Variant[] = variants.map((v) => ({ ...v, title: map.get((v.title ?? "").trim()) ?? v.title }));

    const payload = { options: nextOptions, variants: nextVariants, at: new Date().toISOString(), source: "ai" as const, instruction };
    await updateRun(runId, { product_variants_edited: JSON.stringify(payload), last_updated_at: payload.at });
    return Response.json({ success: true, edited: payload, note: typeof input.note === "string" ? input.note : "" });
  } catch (err) {
    return Response.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
