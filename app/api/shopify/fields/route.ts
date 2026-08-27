import { requireSession } from "@/lib/auth";
import { shopifyConfigured } from "@/lib/shopify";
import { fetchDefinitions, matchFields, orphanDefinitions } from "@/lib/shopify/metafields";

// Metafield-definition discovery report: which pipeline fields matched which
// store definitions. ?refresh=1 busts the 24h cache.
export async function GET(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;
  if (!shopifyConfigured()) {
    return Response.json({ success: false, error: "Shopify is not configured — set SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_TOKEN in Render." }, { status: 503 });
  }
  try {
    const refresh = new URL(req.url).searchParams.get("refresh") === "1";
    const defs = await fetchDefinitions(refresh);
    return Response.json({
      success: true,
      matches: matchFields(defs),
      orphans: orphanDefinitions(defs),
    });
  } catch (err) {
    return Response.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
