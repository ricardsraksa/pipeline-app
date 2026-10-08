// Shopify category and product type for a product the push created.
//
// A copy of the template would otherwise carry the template's category to
// every product. The category comes from Shopify's own list (its standard
// taxonomy), so the model only ever chooses among ids Shopify returned:
// search terms first, then one pick from the candidates.
import type { Run } from "@/lib/db";
import { recordUsage } from "@/lib/db";
import { anthropicClient } from "@/lib/anthropic-client";
import { getModel, streamToolCall } from "@/lib/models";
import { shopifyGraphQL } from "@/lib/shopify";
import { effectiveDescription } from "@/lib/run-context";

const anthropic = anthropicClient({ timeout: 60_000 });

export interface CategoryPick { id: string; fullName: string; productType: string }

const SEARCH = `
query C($q: String!) { taxonomy { categories(first: 8, search: $q) { nodes { id fullName isLeaf } } } }`;

const TERMS_TOOL = {
  name: "submit_terms",
  description: "Submit search terms for the store's product category list, and the product type.",
  input_schema: {
    type: "object" as const,
    properties: {
      terms: { type: "array", items: { type: "string" }, description: "2 to 4 short category search terms, most specific first: 'cutting board', 'kitchen utensil', 'cat bed'." },
      product_type: { type: "string", description: "What the product is, 1 to 3 words, Title Case: 'Cutting Board', 'Cat Shelter', 'Shelf Divider'." },
    },
    required: ["terms", "product_type"],
  },
};

const PICK_TOOL = {
  name: "submit_category",
  description: "Submit the one category that fits the product best.",
  input_schema: {
    type: "object" as const,
    properties: { id: { type: "string", description: "The id of the chosen category, copied exactly." } },
    required: ["id"],
  },
};

export async function pickCategory(run: Run): Promise<CategoryPick | null> {
  const name = (run.brand_name ?? run.product_name ?? "").trim();
  const description = effectiveDescription(run).slice(0, 2500);
  const model = await getModel("mechanical");
  const usage = (label: string) => (u: Parameters<typeof recordUsage>[3]) => void recordUsage(run.id, label, model, u);

  const t = await streamToolCall(anthropic, {
    model,
    max_tokens: 2000,
    system: "You classify a DTC product for a Shopify store.",
    tools: [TERMS_TOOL],
    messages: [{ role: "user", content: `PRODUCT: ${name}\n\n${description}` }],
  }, "submit_terms", usage("shopify: category terms"));
  const tIn = t.content.find((b) => b.type === "tool_use")?.input as { terms?: unknown; product_type?: unknown } | undefined;
  const terms = Array.isArray(tIn?.terms) ? tIn!.terms.filter((x): x is string => typeof x === "string" && x.trim().length > 1).slice(0, 4) : [];
  const productType = typeof tIn?.product_type === "string" ? tIn.product_type.trim().slice(0, 60) : "";
  if (!terms.length) return null;

  const seen = new Map<string, string>();
  for (const q of terms) {
    const d = await shopifyGraphQL<{ taxonomy: { categories: { nodes: Array<{ id: string; fullName: string; isLeaf: boolean }> } } }>(SEARCH, { q });
    for (const c of d.taxonomy.categories.nodes) if (!seen.has(c.id)) seen.set(c.id, c.fullName);
  }
  if (!seen.size) return null;
  const candidates = [...seen.entries()];
  if (candidates.length === 1) return { id: candidates[0][0], fullName: candidates[0][1], productType };

  const p = await streamToolCall(anthropic, {
    model,
    max_tokens: 2000,
    system: "You pick the Shopify category a product belongs in. Prefer the most specific category that is still accurate.",
    tools: [PICK_TOOL],
    messages: [{ role: "user", content: `PRODUCT: ${name}\n\n${description.slice(0, 1200)}\n\nCATEGORIES:\n${candidates.map(([id, full]) => `${id} — ${full}`).join("\n")}` }],
  }, "submit_category", usage("shopify: category pick"));
  const id = (p.content.find((b) => b.type === "tool_use")?.input as { id?: unknown } | undefined)?.id;
  const chosen = typeof id === "string" ? candidates.find(([cid]) => cid === id.trim()) : undefined;
  return chosen ? { id: chosen[0], fullName: chosen[1], productType } : null;
}

const UPDATE = `
mutation U($product: ProductUpdateInput!) {
  productUpdate(product: $product) { userErrors { message } }
}`;

/** Set the category and product type on a product the push just created. */
export async function applyCategory(productGid: string, pick: CategoryPick): Promise<void> {
  const d = await shopifyGraphQL<{ productUpdate: { userErrors: Array<{ message: string }> } }>(UPDATE, {
    product: { id: productGid, category: pick.id, ...(pick.productType ? { productType: pick.productType } : {}) },
  });
  const errs = d.productUpdate.userErrors ?? [];
  if (errs.length) throw new Error(errs.map((e) => e.message).join("; "));
}
