// Fill an existing Shopify product with a run's copy + images.
//
// STRICT / REVERSIBLE by construction:
//   - metafieldsSet (upsert) + optional title update + APPEND-only media
//   - never deletes media, never publishes, never touches price/status/handle
//   - a token assertion on every outgoing mutation makes that mechanical
//   - dryRun computes the full report with zero mutations

import { shopifyGraphQL, shopConfig } from "@/lib/shopify";
import { SHOPIFY_FIELDS } from "./fields";
import { fetchDefinitions, matchFields, orphanDefinitions, type MetafieldDef } from "./metafields";
import type { ProductRef } from "./resolve";
import type { Stage2Json } from "@/lib/stage2/shape";

// Any mutation containing one of these tokens is refused before it is sent.
const FORBIDDEN_TOKENS = [
  "productDelete",
  "productDeleteMedia",
  "fileDelete",
  "publishablePublish",
  "productPublish",
  "productVariantsBulkUpdate",
  "priceUpdate",
];

function assertStrict(mutation: string): void {
  for (const t of FORBIDDEN_TOKENS) {
    if (mutation.includes(t)) throw new Error(`Refusing mutation containing forbidden operation: ${t}`);
  }
}

async function mutate<T>(mutation: string, variables: Record<string, unknown>): Promise<T> {
  assertStrict(mutation);
  return shopifyGraphQL<T>(mutation, variables);
}

// Metafield types we know how to serialize. Anything else: skip + report.
function serializeForType(type: string, value: string): string | null {
  if (type === "single_line_text_field" || type === "multi_line_text_field") return value;
  if (type === "list.single_line_text_field") return JSON.stringify([value]);
  return null;
}

export interface ResolvedProduct {
  id: string; // GID
  numericId: string;
  title: string;
  handle: string;
  status: string;
  adminUrl: string;
  mediaCount: number;
  existingAlts: string[];
}

const PRODUCT_BY_ID = `
query P($id: ID!) {
  product(id: $id) { id title handle status media(first: 250) { nodes { alt } } }
}`;
const PRODUCT_BY_HANDLE = `
query P($handle: String!) {
  productByIdentifier(identifier: { handle: $handle }) { id title handle status media(first: 250) { nodes { alt } } }
}`;

export async function resolveProduct(ref: ProductRef): Promise<ResolvedProduct> {
  const { domain } = shopConfig();
  type Node = { id: string; title: string; handle: string; status: string; media: { nodes: Array<{ alt: string | null }> } } | null;
  let node: Node;
  if (ref.kind === "id") {
    const d = await shopifyGraphQL<{ product: Node }>(PRODUCT_BY_ID, { id: `gid://shopify/Product/${ref.value}` });
    node = d.product;
  } else {
    const d = await shopifyGraphQL<{ productByIdentifier: Node }>(PRODUCT_BY_HANDLE, { handle: ref.value });
    node = d.productByIdentifier;
  }
  if (!node) throw new Error("Product not found in the store.");
  const numericId = node.id.split("/").pop() ?? "";
  return {
    id: node.id,
    numericId,
    title: node.title,
    handle: node.handle,
    status: node.status,
    adminUrl: `https://${domain}/admin/products/${numericId}`,
    mediaCount: node.media.nodes.length,
    existingAlts: node.media.nodes.map((m) => m.alt ?? "").filter(Boolean),
  };
}

export interface FieldReportRow {
  label: string;
  status: "set" | "skipped-empty" | "no-definition" | "unsupported-type" | "error";
  value?: string;
  detail?: string;
}

export interface PushReport {
  product: ResolvedProduct;
  dryRun: boolean;
  fields: FieldReportRow[];
  orphans: Array<{ name: string; namespace: string; key: string }>;
  titleUpdate: { from: string; to: string; applied: boolean } | null;
  images: { toAdd: Array<{ url: string; alt: string }>; skipped: number; added: number };
}

const METAFIELDS_SET = `
mutation Set($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { key }
    userErrors { field message }
  }
}`;
const PRODUCT_UPDATE_TITLE = `
mutation Title($product: ProductUpdateInput!) {
  productUpdate(product: $product) {
    product { id title }
    userErrors { field message }
  }
}`;
const CREATE_MEDIA = `
mutation Media($productId: ID!, $media: [CreateMediaInput!]!) {
  productCreateMedia(productId: $productId, media: $media) {
    media { alt }
    mediaUserErrors { field message }
  }
}`;

