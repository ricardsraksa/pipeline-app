import { NextRequest, NextResponse } from "next/server";
import { getRun, updateRun } from "@/lib/db";
import { requireSession } from "@/lib/auth";

// Ask the Mac worker to re-read the supplier listing's options and per-SKU
// prices for this run. The worker sees the request in /api/worker/queue,
// scrapes the product URL at home and posts the result to scrape-push with
// mode=variants, which merges only options/variants/price into the stored
// scrape — nothing else on the run changes.
export async function POST(req: NextRequest, context: { params: Promise<unknown> }) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { id } = (await context.params) as { id: string };
  const runId = parseInt(id, 10);
  if (!Number.isFinite(runId)) return NextResponse.json({ success: false, error: "Invalid run id" }, { status: 400 });
  const run = await getRun(runId);
  if (!run) return NextResponse.json({ success: false, error: "Run not found" }, { status: 404 });
  if (!run.product_url) return NextResponse.json({ success: false, error: "This run has no product URL" }, { status: 400 });
  const at = new Date().toISOString();
  await updateRun(runId, { variants_refresh_requested: at, last_updated_at: at });
  return NextResponse.json({ success: true, requested_at: at });
}
