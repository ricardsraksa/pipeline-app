import { NextRequest, NextResponse } from "next/server";
import { getRun } from "@/lib/db";
import { runStage2Manually } from "@/lib/pipeline-runner";

import { requireSession } from "@/lib/auth";
import { parseSelectedAngles } from "@/lib/angles";
export const maxDuration = 10;

export async function POST(
  _req: NextRequest,
  context: { params: Promise<unknown> }
) {
  const denied = requireSession(_req);
  if (denied) return denied;
  const { id } = (await context.params) as { id: string };
  const runId = parseInt(id, 10);

  if (!Number.isFinite(runId)) {
    return NextResponse.json({ error: "Invalid run id" }, { status: 400 });
  }

  const run = await getRun(runId);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  if (run.status !== "awaiting_stage2_approval") {
    return NextResponse.json(
      { error: "Run is not waiting for Stage 3 approval" },
      { status: 400 }
    );
  }

  if (!run.stage1_one_pager) {
    return NextResponse.json(
      { error: "Stage 2 must be complete before running Stage 3" },
      { status: 400 }
    );
  }

  // The copy is built around the chosen angle — refuse to start without one.
  if (!parseSelectedAngles(run.product_angle_selected).length) {
    return NextResponse.json({ error: "Pick a positioning angle first" }, { status: 400 });
  }

  // Fire-and-forget. Polling on the client will pick up the status change.
  runStage2Manually(runId).catch((err) => {
    console.error(`Manual Stage 3 trigger for run ${runId} failed:`, err);
  });

  return NextResponse.json({ success: true });
}
