// Metafield definition discovery: fetch the store's PRODUCT metafield
// definitions and match them BY VISIBLE NAME to the pipeline's field list.
// Exact normalized match only — a fuzzy match that writes the wrong metafield
// is worse than an unmatched-field report.

import { shopifyGraphQL, shopConfig } from "@/lib/shopify";
import { getKV, setKV } from "@/lib/db";
import { SHOPIFY_FIELDS, normalizeLabel } from "./fields";

export interface MetafieldDef {
  name: string;
  namespace: string;
  key: string;
  type: string;
}

const KV_KEY = "shopify:metafield_defs:v1";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const DEFS_QUERY = `
query Defs($after: String) {
  metafieldDefinitions(ownerType: PRODUCT, first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { name namespace key type { name } }
  }
}`;

export async function fetchDefinitions(forceRefresh = false): Promise<MetafieldDef[]> {
  const { domain } = shopConfig();
  if (!forceRefresh) {
    try {
      const raw = await getKV(KV_KEY);
      if (raw) {
        const cached = JSON.parse(raw) as { domain: string; fetchedAt: number; defs: MetafieldDef[] };
        // Domain check guards against an env change silently reusing another
        // store's schema.
        if (cached.domain === domain && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.defs;
      }
    } catch { /* refetch */ }
  }

  const defs: MetafieldDef[] = [];
  let after: string | null = null;
  for (let page = 0; page < 10; page++) {
    const data: {
      metafieldDefinitions: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{ name: string; namespace: string; key: string; type: { name: string } }>;
      };
    } = await shopifyGraphQL(DEFS_QUERY, { after });
    for (const n of data.metafieldDefinitions.nodes) {
      defs.push({ name: n.name, namespace: n.namespace, key: n.key, type: n.type.name });
    }
    if (!data.metafieldDefinitions.pageInfo.hasNextPage) break;
    after = data.metafieldDefinitions.pageInfo.endCursor;
  }

  await setKV(KV_KEY, JSON.stringify({ domain, fetchedAt: Date.now(), defs })).catch(() => {});
  return defs;
}

export interface FieldMatch {
  label: string;
  def: MetafieldDef | null;
}

/** Map each pipeline field to a store definition (or null when unmatched). */
export function matchFields(defs: MetafieldDef[]): FieldMatch[] {
  const byName = new Map(defs.map((d) => [normalizeLabel(d.name), d]));
  return SHOPIFY_FIELDS.map((f) => ({ label: f.label, def: byName.get(normalizeLabel(f.label)) ?? null }));
}

/** Store definitions no pipeline field maps to — how you notice a rename. */
export function orphanDefinitions(defs: MetafieldDef[]): MetafieldDef[] {
  const ours = new Set(SHOPIFY_FIELDS.map((f) => normalizeLabel(f.label)));
  return defs.filter((d) => !ours.has(normalizeLabel(d.name)));
}
