import { NextRequest, NextResponse } from "next/server";
import { getRun, updateRun } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { generateAngles } from "@/lib/angles-generate";

// The strategist call takes 20–60s; the route awaits it.
export const maxDuration = 180;

// (Re)generate the positioning angles for a run parked at the research gate.
// Body: { note?: string } — an operator steer ("more medical", "focus on the
// night-time problem"). Clears the previous pick.
export async function POST(req: NextRequest, context: { params: Promise<unknown> }) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { id } = (await context.params) as { id: string };
  const runId = parseInt(id, 10);
  if (!Number.isFinite(runId)) return NextResponse.json({ success: false, error: "Invalid run id" }, { status: 400 });

  const run = await getRun(runId);
  if (!run) return NextResponse.json({ success: false, error: "Run not found" }, { status: 404 });
  if (!run.stage1_one_pager && !run.step_research) {
    return NextResponse.json({ success: false, error: "Research hasn't finished on this run yet" }, { status: 400 });
  }
  let note = "";
  try { note = String(((await req.json()) as { note?: unknown }).note ?? "").slice(0, 2000); } catch { /* no body */ }
  try {
    const angles = await generateAngles(runId, note);
    // A run that failed at the angles step is whole again once angles exist:
    // park it at the research gate instead of leaving it "failed".
    if (run.status === "failed" || run.status === "cancelled") {
      await updateRun(runId, {
        status: "awaiting_stage2_approval",
        current_step: "Stage 2 complete — review the research and pick an angle",
        error_message: null,
        last_updated_at: new Date().toISOString(),
      });
    }
    return NextResponse.json({ success: true, angles });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
