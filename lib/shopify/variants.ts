// Set a product's options and variants from the run's Variants card.
//
// Strict, like the rest of the Shopify integration: it only ever ADDS options
// and variants, and only to a product that still has the single default
// variant. It never updates or deletes an existing variant, never touches
// inventory, and never changes the price of a variant it did not create — the
// operator's rule is one price for the whole product, taken from the Pricing
// card and written once, at creation.

import { shopifyGraphQL } from "@/lib/shopify";

export interface VariantPlan {
  productId: string;
  productTitle: string;
  adminUrl: string;
  options: Array<{ name: string; values: string[] }>;
  /** Every combination, in option order, e.g. ["Silvery", "10CM"]. */
  combinations: string[][];
  price: number | null;
  compareAt: number | null;
  currency: string;
  /** Set when the product cannot take these options — nothing will be written. */
  blocked: string | null;
  existingVariantCount: number;
  existingOptions: string[];
}

export interface VariantResult {
  created: number;
  optionsCreated: string[];
  errors: string[];
}

const MAX_VARIANTS = 100;

const PRODUCT_VARIANT_STATE = `
query P($id: ID!) {
  product(id: $id) {
    id
    title
    options { name optionValues { name } }
    variantsCount { count }
    variants(first: 2) { nodes { id title selectedOptions { name value } } }
  }
}`;

const OPTIONS_CREATE = `
mutation OptionsCreate($productId: ID!, $options: [OptionCreateInput!]!) {
  productOptionsCreate(productId: $productId, options: $options, variantStrategy: LEAVE_AS_IS) {
    product { id options { name } }
    userErrors { field message }
  }
}`;

const VARIANTS_CREATE = `
mutation VariantsCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: REMOVE_STANDALONE_VARIANT) {
    productVariants { id title }
    userErrors { field message }
  }
}`;

/** Cartesian product of the option values, capped. */
export function combine(options: Array<{ name: string; values: string[] }>): string[][] {
  let out: string[][] = [[]];
  for (const o of options) {
    const next: string[][] = [];
    for (const row of out) for (const v of o.values) next.push([...row, v]);
    out = next;
    if (out.length > MAX_VARIANTS) return out.slice(0, MAX_VARIANTS);
  }
  return out;
}

export async function planVariants(params: {
  productId: string;
  productTitle: string;
  adminUrl: string;
  options: Record<string, string[]>;
  price: number | null;
  compareAt: number | null;
  currency: string;
}): Promise<VariantPlan> {
  const options = Object.entries(params.options)
    .map(([name, values]) => ({ name: name.trim(), values: [...new Set(values.map((v) => v.trim()).filter(Boolean))] }))
    .filter((o) => o.name && o.values.length);

  const d = await shopifyGraphQL<{
    product: {
      title: string;
      options: Array<{ name: string; optionValues: Array<{ name: string }> }>;
      variantsCount: { count: number } | null;
      variants: { nodes: Array<{ id: string; title: string; selectedOptions: Array<{ name: string; value: string }> }> };
    } | null;
  }>(PRODUCT_VARIANT_STATE, { id: params.productId });
  if (!d.product) throw new Error("Product not found in the store.");

  const existingVariantCount = d.product.variantsCount?.count ?? d.product.variants.nodes.length;
  const existingOptions = d.product.options.map((o) => o.name);
  const onlyDefault =
    existingVariantCount <= 1 &&
    d.product.variants.nodes.every((v) => v.selectedOptions.every((o) => o.value === "Default Title"));

  const combinations = combine(options);
  let blocked: string | null = null;
  if (!options.length) blocked = "This run has no option groups yet — read them from the listing first.";
  else if (!onlyDefault) blocked = `“${d.product.title}” already has ${existingVariantCount} variants (${existingOptions.join(", ") || "custom options"}). Variants are only created on a product that still has the single default variant — set these by hand instead.`;
  else if (combinations.length > MAX_VARIANTS) blocked = `${combinations.length} combinations exceeds the ${MAX_VARIANTS} this writes at once — trim the option values first.`;
  else if (params.price == null) blocked = "No price on this run yet — set one in the Pricing card first.";

  return {
    productId: params.productId,
    productTitle: params.productTitle,
    adminUrl: params.adminUrl,
    options,
    combinations,
    price: params.price,
    compareAt: params.compareAt,
    currency: params.currency,
    blocked,
    existingVariantCount,
    existingOptions,
  };
}

export async function applyVariants(plan: VariantPlan): Promise<VariantResult> {
  if (plan.blocked) throw new Error(plan.blocked);
  const errors: string[] = [];

  const optionsInput = plan.options.map((o, i) => ({
    name: o.name,
    position: i + 1,
    values: o.values.map((v) => ({ name: v })),
  }));
  const created = await shopifyGraphQL<{ productOptionsCreate: { product: { options: Array<{ name: string }> } | null; userErrors: Array<{ message: string }> } }>(
    OPTIONS_CREATE, { productId: plan.productId, options: optionsInput },
  );
  const optErrs = created.productOptionsCreate.userErrors ?? [];
  if (optErrs.length) throw new Error(`Shopify refused the options: ${optErrs.map((e) => e.message).join("; ")}`);

  // One price for the whole product, written once at creation.
  const price = plan.price != null ? plan.price.toFixed(2) : undefined;
  const compareAtPrice = plan.compareAt != null ? plan.compareAt.toFixed(2) : undefined;
  const variants = plan.combinations.map((combo) => ({
    optionValues: combo.map((value, i) => ({ optionName: plan.options[i].name, name: value })),
    ...(price ? { price } : {}),
    ...(compareAtPrice ? { compareAtPrice } : {}),
  }));

  const res = await shopifyGraphQL<{ productVariantsBulkCreate: { productVariants: Array<{ id: string }> | null; userErrors: Array<{ message: string }> } }>(
    VARIANTS_CREATE, { productId: plan.productId, variants },
  );
  const varErrs = res.productVariantsBulkCreate.userErrors ?? [];
  if (varErrs.length) errors.push(...varErrs.map((e) => e.message));

  return {
    created: res.productVariantsBulkCreate.productVariants?.length ?? 0,
    optionsCreated: created.productOptionsCreate.product?.options.map((o) => o.name) ?? plan.options.map((o) => o.name),
    errors,
  };
}
