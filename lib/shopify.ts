// Shopify Admin API (GraphQL) client.
//
// Auth, either of:
//   1. Dev Dashboard app (current Shopify flow — stores created/migrated after
//      Jan 2026 can no longer mint static admin tokens): the app exchanges
//      SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET for a 24h access token via
//      the client-credentials grant (per-shop /admin/oauth/access_token).
//      Scopes come from the app VERSION installed on the store — read_products
//      + write_products must be selected there.
//   2. Legacy static token: SHOPIFY_ADMIN_TOKEN=shpat_... (admin-created
//      custom apps from before the cutover). Takes precedence when set.
//
// Always: SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
//
// Products are created as DRAFT — nothing reaches the storefront until a human
// sets pricing and publishes in Shopify.

// Shopify supports an API version for ~12 months. Env-overridable so a bump is
// a Render env change, not a deploy.
const API_VERSION = process.env.SHOPIFY_API_VERSION?.trim() || "2026-01";

export function shopConfig(): { domain: string } {
  const domain = process.env.SHOPIFY_STORE_DOMAIN?.trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  if (!domain) throw new Error("SHOPIFY_STORE_DOMAIN is not set (e.g. your-store.myshopify.com).");
  return { domain };
}

/** Whether Shopify is configured — lets the UI hide/disable the push button. */
export function shopifyConfigured(): boolean {
  const domain = Boolean(process.env.SHOPIFY_STORE_DOMAIN?.trim());
  const staticToken = Boolean(process.env.SHOPIFY_ADMIN_TOKEN?.trim());
  const clientCreds = Boolean(process.env.SHOPIFY_CLIENT_ID?.trim() && process.env.SHOPIFY_CLIENT_SECRET?.trim());
  return domain && (staticToken || clientCreds);
}

// ── Access token (client-credentials grant, 24h lifetime) ────────────────────

let memToken: { token: string; exp: number } | null = null;
let inflight: Promise<string> | null = null;

async function exchangeClientCredentials(domain: string): Promise<string> {
  const clientId = process.env.SHOPIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Shopify auth is not set: provide SHOPIFY_ADMIN_TOKEN, or SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (Dev Dashboard app).");
  }
  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }).toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Shopify token exchange failed (${res.status}): ${text.slice(0, 200)} — check the client credentials, and that the app is INSTALLED on ${domain} (same Shopify organization).`);
  }
  let json: { access_token?: string; scope?: string; expires_in?: number };
  try { json = JSON.parse(text); } catch { throw new Error(`Shopify token exchange returned non-JSON: ${text.slice(0, 120)}`); }
  if (!json.access_token) throw new Error("Shopify token exchange returned no access_token.");
  if (json.scope && !/write_products/.test(json.scope)) {
    throw new Error(`Shopify app is missing write_products (granted: "${json.scope}"). Add the scope to the app version in the Dev Dashboard, release it, and approve on the store.`);
  }
  memToken = { token: json.access_token, exp: Date.now() + ((json.expires_in ?? 86000) - 300) * 1000 };
  return json.access_token;
}

async function accessToken(domain: string): Promise<string> {
  const staticToken = process.env.SHOPIFY_ADMIN_TOKEN?.trim();
  if (staticToken) return staticToken; // legacy custom app — takes precedence
  if (memToken && memToken.exp > Date.now()) return memToken.token;
  if (!inflight) {
    inflight = exchangeClientCredentials(domain).finally(() => { inflight = null; });
  }
  return inflight;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export async function shopifyGraphQL<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const { domain } = shopConfig();
  const token = await accessToken(domain);
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
