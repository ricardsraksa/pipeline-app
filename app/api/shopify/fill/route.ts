import { requireSession } from "@/lib/auth";
import { nameFromCopy } from "@/lib/stage2/name";
import { getRun, updateRun } from "@/lib/db";
import { shopifyConfigured } from "@/lib/shopify";
import { parseProductRef } from "@/lib/shopify/resolve";
import { resolveProduct, applyToProduct } from "@/lib/shopify/push";
import type { Stage2Json } from "@/lib/stage2/shape";
import { structureStage2Copy } from "@/lib/stage2/format";
import { createFromTemplate, getTemplateUrl, priceNewProduct } from "@/lib/shopify/template";
import { pickCategory, applyCategory } from "@/lib/shopify/category";
import { planVariants, applyVariants } from "@/lib/shopify/variants";
import { parseProductScrape } from "@/lib/product";
import type { ProductPricing } from "@/lib/pricing";

// One product per run: a second press while the first is still creating must
// not make a second copy of the template.
const CREATING = new Set<number>();

export const maxDuration = 120;

interface PushState {
  productId: string;
  adminUrl: string;
  pushedImageUrls: string[];
  lastPushAt: string;
  /** image URL → File GID for section photos (re-push reuse). Older states
   *  were keyed by category; those entries are ignored so a regenerated image
   *  is uploaded fresh instead of re-pointing at the old file. */
  sectionFileIds?: Record<string, string>;
}

