import { NextRequest } from "next/server";
import { db, getKV, setKV } from "@/lib/db";
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
    `SELECT id, product_url, competitor_urls, product_scrape, scrape_retry_requested FROM runs
     WHERE status = 'awaiting_product_approval' AND product_approved_at IS NULL
     ORDER BY id DESC LIMIT 20`,
  );
  const jobs: { runId: number; urls: { url: string; role: "product" | "competitor" }[]; mode?: "variants"; retryAt?: string | null }[] = [];
  for (const row of r.rows as unknown as { id: number; product_url: string | null; competitor_urls: string | null; product_scrape: string | null; scrape_retry_requested: string | null }[]) {
    const scrape = parseProductScrape(row.product_scrape);
    if (!scrape) continue;
    const urls = scrape.pages
      .filter((p) => !p.ok)
      .map((p) => ({ url: p.url, role: p.role }));
    // retryAt: the operator pressed "Try again" — the worker resets its
    // attempt count for this run when this is newer than its last failure.
    if (urls.length) jobs.push({ runId: Number(row.id), urls, retryAt: row.scrape_retry_requested ?? null });
  }
  // Variant re-reads requested from the Variants card (any status): the
  // worker scrapes the product page and pushes with mode=variants.
  const v = await db.execute(
    `SELECT id, product_url FROM runs
     WHERE variants_refresh_requested IS NOT NULL AND product_url IS NOT NULL
     ORDER BY id DESC LIMIT 20`,
  );
  for (const row of v.rows as unknown as { id: number; product_url: string }[]) {
    jobs.push({ runId: Number(row.id), urls: [{ url: row.product_url, role: "product" }], mode: "variants" });
  }
  return Response.json({ jobs, now: new Date().toISOString() });
}

export interface WorkerFailure { url: string; error: string; attempts: number; retryAt: string | null; at: string }

// The worker reports each failed page (and clears it once the page lands), so
// the Stage 1 banner can say what actually went wrong. Stored per run in
// app_kv as { [url]: WorkerFailure }.
export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const b = (await req.json().catch(() => ({}))) as { runId?: unknown; url?: unknown; error?: unknown; attempts?: unknown; retryInSec?: unknown };
  const runId = Number(b.runId);
  const url = typeof b.url === "string" ? b.url.slice(0, 2000) : "";
  if (!Number.isInteger(runId) || runId <= 0 || !url) return Response.json({ success: false, error: "runId and url are required" }, { status: 400 });
  const key = `worker_fail_${runId}`;
  let map: Record<string, WorkerFailure> = {};
  try { map = JSON.parse((await getKV(key)) ?? "{}") ?? {}; } catch { map = {}; }
  if (typeof b.error === "string" && b.error.trim()) {
    const now = Date.now();
    const retry = Number(b.retryInSec);
    map[url] = {
      url,
      error: b.error.trim().slice(0, 300),
      attempts: Number.isInteger(Number(b.attempts)) ? Number(b.attempts) : 1,
      retryAt: Number.isFinite(retry) && retry > 0 ? new Date(now + retry * 1000).toISOString() : null,
      at: new Date(now).toISOString(),
    };
  } else {
    delete map[url];
  }
  await setKV(key, JSON.stringify(map));
  return Response.json({ success: true });
}
