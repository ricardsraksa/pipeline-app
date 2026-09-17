import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { getRun, updateRun } from "@/lib/db";
import { stage3ActiveSourceImages } from "@/lib/stage3/sources";
import { heroJob } from "@/lib/stage3/jobs";
import { startJob } from "@/lib/jobs";

// Phase 1 of hero-first Stage 4: write ONE hero prompt from the source photos
// and generate the hero, then stop at the hero QC gate. The work runs as a
// server-side job; this returns as soon as it has started and the page polls.
export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { runId } = (await req.json()) as { runId?: number };
  if (!runId) return Response.json({ success: false, error: "runId required" }, { status: 400 });
  const run = await getRun(runId);
  if (!run) return Response.json({ success: false, error: "Run not found" }, { status: 404 });
  if (!stage3ActiveSourceImages(run).length) {
    return Response.json({ success: false, error: "No source product images to build a hero from" }, { status: 400 });
  }
  await updateRun(runId, { status: "generating_hero", current_step: "Stage 4: Generating hero shot", error_message: null, last_updated_at: new Date().toISOString() });
  startJob("hero", runId, (alive) => heroJob(runId, alive));
  return Response.json({ success: true, started: true });
}
