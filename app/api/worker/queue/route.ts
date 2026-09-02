import { NextRequest } from "next/server";
import { db, setKV } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { parseProductScrape } from "@/lib/product";

// Polled by scripts/local-worker.py on the Mac. Lists every run parked at the
// Stage 1 gate with pages the server could not read (deferred — no scraper on
// this runtime — or failed), so the worker can scrape them at home and push
// them back through /api/runs/[id]/scrape-push. Each poll is also the
// worker's heartbeat.
export async function GET(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;

  try { await setKV("worker_last_seen", new Date().toISOString()); } catch { /* heartbeat is best-effort */ }

  const r = await db.execute(
    `SELECT id, product_url, competitor_urls, product_scrape FROM runs
     WHERE status = 'awaiting_product_approval' AND product_approved_at IS NULL
     ORDER BY id DESC LIMIT 20`,
  );
  const jobs: { runId: number; urls: { url: string; role: "product" | "competitor" }[] }[] = [];
  for (const row of r.rows as unknown as { id: number; product_url: string | null; competitor_urls: string | null; product_scrape: string | null }[]) {
    const scrape = parseProductScrape(row.product_scrape);
    if (!scrape) continue;
    const urls = scrape.pages
      .filter((p) => !p.ok)
      .map((p) => ({ url: p.url, role: p.role }));
    if (urls.length) jobs.push({ runId: Number(row.id), urls });
  }
  return Response.json({ jobs, now: new Date().toISOString() });
}