// Fill an EXISTING product with the run's copy + images. Strict/reversible:
// metafields + optional title + append-only images; dryRun computes the full
// report with zero writes and is the UI default.
export async function POST(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;
  if (!shopifyConfigured()) {
    return Response.json({ success: false, error: "Shopify is not configured — set SHOPIFY_STORE_DOMAIN plus either SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET, or SHOPIFY_ADMIN_TOKEN, in Render." }, { status: 503 });
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

  // The fields come from stage2_json, which is derived from the copy text. An
  // edit to the text re-derives it, but that step is best-effort — so if the
  // text is newer than the structure (or the structure is missing), derive it
  // again here. A push must always reflect the copy the operator can see.
  const text = (run.stage2_copy_edited ?? run.stage2_output ?? "").trim();
  const textNewer = Boolean(run.stage2_edited_at && (!run.stage2_json_at || run.stage2_json_at < run.stage2_edited_at));
  let restructured = false;
  let restructureWarning: string | null = null;
  if (text && (!json || textNewer)) {
    try {
      const fresh = await structureStage2Copy(text, runId);
      if (fresh) {
        json = fresh;
        restructured = true;
        const at = new Date().toISOString();
        await updateRun(runId, { stage2_json: JSON.stringify(fresh), stage2_json_at: at, last_updated_at: at, ...nameFromCopy(run.stage2_json, fresh) }).catch(() => {});
      } else if (json) {
        restructureWarning = "Couldn't re-derive the fields from your edited copy — pushed the previous structure.";
      }
    } catch (err) {
      if (json) restructureWarning = `Couldn't re-derive the fields from your edited copy (${err instanceof Error ? err.message : String(err)}) — pushed the previous structure.`;
    }
  }
  if (!json) return Response.json({ success: false, error: "No structured Stage 3 copy on this run yet" }, { status: 400 });

  // Hard prerequisite: image auto-placement must have run. Without it the
  // section photos can't be wired and every image would land in the gallery —
  // the operator wants the full, correctly-split PDP or nothing.
  let pl: { section_2?: unknown; section_3?: unknown; placed_urls?: Record<string, string> } | null = null;
  try { pl = JSON.parse(run.stage3_placement ?? "null"); } catch { pl = null; }
  if (!pl || typeof pl.section_2 !== "number" || typeof pl.section_3 !== "number") {
    return Response.json(
      { success: false, error: "Image auto-placement hasn't run for this run. Open Stage 4 and run “auto-placement” (it decides which images go to sections 2/3), then push again." },
      { status: 409 },
    );
  }
  // Both placed indices must resolve to finished images that are still the
  // ones that were placed — otherwise the fill would silently push no section
  // photo (or the wrong one) and drop everything into the gallery.
  {
    let remAll: Array<{ index?: number; image_url?: string; status?: string }> = [];
    try { remAll = JSON.parse(run.stage3_remaining_images ?? "[]"); } catch { remAll = []; }
    const problems: string[] = [];
    for (const n of [2, 3] as const) {
      const idx = pl[`section_${n}`];
      const im = remAll.find((x) => x?.index === idx && x.image_url && x.status === "done");
      if (!im) problems.push(`Section ${n} image is failed or missing`);
      else if (pl.placed_urls?.[String(n)] && pl.placed_urls[String(n)] !== im.image_url) problems.push(`Section ${n} image changed since it was placed`);
    }
    if (pl.section_2 === pl.section_3) problems.push("Sections 2 and 3 point at the same image");
    if (problems.length) {
      return Response.json(
        { success: false, error: `${problems.join("; ")} — open Stage 4 and Keep / Re-place (or pick another image for that section), then push again.` },
        { status: 409 },
      );
    }
  }

  let pushState: PushState | null = null;
  try { pushState = run.shopify_push_state ? (JSON.parse(run.shopify_push_state) as PushState) : null; } catch { /* fresh */ }

  try {
    // Resolve the target: pasted URL wins; else the product this run last
    // pushed to; else the link saved on the run; else a new draft copied from
    // the template product.
    let productId: string;
    let created = false;
    const pasted = typeof body.productUrl === "string" && body.productUrl.trim() ? body.productUrl.trim() : run.shopify_product_url?.trim() || "";
    if (typeof body.productUrl === "string" && body.productUrl.trim()) {
      const ref = parseProductRef(body.productUrl);
      productId = ref.kind === "id" ? ref.value : "";
      if (!productId) {
        const resolved = await resolveProduct(ref);
        productId = resolved.numericId;
      }
    } else if (pushState?.productId) {
      productId = pushState.productId;
    } else if (pasted) {
      const ref = parseProductRef(pasted);
      productId = ref.kind === "id" ? ref.value : (await resolveProduct(ref)).numericId;
    } else if (await getTemplateUrl()) {
      if (body.dryRun === true) return Response.json({ success: false, error: "A push creates the product from your template — there's nothing to preview yet." }, { status: 400 });
      if (CREATING.has(runId)) return Response.json({ success: false, error: "This run's product is being created — wait a moment." }, { status: 409 });
      CREATING.add(runId);
      try {
        const fresh = await createFromTemplate((run.brand_name ?? json.product_name ?? "").trim());
        productId = fresh.numericId;
        created = true;
        // Saved before anything else can fail, so a retry fills this product
        // instead of copying the template again.
        const at = new Date().toISOString();
        pushState = { productId: fresh.numericId, adminUrl: fresh.adminUrl, pushedImageUrls: [], lastPushAt: at };
        await updateRun(runId, { shopify_product_url: fresh.adminUrl, shopify_push_state: JSON.stringify(pushState), last_updated_at: at });
      } finally {
        CREATING.delete(runId);
      }
    } else {
      return Response.json({ success: false, error: "Paste a Shopify product link, or set a template product in Settings → Shopify so the push can create one." }, { status: 400 });
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
      // Title is set on every push unless the caller opts out; writes happen
      // unless the caller explicitly asks for a dry run.
      includeTitle: body.includeTitle !== false,
      dryRun: body.dryRun === true,
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

    // A product this push created gets its variants and price too: the
    // template has a single default variant, so options can be added and the
    // price set without touching anything that existed before this push.
    const setup: { variants?: string; price?: string; category?: string; problem?: string } = {};
    const problems: string[] = [];
    // Category and product type: set on a product this push created (a copy
    // of the template would keep the template's); a dry run shows the pick.
    if (created || report.dryRun) {
      try {
        const pick = await pickCategory(run);
        if (pick) {
          if (created) await applyCategory(product.id, pick);
          setup.category = `${pick.fullName}${pick.productType ? ` · ${pick.productType}` : ""}`;
        } else problems.push("No matching Shopify category");
      } catch (e) {
        problems.push(`Category: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (created && !report.dryRun) {
      let pricing: ProductPricing | null = null;
      try { pricing = run.product_pricing ? JSON.parse(run.product_pricing) as ProductPricing : null; } catch { pricing = null; }
      let options: Record<string, string[]> = {};
      try {
        const edited = run.product_variants_edited ? JSON.parse(run.product_variants_edited) as { options?: Record<string, string[]> } : null;
        if (edited?.options) options = edited.options;
      } catch { /* fall through */ }
      if (!Object.keys(options).length) options = productPageOptions(run.product_scrape);
      try {
        if (Object.keys(options).length) {
          const plan = await planVariants({ productId: product.id, productTitle: product.title, adminUrl: product.adminUrl, options, price: pricing?.price ?? null, compareAt: pricing?.compare_at ?? null, currency: pricing?.cogs_currency ?? "USD" });
          if (plan.blocked) problems.push(plan.blocked);
          else {
            const r = await applyVariants(plan);
            setup.variants = `${r.created} variants (${r.optionsCreated.join(", ")})`;
            if (r.errors.length) problems.push(r.errors.join("; "));
            if (pricing?.price) setup.price = pricing.price.toFixed(2);
          }
        } else if (pricing?.price) {
          await priceNewProduct(product.id, pricing.price, pricing.compare_at ?? null);
          setup.price = pricing.price.toFixed(2);
        } else {
          problems.push("No price on this run yet");
        }
      } catch (e) {
        problems.push(e instanceof Error ? e.message : String(e));
      }
    }
    if (problems.length) setup.problem = problems.join(" · ");

    return Response.json({ success: true, report, restructured, warning: restructureWarning, created: created ? { adminUrl: product.adminUrl, handle: product.handle } : null, setup });
  } catch (err) {
    return Response.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}

function productPageOptions(raw: string | null): Record<string, string[]> {
  return parseProductScrape(raw)?.pages.find((p) => p.role === "product")?.options ?? {};
}
