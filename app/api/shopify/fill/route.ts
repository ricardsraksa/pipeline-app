import { requireSession } from "@/lib/auth";
import { getRun, updateRun } from "@/lib/db";
import { shopifyConfigured } from "@/lib/shopify";
import { parseProductRef } from "@/lib/shopify/resolve";
import { resolveProduct, applyToProduct } from "@/lib/shopify/push";
import type { Stage2Json } from "@/lib/stage2/shape";

export const maxDuration = 120;

interface PushState {
  productId: string;
  adminUrl: string;
  pushedImageUrls: string[];
  lastPushAt: string;
  /** category → File GID for section photos (re-push reuse). */
  sectionFileIds?: Record<string, string>;
}

// Fill an EXISTING product with the run's copy + images. Strict/reversible:
// metafields + optional title + append-only images; dryRun computes the full
// report with zero writes and is the UI default.
export async function POST(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;
  if (!shopifyConfigured()) {
    return Response.json({ success: false, error: "Shopify is not configured — set SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_TOKEN in Render." }, { status: 503 });
  }

  const body = (await req.json()) as {
    runId?: unknown;
    productUrl?: unknown;
    includeTitle?: unknown;
    dryRun?: unknown;
  };
  const runId = body.runId;
  if (typeof runId !== "number" || !Number.isInteger(runId)) {
    return Response.json({ success: false, error: "runId (integer) required" }, { status: 400 });
  }
  const run = await getRun(runId);
  if (!run) return Response.json({ success: false, error: "Run not found" }, { status: 404 });

  let json: Stage2Json | null = null;
  try { json = run.stage2_json ? (JSON.parse(run.stage2_json) as Stage2Json) : null; } catch { /* below */ }
  if (!json) return Response.json({ success: false, error: "No structured Stage 2 copy on this run yet" }, { status: 400 });

  let pushState: PushState | null = null;
  try { pushState = run.shopify_push_state ? (JSON.parse(run.shopify_push_state) as PushState) : null; } catch { /* fresh */ }

  try {
    // Resolve the target: pasted URL wins; else the product this run last pushed to.
    let productId: string;
    if (typeof body.productUrl === "string" && body.productUrl.trim()) {
      const ref = parseProductRef(body.productUrl);
      productId = ref.kind === "id" ? ref.value : "";
      if (!productId) {
        const resolved = await resolveProduct(ref);
        productId = resolved.numericId;
      }
    } else if (pushState?.productId) {
      productId = pushState.productId;
    } else {
      return Response.json({ success: false, error: "Paste the product URL to fill." }, { status: 400 });
    }

    const product = await resolveProduct({ kind: "id", value: productId });

    // Image order: hero first, then the 8 by index (placement decides on-page
    // order inside the theme; media order here is hero-led).
    const images: Array<{ url: string; category: string }> = [];
    if (run.stage3_hero_image_url) images.push({ url: run.stage3_hero_image_url, category: "hero" });
    try {
      const rem = JSON.parse(run.stage3_remaining_images ?? "[]") as Array<{ image_url?: string; category?: string; index?: number; status?: string }>;
      rem
        .filter((im) => im?.image_url && im.status === "done")
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .forEach((im) => images.push({ url: im.image_url as string, category: im.category ?? "" }));
    } catch { /* no remaining images */ }

    // Placement → Section 2/3 Photo metafields. Section 1 Photo is left for
    // the operator's manual GIF, by explicit choice. Section images are kept
    // OUT of the gallery below — no image appears twice on the PDP.
    const sectionPhotos: Array<{ defName: string; category: string; url: string }> = [];
    try {
      const placement = JSON.parse(run.stage3_placement ?? "null") as { section_2?: number; section_3?: number } | null;
      const rem = JSON.parse(run.stage3_remaining_images ?? "[]") as Array<{ index?: number; category?: string; image_url?: string; status?: string }>;
      for (const n of [2, 3] as const) {
        const idx = placement?.[`section_${n}`];
        const im = rem.find((x) => x?.index === idx && x.image_url && x.status === "done");
        if (im?.category && im.image_url) sectionPhotos.push({ defName: `Section ${n} Photo`, category: im.category, url: im.image_url });
      }
    } catch { /* no placement — no section photos */ }
    const sectionUrls = new Set(sectionPhotos.map((sp) => sp.url));
    const galleryImages = images.filter((im) => !sectionUrls.has(im.url));

    const report = await applyToProduct({
      product,
      json,
      productName: (run.brand_name ?? json.product_name ?? "").trim(),
      images: galleryImages,
      sectionPhotos,
      sectionFileIds: pushState?.productId ? pushState.sectionFileIds : undefined,
      alreadyPushedUrls: pushState?.productId === product.numericId ? pushState.pushedImageUrls : [],
      includeTitle: body.includeTitle === true,
      dryRun: body.dryRun !== false, // dry run unless explicitly disabled
    });

    if (!report.dryRun) {
      const prevUrls = pushState?.productId === product.numericId ? pushState.pushedImageUrls : [];
      const newState: PushState = {
        productId: product.numericId,
        adminUrl: product.adminUrl,
        pushedImageUrls: [...new Set([...prevUrls, ...report.images.toAdd.map((m) => m.url)])],
        lastPushAt: new Date().toISOString(),
        sectionFileIds: report.sectionFiles ?? pushState?.sectionFileIds,
      };
      await updateRun(runId, { shopify_push_state: JSON.stringify(newState), last_updated_at: newState.lastPushAt }).catch(() => {});
    }

    return Response.json({ success: true, report });
  } catch (err) {
    return Response.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
