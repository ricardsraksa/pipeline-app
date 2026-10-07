// New products come from one template product in the store.
//
// The operator used to duplicate the previous product by hand, copy its link
// and paste it into the run — and the duplicate carried the old product's
// options (White / Pink / Green) and images, which the push can't remove. Now
// the push duplicates a clean template instead: a DRAFT under the run's name
// (Shopify derives the URL from it), no images, then fills it as before.
// Publishing stays the operator's.
import { getKV, setKV } from "@/lib/db";
import { shopifyGraphQL } from "@/lib/shopify";
import { parseProductRef } from "@/lib/shopify/resolve";
import { resolveProduct, type ResolvedProduct } from "@/lib/shopify/push";

const KEY = "shopify_template_url";

export async function getTemplateUrl(): Promise<string | null> {
  try { return (await getKV(KEY))?.trim() || null; } catch { return null; }
}

export interface TemplateInfo {
  url: string;
  title: string;
  handle: string;
  adminUrl: string;
  mediaCount: number;
  variantCount: number;
  options: string[];
  /** Things that would leak into every product made from it. */
  warnings: string[];
}

const TEMPLATE_STATE = `
query T($id: ID!) {
  product(id: $id) {
    variantsCount { count }
    options { name }
    variants(first: 2) { nodes { selectedOptions { value } } }
  }
}`;

export async function describeTemplate(url: string): Promise<TemplateInfo> {
  const product = await resolveProduct(parseProductRef(url));
  const d = await shopifyGraphQL<{ product: { variantsCount: { count: number } | null; options: Array<{ name: string }>; variants: { nodes: Array<{ selectedOptions: Array<{ value: string }> }> } } | null }>(
    TEMPLATE_STATE, { id: product.id });
  const variantCount = d.product?.variantsCount?.count ?? d.product?.variants.nodes.length ?? 0;
  const onlyDefault = variantCount <= 1 && (d.product?.variants.nodes ?? []).every((v) => v.selectedOptions.every((o) => o.value === "Default Title"));
  const options = onlyDefault ? [] : (d.product?.options ?? []).map((o) => o.name);
  const warnings: string[] = [];
  if (!onlyDefault) warnings.push(`It has ${variantCount} variants (${options.join(", ")}). New products would start with them and the run's own options couldn't be added — remove them from the template.`);
  if (product.mediaCount) warnings.push(`It has ${product.mediaCount} image${product.mediaCount === 1 ? "" : "s"}. They aren't copied, but a template without images is clearer.`);
  return { url, title: product.title, handle: product.handle, adminUrl: product.adminUrl, mediaCount: product.mediaCount, variantCount, options, warnings };
}

export async function setTemplateUrl(url: string | null): Promise<TemplateInfo | null> {
  if (!url?.trim()) { await setKV(KEY, ""); return null; }
  const info = await describeTemplate(url.trim());
  await setKV(KEY, url.trim());
  return info;
}

const DUPLICATE = `
mutation D($productId: ID!, $newTitle: String!) {
  productDuplicate(productId: $productId, newTitle: $newTitle, newStatus: DRAFT, includeImages: false) {
    newProduct { id handle }
    userErrors { field message }
  }
}`;

/** Duplicate the template as a DRAFT named after the run. */
export async function createFromTemplate(name: string): Promise<ResolvedProduct> {
  const url = await getTemplateUrl();
  if (!url) throw new Error("No template product set — add one in Settings → Shopify, or paste a product link.");
  const template = await resolveProduct(parseProductRef(url));
  const d = await shopifyGraphQL<{ productDuplicate: { newProduct: { id: string; handle: string } | null; userErrors: Array<{ message: string }> } }>(
    DUPLICATE, { productId: template.id, newTitle: name.trim().slice(0, 255) || "New product" });
  const errs = d.productDuplicate.userErrors ?? [];
  if (errs.length || !d.productDuplicate.newProduct) {
    throw new Error(`Shopify couldn't copy the template: ${errs.map((e) => e.message).join("; ") || "no product returned"}`);
  }
  const id = d.productDuplicate.newProduct.id.split("/").pop() ?? "";
  return resolveProduct({ kind: "id", value: id });
}

const DEFAULT_VARIANT = `
query V($id: ID!) { product(id: $id) { variants(first: 2) { nodes { id selectedOptions { value } } } } }`;
const UPDATE_PRICE = `
mutation U($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    userErrors { message }
  }
}`;

/** The single variant of a product the app has just created gets the run's
 *  price. Only ever called right after createFromTemplate. */
export async function priceNewProduct(productGid: string, price: number, compareAt: number | null): Promise<void> {
  const d = await shopifyGraphQL<{ product: { variants: { nodes: Array<{ id: string; selectedOptions: Array<{ value: string }> }> } } | null }>(DEFAULT_VARIANT, { id: productGid });
  const nodes = d.product?.variants.nodes ?? [];
  if (nodes.length !== 1) throw new Error(`expected one variant, found ${nodes.length}`);
  const r = await shopifyGraphQL<{ productVariantsBulkUpdate: { userErrors: Array<{ message: string }> } }>(UPDATE_PRICE, {
    productId: productGid,
    variants: [{ id: nodes[0].id, price: price.toFixed(2), ...(compareAt && compareAt > price ? { compareAtPrice: compareAt.toFixed(2) } : {}) }],
  });
  const errs = r.productVariantsBulkUpdate.userErrors ?? [];
  if (errs.length) throw new Error(errs.map((e) => e.message).join("; "));
}