export async function applyToProduct(params: {
  product: ResolvedProduct;
  json: Stage2Json;
  productName: string;
  images: Array<{ url: string; category: string }>;
  alreadyPushedUrls: string[];
  includeTitle: boolean;
  dryRun: boolean;
}): Promise<PushReport> {
  const { product, json, images, dryRun } = params;

  const defs = await fetchDefinitions();
  const matches = matchFields(defs);

  // Build the field plan.
  const rows: FieldReportRow[] = [];
  const toSet: Array<{ def: MetafieldDef; value: string; label: string }> = [];
  for (const f of SHOPIFY_FIELDS) {
    const value = f.get(json).trim();
    const match = matches.find((m) => m.label === f.label)?.def ?? null;
    if (!value) { rows.push({ label: f.label, status: "skipped-empty" }); continue; }
    if (!match) { rows.push({ label: f.label, status: "no-definition", value }); continue; }
    const serialized = serializeForType(match.type, value);
    if (serialized === null) { rows.push({ label: f.label, status: "unsupported-type", value, detail: match.type }); continue; }
    toSet.push({ def: match, value: serialized, label: f.label });
  }

  // Image plan: append-only, deduped against both our push-state and the
  // product's existing alts (survives a DB restore).
  const mkAlt = (category: string, i: number) => `${params.productName} — ${category || `image ${i + 1}`}`;
  const existingAlts = new Set(product.existingAlts);
  const pushed = new Set(params.alreadyPushedUrls);
  const toAdd: Array<{ url: string; alt: string }> = [];
  let skipped = 0;
  params.images.forEach((im, i) => {
    if (!im.url || !im.url.startsWith("http")) return;
    const alt = mkAlt(im.category, i);
    if (pushed.has(im.url) || existingAlts.has(alt)) { skipped++; return; }
    toAdd.push({ url: im.url, alt });
  });

  const titleUpdate = params.includeTitle && params.productName && params.productName !== product.title
    ? { from: product.title, to: params.productName, applied: false }
    : null;

  const report: PushReport = {
    product,
    dryRun,
    fields: rows,
    orphans: orphanDefinitions(defs).map((d) => ({ name: d.name, namespace: d.namespace, key: d.key })),
    titleUpdate,
    images: { toAdd, skipped, added: 0 },
  };

  // Mark planned sets in the report up-front; flip to error below if Shopify rejects.
  for (const t of toSet) rows.push({ label: t.label, status: "set", value: t.value });

  if (dryRun) return report;

  // 1) Metafields — chunk at 25 (API cap).
  for (let i = 0; i < toSet.length; i += 25) {
    const chunk = toSet.slice(i, i + 25);
    const data = await mutate<{ metafieldsSet: { userErrors: Array<{ field?: string[] | null; message: string }> } }>(
      METAFIELDS_SET,
      {
        metafields: chunk.map((t) => ({
          ownerId: product.id,
          namespace: t.def.namespace,
          key: t.def.key,
          type: t.def.type,
          value: t.value,
        })),
      },
    );
    const errs = data.metafieldsSet.userErrors ?? [];
    for (const e of errs) {
      // Attribute the error to the chunk's rows (Shopify reports by index path).
      const idx = Number(e.field?.[1]);
      const target = Number.isInteger(idx) && chunk[idx] ? chunk[idx].label : chunk[0].label;
      const row = rows.find((r) => r.label === target && r.status === "set");
      if (row) { row.status = "error"; row.detail = e.message; }
    }
  }

  // 2) Title (opt-in).
  if (titleUpdate) {
    const data = await mutate<{ productUpdate: { userErrors: Array<{ message: string }> } }>(
      PRODUCT_UPDATE_TITLE,
      { product: { id: product.id, title: params.productName } },
    );
    if (!data.productUpdate.userErrors?.length) titleUpdate.applied = true;
  }

  // 3) Images — append only.
  if (toAdd.length) {
    const data = await mutate<{ productCreateMedia: { media: Array<{ alt: string | null }> | null; mediaUserErrors: Array<{ message: string }> } }>(
      CREATE_MEDIA,
      { productId: product.id, media: toAdd.map((m) => ({ originalSource: m.url, mediaContentType: "IMAGE", alt: m.alt })) },
    );
    if (data.productCreateMedia.mediaUserErrors?.length) {
      throw new Error("Shopify rejected media: " + data.productCreateMedia.mediaUserErrors.map((e) => e.message).join("; "));
    }
    report.images.added = toAdd.length;
  }

  return report;
}
