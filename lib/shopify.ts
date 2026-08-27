// Shopify Admin API (GraphQL) client.
//
// Auth: a custom app's Admin API access token. Create the app in the store under
// Settings → Apps and sales channels → Develop apps, grant `write_products`, and
// set these in the environment (Render env vars / .env.local):
//
//   SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
//   SHOPIFY_ADMIN_TOKEN=shpat_...
//
// Products are created as DRAFT — nothing reaches the storefront until a human
// sets pricing and publishes in Shopify.

// Shopify supports an API version for ~12 months. Env-overridable so a bump is
// a Render env change, not a deploy.
const API_VERSION = process.env.SHOPIFY_API_VERSION?.trim() || "2026-01";

export function shopConfig(): { domain: string; token: string } {
  const domain = process.env.SHOPIFY_STORE_DOMAIN?.trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  const token = process.env.SHOPIFY_ADMIN_TOKEN?.trim();
  if (!domain) throw new Error("SHOPIFY_STORE_DOMAIN is not set (e.g. your-store.myshopify.com).");
  if (!token) throw new Error("SHOPIFY_ADMIN_TOKEN is not set (custom app Admin API access token).");
  return { domain, token };
}

/** Whether Shopify is configured — lets the UI hide/disable the push button. */
export function shopifyConfigured(): boolean {
  return Boolean(process.env.SHOPIFY_STORE_DOMAIN?.trim() && process.env.SHOPIFY_ADMIN_TOKEN?.trim());
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export async function shopifyGraphQL<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const { domain, token } = shopConfig();
  const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  if (!res.ok) {
    // 401/403 almost always means a bad token or a missing write_products scope.
    throw new Error(`Shopify API ${res.status}: ${text.slice(0, 300)}`);
  }
  let json: GraphQLResponse<T>;
  try {
    json = JSON.parse(text) as GraphQLResponse<T>;
  } catch {
    throw new Error(`Shopify returned non-JSON: ${text.slice(0, 200)}`);
  }
  if (json.errors?.length) {
    throw new Error(`Shopify GraphQL error: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  if (!json.data) throw new Error("Shopify returned no data.");
  return json.data;
}

const PRODUCT_CREATE = `
mutation CreateDraftProduct($input: ProductInput!, $media: [CreateMediaInput!]) {
  productCreate(input: $input, media: $media) {
    product { id handle title }
    userErrors { field message }
  }
}`;

export interface DraftProductResult {
  id: string;
  handle: string;
  adminUrl: string;
  imageCount: number;
}

/**
 * Create a DRAFT product with the copy and images. Images are handed to Shopify
 * as URLs (`originalSource`) — Shopify fetches them itself, so the Higgsfield
 * CDN links are used directly with no re-upload. Ingestion is async on their
 * side, so images can take a few seconds to appear on the product.
 */
export async function createDraftProduct(params: {
  title: string;
  descriptionHtml: string;
  imageUrls: string[];
  tags?: string[];
}): Promise<DraftProductResult> {
  const { domain } = shopConfig();
  const urls = params.imageUrls.filter((u) => typeof u === "string" && u.startsWith("http"));
  const media = urls.map((url, i) => ({
    originalSource: url,
    mediaContentType: "IMAGE",
    alt: `${params.title} — image ${i + 1}`,
  }));

  const data = await shopifyGraphQL<{
    productCreate: {
      product: { id: string; handle: string; title: string } | null;
      userErrors: Array<{ field?: string[] | null; message: string }>;
    };
  }>(PRODUCT_CREATE, {
    input: {
      title: params.title,
      descriptionHtml: params.descriptionHtml,
      status: "DRAFT",
      ...(params.tags?.length ? { tags: params.tags } : {}),
    },
    media,
  });

  const { product, userErrors } = data.productCreate;
  if (userErrors?.length) {
    throw new Error(
      "Shopify rejected the product: " +
        userErrors.map((e) => `${e.field?.join(".") ?? ""} ${e.message}`.trim()).join("; "),
    );
  }
  if (!product) throw new Error("Shopify returned no product.");

  const numericId = product.id.split("/").pop() ?? "";
  return {
    id: product.id,
    handle: product.handle,
    adminUrl: `https://${domain}/admin/products/${numericId}`,
    imageCount: urls.length,
  };
}
