import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { getRun, updateRun } from "@/lib/db";
import { heroRegenJob } from "@/lib/stage3/jobs";
import { invalidateRun, startJob } from "@/lib/jobs";

// Regenerate the hero at the QC gate, optionally from an edited prompt. Runs
// as a server-side job; the page polls while the status is generating_hero.
export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { runId, editedPrompt } = (await req.json()) as { runId?: number; editedPrompt?: string };
  if (!runId) return Response.json({ success: false, error: "runId required" }, { status: 400 });
  const run = await getRun(runId);
  if (!run) return Response.json({ success: false, error: "Run not found" }, { status: 404 });
  if (!run.stage3_hero_prompt) return Response.json({ success: false, error: "No hero prompt to regenerate" }, { status: 400 });
  await updateRun(runId, { status: "generating_hero", current_step: "Stage 4: Regenerating hero shot", error_message: null, last_updated_at: new Date().toISOString() });
  // A new hero invalidates everything derived from the old one, including
  // any job still rendering against it.
  invalidateRun(runId);
  startJob("hero", runId, (alive) => heroRegenJob(runId, typeof editedPrompt === "string" ? editedPrompt : undefined, alive));
  return Response.json({ success: true, started: true });
}
