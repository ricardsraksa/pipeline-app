import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { getRun, updateRun } from "@/lib/db";
import { stage3ActiveSourceImages } from "@/lib/stage3/sources";
import { remainingPromptsJob } from "@/lib/stage3/jobs";
import { jobKey, startJob } from "@/lib/jobs";

// Skip the hero: write the 8 prompts straight from the source photos
// (server-side job), landing at the prompt-review gate.
export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { runId } = (await req.json()) as { runId?: number };
  if (!runId) return Response.json({ success: false, error: "runId required" }, { status: 400 });
  const run = await getRun(runId);
  if (!run) return Response.json({ success: false, error: "Run not found" }, { status: 404 });
  if (!stage3ActiveSourceImages(run).length) {
    return Response.json({ success: false, error: "No source product images to generate from" }, { status: 400 });
  }
  await updateRun(runId, { status: "generating_remaining", current_step: "Stage 4: Writing the 8 prompts from source images", error_message: null, last_updated_at: new Date().toISOString() });
  startJob(jobKey.remaining(runId), () => remainingPromptsJob(runId, true));
  return Response.json({ success: true, started: true });
}
