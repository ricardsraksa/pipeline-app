import { NextRequest, NextResponse } from "next/server";
import { getRun, updateRun } from "@/lib/db";
import { resumePipeline } from "@/lib/pipeline-runner";

import { requireSession } from "@/lib/auth";
export const maxDuration = 10;

export async function POST(
  _req: NextRequest,
  context: { params: Promise<unknown> }
) {
  const denied = requireSession(_req);
  if (denied) return denied;
  const { id } = (await context.params) as { id: string };
  const runId = parseInt(id, 10);
  const run = await getRun(runId);

  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  // Clear error state before resuming
  await updateRun(runId, {
    error_message: null,
    last_updated_at: new Date().toISOString(),
  });

  // Fire-and-forget
  resumePipeline(runId).catch((err) => {
    console.error(`Resume ${runId} failed:`, err);
  });

  return NextResponse.json({ success: true });
}
