import { NextRequest, NextResponse } from "next/server";
import { getRun, updateRun } from "@/lib/db";
import { requireSession } from "@/lib/auth";

// "Try again" on the Stage 1 gate: the Mac worker gives up on a page after its
// back-off schedule runs out. This stamps a request the worker sees in
// /api/worker/queue; it resets its attempt count for the run and retries on
// the next poll.
export async function POST(req: NextRequest, context: { params: Promise<unknown> }) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { id } = (await context.params) as { id: string };
  const runId = parseInt(id, 10);
  if (!Number.isFinite(runId)) return NextResponse.json({ success: false, error: "Invalid run id" }, { status: 400 });
  const run = await getRun(runId);
  if (!run) return NextResponse.json({ success: false, error: "Run not found" }, { status: 404 });
  if (run.status !== "awaiting_product_approval") {
    return NextResponse.json({ success: false, error: "The run is past the product gate" }, { status: 409 });
  }
  const at = new Date().toISOString();
  await updateRun(runId, { scrape_retry_requested: at, last_updated_at: at });
  return NextResponse.json({ success: true, requested_at: at });
}
