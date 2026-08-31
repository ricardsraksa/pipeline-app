// Parse an operator-pasted product URL into a product reference, with a strict
// domain allowlist. THE ALLOWLIST ONLY GOVERNS WHICH URLS WE PARSE — every API
// call always targets SHOPIFY_STORE_DOMAIN from env, never the pasted host.
// That separation is what makes accepting storefront domains safe.

export interface ProductRef {
  kind: "id" | "handle";
  value: string;
}

function allowedHosts(): Set<string> {
  const store = process.env.SHOPIFY_STORE_DOMAIN?.trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  const extra = (process.env.SHOPIFY_ALLOWED_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase())
    .filter(Boolean);
  const set = new Set(extra);
  if (store) set.add(store);
  // admin.shopify.com hosts the new admin UI for every store.
  set.add("admin.shopify.com");
  // The store's public storefront domain — so pasted product links work as-is.
  set.add("saintport.com");
  return set;
}

/** Parse a pasted URL (admin or storefront) into a product id or handle. Throws with an operator-readable message. */
export function parseProductRef(raw: string): ProductRef {
  if (typeof raw !== "string" || raw.length > 2048) throw new Error("Invalid URL");
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new Error("Paste the full product URL (admin or storefront)."); }
  if (u.protocol !== "https:") throw new Error("Only https URLs are accepted.");
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  // Exact-match allowlist — no endsWith games.
  if (!allowedHosts().has(host)) {
    throw new Error(`Domain ${host} is not allowed. Set SHOPIFY_ALLOWED_DOMAINS if this is your storefront domain.`);
  }
  // Admin URL: .../products/123456 (optionally deeper)
  const adminMatch = u.pathname.match(/\/products\/(\d+)(?:\/|$)/);
  if (adminMatch) return { kind: "id", value: adminMatch[1] };
  // Storefront URL: /products/<handle>
  const handleMatch = u.pathname.match(/\/products\/([a-z0-9][a-z0-9-]*)\/?$/i);
  if (handleMatch) return { kind: "handle", value: handleMatch[1].toLowerCase() };
  throw new Error("Couldn't find a product id or handle in that URL — paste the product's admin or storefront URL.");
}
