import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { getRun } from "@/lib/db";
import { shopifyConfigured } from "@/lib/shopify";
import { parseProductRef } from "@/lib/shopify/resolve";
import { resolveProduct } from "@/lib/shopify/push";
import { applyVariants, planVariants } from "@/lib/shopify/variants";
import { parseProductScrape } from "@/lib/product";
import type { ProductPricing } from "@/lib/pricing";

export const maxDuration = 120;

// Preview (dryRun, the default) or create the product's options + variants
// from the run's Variants card. Add-only, single-default-variant products
// only; one price for every variant, from the Pricing card.
export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  if (!shopifyConfigured()) {
    return Response.json({ success: false, error: "Shopify is not configured — set SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_TOKEN in Render." }, { status: 503 });
  }
  const body = (await req.json().catch(() => ({}))) as { runId?: unknown; productUrl?: unknown; dryRun?: unknown };
  const runId = body.runId;
  if (typeof runId !== "number" || !Number.isInteger(runId)) {
    return Response.json({ success: false, error: "runId (integer) required" }, { status: 400 });
  }
  const run = await getRun(runId);
  if (!run) return Response.json({ success: false, error: "Run not found" }, { status: 404 });

  // Options: the operator's restructure wins over what the listing said.
  let options: Record<string, string[]> = {};
  try {
    const edited = run.product_variants_edited ? JSON.parse(run.product_variants_edited) as { options?: Record<string, string[]> } : null;
    if (edited?.options) options = edited.options;
  } catch { /* fall through */ }
  if (!Object.keys(options).length) {
    options = parseProductScrape(run.product_scrape)?.pages.find((p) => p.role === "product")?.options ?? {};
  }

  let pricing: ProductPricing | null = null;
  try { pricing = run.product_pricing ? JSON.parse(run.product_pricing) as ProductPricing : null; } catch { pricing = null; }

  try {
    const target = typeof body.productUrl === "string" && body.productUrl.trim()
      ? body.productUrl.trim()
      : (() => {
          try { return (JSON.parse(run.shopify_push_state ?? "null") as { productId?: string } | null)?.productId ?? ""; } catch { return ""; }
        })() || run.shopify_product_url || "";
    if (!target) return Response.json({ success: false, error: "Paste the product URL first." }, { status: 400 });

    const ref = parseProductRef(target);
    const product = await resolveProduct(ref);

    const plan = await planVariants({
      productId: product.id,
      productTitle: product.title,
      adminUrl: product.adminUrl,
      options,
      price: pricing?.price ?? null,
      compareAt: pricing?.compare_at ?? null,
      currency: pricing?.cogs_currency ?? "USD",
    });

    if (body.dryRun === false) {
      const result = await applyVariants(plan);
      return Response.json({ success: true, plan, result });
    }
    return Response.json({ success: true, plan });
  } catch (err) {
    return Response.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
