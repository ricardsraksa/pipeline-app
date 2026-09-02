import { NextRequest, NextResponse } from "next/server";
import { getRun } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { describeProduct, parkAtProductGate } from "@/lib/pipeline-runner";

// The analyst call takes 10–40s; give the route room to await it.
export const maxDuration = 120;

// Rewrite the Stage 1 description from the stored scrape (the operator hit
// "Regenerate" at the gate). Any edit they had made is discarded — that's the
// point of the button.
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
  // A later page arriving (worker) must not clobber text the operator already
  // edited; the gate's own Regenerate button passes force=1.
  let force = false;
  try { force = Boolean(((await req.json()) as { force?: boolean }).force); } catch { /* empty body */ }
  if (run.product_description_edited && !force) {
    await parkAtProductGate(runId);
    return NextResponse.json({ success: true, description: run.product_description_edited, kept: true });
  }
  try {
    const text = await describeProduct(runId);
    await parkAtProductGate(runId);
    if (!text) return NextResponse.json({ success: false, error: "No readable page on this run yet — scrape it locally first." }, { status: 400 });
    return NextResponse.json({ success: true, description: text });
  } catch (err) {
    await parkAtProductGate(runId).catch(() => undefined);
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
