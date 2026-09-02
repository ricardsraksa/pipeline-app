import { NextRequest, NextResponse } from "next/server";
import { getRun, updateRun } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { uploadImageBuffer } from "@/lib/r2";
import { describeProduct, parkAtProductGate } from "@/lib/pipeline-runner";
import { parseProductScrape, type ProductScrape, type ProductScrapePage } from "@/lib/product";

export const maxDuration = 180;

const MAX_IMAGES = 10;
const MAX_DESC_IMAGES = 12;
const MAX_FILE = 8 * 1024 * 1024;

// Local-scrape fallback. The Mac script (scripts/supplier-scrape.py --push)
// posts its data.json plus the photos it downloaded; this stores them on the
// run exactly as a hosted scrape would have, then writes the description.
// Used when the hosted scraper is rate-limited by the supplier site (a
// datacenter IP problem a residential IP doesn't have).
export async function POST(req: NextRequest, context: { params: Promise<unknown> }) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { id } = (await context.params) as { id: string };
  const runId = parseInt(id, 10);
  if (!Number.isFinite(runId)) return NextResponse.json({ success: false, error: "Invalid run id" }, { status: 400 });

  const run = await getRun(runId);
  if (!run) return NextResponse.json({ success: false, error: "Run not found" }, { status: 404 });
  if (!["awaiting_product_approval", "product", "pending", "failed", "cancelled"].includes(run.status ?? "")) {
    return NextResponse.json({ success: false, error: `Run is past Stage 1 (status ${run.status}) — restart Stage 1 first` }, { status: 400 });
  }

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ success: false, error: "Invalid multipart payload" }, { status: 400 }); }
  const rawData = form.get("data");
  if (typeof rawData !== "string" || rawData.length > 500_000) {
    return NextResponse.json({ success: false, error: "data field missing or too large" }, { status: 400 });
  }
  let data: Record<string, unknown>;
  try { data = JSON.parse(rawData); } catch { return NextResponse.json({ success: false, error: "data is not JSON" }, { status: 400 }); }
  const url = typeof data.url === "string" ? data.url : "";
  if (!/^https?:\/\//.test(url)) return NextResponse.json({ success: false, error: "data.url missing" }, { status: 400 });

  const files = form.getAll("images").filter((f): f is File => f instanceof File).slice(0, MAX_IMAGES);
  const descFiles = form.getAll("description_images").filter((f): f is File => f instanceof File).slice(0, MAX_DESC_IMAGES);
  for (const f of [...files, ...descFiles]) {
    if (f.size > MAX_FILE) return NextResponse.json({ success: false, error: `${f.name} exceeds 8MB` }, { status: 400 });
  }

  const prefix = `scrape/local/${runId}`;
  const upload = async (list: File[], sub: string): Promise<string[]> => {
    const out: string[] = [];
    for (const f of list) {
      try {
        const { url: u } = await uploadImageBuffer(Buffer.from(await f.arrayBuffer()), { prefix: `${prefix}/${sub}`, name: f.name });
        out.push(u);
      } catch (err) {
        console.warn(`[scrape-push] skipped ${f.name}:`, err instanceof Error ? err.message : err);
      }
    }
    return out;
  };
  const image_urls = await upload(files, "img");
  const description_image_urls = await upload(descFiles, "desc");

  const str = (v: unknown, max = 20_000) => (typeof v === "string" ? v.slice(0, max) : undefined);
  const competitorUrls = (() => { try { return JSON.parse(run.competitor_urls ?? "[]") as string[]; } catch { return []; } })();
  const role: "product" | "competitor" = competitorUrls.includes(url) && url !== run.product_url ? "competitor" : "product";
  const page: ProductScrapePage = {
    url,
    role,
    ok: true,
    mode: str(data.mode, 40) ?? "local",
    title: str(data.title, 500),
    price: str(data.price, 100) ?? null,
    rating: str(data.rating, 20),
    reviews: str(data.reviews, 40),
    sold: str(data.sold, 40),
    store: str(data.store, 200),
    specs: str(data.specs, 4000),
    options: (data.options && typeof data.options === "object" && !Array.isArray(data.options)) ? data.options as Record<string, string[]> : {},
    variants: Array.isArray(data.variants) ? (data.variants as ProductScrapePage["variants"])!.slice(0, 100) : [],
    scraped_text: str(data.scraped_text),
    long_description: str(data.long_description),
    image_text: str(data.image_text, 10_000),
    positioning: (data.positioning && typeof data.positioning === "object" && !Array.isArray(data.positioning)) ? data.positioning as Record<string, string | string[]> : {},
    image_urls,
    description_image_urls,
  };

  const existing = parseProductScrape(run.product_scrape);
  const pages = (existing?.pages ?? []).filter((p) => p.url !== url && !(role === "product" && p.role === "product"));
  pages.unshift(page);
  const scrape: ProductScrape = { pages, scraped_at: new Date().toISOString(), source: "local" };
  await updateRun(runId, {
    product_scrape: JSON.stringify(scrape),
    ...(role === "product" ? { scraped_image_urls: JSON.stringify(image_urls) } : {}),
    status: "awaiting_product_approval",
    error_message: null,
    last_updated_at: new Date().toISOString(),
  });

  // The worker pushes competitor pages first and the product page last, with
  // describe=0 on all but the final push, so the analyst runs once per run.
  const describe = form.get("describe") !== "0";
  if (describe) {
    try {
      await describeProduct(runId);
    } catch (err) {
      console.error(`[scrape-push] describe failed for run ${runId}:`, err);
    }
  }
  await parkAtProductGate(runId);
  return NextResponse.json({ success: true, images: image_urls.length, description_images: description_image_urls.length });
}
