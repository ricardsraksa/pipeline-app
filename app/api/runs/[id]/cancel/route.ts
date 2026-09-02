import { NextRequest, NextResponse } from "next/server";
import { getRun, updateRun } from "@/lib/db";
import { requestCancel } from "@/lib/pipeline-runner";

import { requireSession } from "@/lib/auth";
export const maxDuration = 10;

// Kill a run. Flags the in-process pipeline so its next stage-boundary guard
// bails, and sets the status to 'cancelled' immediately so the UI updates even
// while a long call is still in flight. Cancelled runs can be restarted with
// Resume (granular resume picks up from the last completed sub-step).
export async function POST(
  _req: NextRequest,
  context: { params: Promise<unknown> }
) {
  const denied = requireSession(_req);
  if (denied) return denied;
  const { id } = (await context.params) as { id: string };
  const runId = parseInt(id, 10);
  if (!Number.isFinite(runId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const run = await getRun(runId);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  // Don't clobber a terminal state.
  if (["completed", "failed", "cancelled"].includes(run.status ?? "")) {
    return NextResponse.json({ success: true, alreadyTerminal: true });
  }

  requestCancel(runId);
  await updateRun(runId, {
    status: "cancelled",
    current_step: "Cancelled by user",
    error_message: null,
    last_updated_at: new Date().toISOString(),
  });

  return NextResponse.json({ success: true });
}
