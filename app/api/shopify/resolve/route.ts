import { requireSession } from "@/lib/auth";
import { shopifyConfigured } from "@/lib/shopify";
import { parseProductRef } from "@/lib/shopify/resolve";
import { resolveProduct } from "@/lib/shopify/push";

// Read-only: confirm a pasted URL points at the product the operator thinks
// it does, before any write is offered.
export async function POST(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;
  if (!shopifyConfigured()) {
    return Response.json({ success: false, error: "Shopify is not configured — set SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_TOKEN in Render." }, { status: 503 });
  }
  try {
    const { url } = (await req.json()) as { url?: string };
    const ref = parseProductRef(String(url ?? ""));
    const product = await resolveProduct(ref);
    return Response.json({ success: true, product });
  } catch (err) {
    return Response.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
