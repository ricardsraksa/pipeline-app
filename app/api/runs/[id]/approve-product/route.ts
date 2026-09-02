import { NextRequest, NextResponse } from "next/server";
import { getRun, updateRun } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { assertPublicUrl } from "@/lib/ssrf";
import { continueAfterProductApproval } from "@/lib/pipeline-runner";
import { parseProductScrape, productCandidateImages, productPageOf } from "@/lib/product";

export const maxDuration = 10;

// The Stage 1 gate. The operator has read (and maybe edited) the analyst's
// description and ticked the photos the run may use. Both become the inputs
// every later stage reads: product_description → research, the selection →
// source images for research vision and the Stage 4 references.
export async function POST(req: NextRequest, context: { params: Promise<unknown> }) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { id } = (await context.params) as { id: string };
  const runId = parseInt(id, 10);
  if (!Number.isFinite(runId)) return NextResponse.json({ success: false, error: "Invalid run id" }, { status: 400 });

  const run = await getRun(runId);
  if (!run) return NextResponse.json({ success: false, error: "Run not found" }, { status: 404 });
  if (run.status !== "awaiting_product_approval") {
    return NextResponse.json({ success: false, error: "Run is not waiting at the product gate" }, { status: 400 });
  }

  let body: { description?: unknown; selectedImages?: unknown } = {};
  try { body = await req.json(); } catch { /* validated below */ }
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (description.length < 20) return NextResponse.json({ success: false, error: "Description needs at least 20 characters" }, { status: 400 });
  // The prompt caps the model at 200 words; this only stops a runaway paste
  // when the operator writes the description by hand.
  if (description.length > 20_000) return NextResponse.json({ success: false, error: "Description too long (max 20,000 characters)" }, { status: 400 });

  const selected = Array.isArray(body.selectedImages)
    ? body.selectedImages.filter((u): u is string => typeof u === "string" && u.startsWith("https://") && u.length <= 2048)
    : [];
  if (!selected.length) return NextResponse.json({ success: false, error: "Pick at least one photo" }, { status: 400 });
  if (selected.length > 10) return NextResponse.json({ success: false, error: "Max 10 photos" }, { status: 400 });

  // Only photos this run actually has (scraped or uploaded) can be selected —
  // the selection later drives server-side fetches, so no foreign URLs.
  const scrape = parseProductScrape(run.product_scrape);
  const uploaded = (() => { try { return JSON.parse(run.uploaded_source_images ?? "[]") as string[]; } catch { return []; } })();
  const allowed = new Set(productCandidateImages(scrape, uploaded).map((c) => c.url));
  for (const u of selected) {
    if (!allowed.has(u)) return NextResponse.json({ success: false, error: "A selected photo does not belong to this run" }, { status: 400 });
    try { await assertPublicUrl(u); } catch (e) {
      return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "Blocked URL" }, { status: 400 });
    }
  }

  const productPage = productPageOf(scrape);
  const competitorScraped = (scrape?.pages ?? [])
    .filter((p) => p.role === "competitor" && p.ok && p.scraped_text)
    .map((p) => ({ url: p.url, text: (p.scraped_text ?? "").slice(0, 20_000) }));

  const ts = new Date().toISOString();
  await updateRun(runId, {
    product_description: description,
    product_description_edited: description !== (run.product_description_ai ?? "").trim() ? description : null,
    product_selected_images: JSON.stringify(selected),
    // What research + Stage 4 read as "the source images".
    uploaded_source_images: JSON.stringify(selected),
    // Legacy scraper_data shape the research runner consumes. images stays
    // empty on purpose: the selection above is the only image list downstream.
    scraper_data: JSON.stringify({
      scraped_text: productPage?.ok ? (productPage.scraped_text ?? "") : "",
      images: [],
      competitor_scraped: competitorScraped,
    }),
    product_approved_at: ts,
    error_message: null,
    last_updated_at: ts,
  });

  // Fire-and-forget: research runs in the background; polling shows progress.
  continueAfterProductApproval(runId).catch((err) => {
    console.error(`approve-product → research for run ${runId} failed:`, err);
  });
  return NextResponse.json({ success: true });
}
