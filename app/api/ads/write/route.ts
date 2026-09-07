import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { getRun, updateRun } from "@/lib/db";
import { generateAdPrompts } from "@/lib/ads/write";

export const maxDuration = 300;

// Stage 5 entry: write the five ad briefs for a completed run. Marks the run
// "writing" first so a reload shows progress, then "review" on success.
export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { runId } = (await req.json().catch(() => ({}))) as { runId?: unknown };
  if (typeof runId !== "number" || !Number.isInteger(runId)) {
    return Response.json({ success: false, error: "runId (integer) required" }, { status: 400 });
  }
  const run = await getRun(runId);
  if (!run) return Response.json({ success: false, error: "Run not found" }, { status: 404 });
  if (run.status !== "completed") {
    return Response.json({ success: false, error: "Finish Stage 4 first — the ads are built on the approved hero and the copy." }, { status: 409 });
  }
  await updateRun(runId, { ads_step: "writing", ads_error: null, last_updated_at: new Date().toISOString() });
  try {
    const prompts = await generateAdPrompts(runId);
    return Response.json({ success: true, prompts });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateRun(runId, { ads_step: null, ads_error: message, last_updated_at: new Date().toISOString() }).catch(() => {});
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
