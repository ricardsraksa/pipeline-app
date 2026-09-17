import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { getRun, updateRun } from "@/lib/db";
import { parseAdPrompts } from "@/lib/ads/shape";
import { adsBatchJob } from "@/lib/ads/jobs";
import { jobRunning, startJob } from "@/lib/jobs";

// Start (or resume) Stage 5 generation as a server-side job.
// Body: { runId, prompts?: AdPrompt[] (edited set), indices?: number[] }
export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { runId?: number; prompts?: unknown; indices?: unknown };
  const runId = body.runId;
  if (typeof runId !== "number") return Response.json({ success: false, error: "runId required" }, { status: 400 });
  const run = await getRun(runId);
  if (!run) return Response.json({ success: false, error: "Run not found" }, { status: 404 });
  if (jobRunning("ads", runId)) return Response.json({ success: true, started: false, already: true });
  if (Array.isArray(body.prompts) && body.prompts.length) {
    await updateRun(runId, { ads_prompts_edited: JSON.stringify(body.prompts), last_updated_at: new Date().toISOString() });
  }
  const fresh = (await getRun(runId))!;
  if (!parseAdPrompts(fresh.ads_prompts_edited ?? fresh.ads_prompts).length) return Response.json({ success: false, error: "No ad briefs to generate from" }, { status: 400 });
  const indices = Array.isArray(body.indices) ? body.indices.filter((n): n is number => Number.isInteger(n)) : undefined;
  await updateRun(runId, { ads_step: "generating", ads_error: null, last_updated_at: new Date().toISOString() });
  startJob("ads", runId, (alive) => adsBatchJob(runId, { indices }, alive));
  return Response.json({ success: true, started: true });
}
