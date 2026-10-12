import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { getRun, updateRun } from "@/lib/db";
import { stage3ActiveSourceImages } from "@/lib/stage3/sources";
import { remainingPromptsJob } from "@/lib/stage3/jobs";
import { startJob } from "@/lib/jobs";

// Skip the hero: write the 8 prompts straight from the source photos
// (server-side job), landing at the prompt-review gate.
export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { runId, direction } = (await req.json()) as { runId?: number; direction?: unknown };
  if (!runId) return Response.json({ success: false, error: "runId required" }, { status: 400 });
  if (direction !== undefined && direction !== null && (typeof direction !== "string" || direction.length > 2000)) {
    return Response.json({ success: false, error: "direction must be text under 2,000 characters" }, { status: 400 });
  }
  // Saved before the job starts: the writer reads it from the run (and so does a resume).
  if (direction !== undefined) await updateRun(runId, { stage3_prompt_direction: typeof direction === "string" && direction.trim() ? direction.trim() : null });
  const run = await getRun(runId);
  if (!run) return Response.json({ success: false, error: "Run not found" }, { status: 404 });
  if (!stage3ActiveSourceImages(run).length) {
    return Response.json({ success: false, error: "No source product images to generate from" }, { status: 400 });
  }
  await updateRun(runId, { status: "generating_remaining", current_step: "Stage 4: Writing the 8 prompts from source images", error_message: null, last_updated_at: new Date().toISOString() });
  startJob("remaining", runId, (alive) => remainingPromptsJob(runId, true, alive));
  return Response.json({ success: true, started: true });
}
