import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { getRun, updateRun } from "@/lib/db";
import { assertPublicUrl } from "@/lib/ssrf";
import { remainingBatchJob, storedPrompts } from "@/lib/stage3/jobs";
import { jobRunning, startJob } from "@/lib/jobs";

// Start (or resume) the eight-image batch as a server-side job. Prompt edits
// are saved first so the batch and a later page load agree on the text.
// Body: { runId, prompts?: RemainingPrompt[] (edited set), indices?: number[],
//         promptTexts?: Record<index, string>, refs?: Record<index, string[]> }
export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { runId?: number; prompts?: unknown; indices?: unknown; promptTexts?: Record<string, string>; refs?: Record<string, string[]> };
  const runId = body.runId;
  if (typeof runId !== "number") return Response.json({ success: false, error: "runId required" }, { status: 400 });
  const run = await getRun(runId);
  if (!run) return Response.json({ success: false, error: "Run not found" }, { status: 404 });
  if (jobRunning("remaining", runId)) return Response.json({ success: true, started: false, already: true });

  if (Array.isArray(body.prompts) && body.prompts.length) {
    await updateRun(runId, { stage3_remaining_prompts_edited: JSON.stringify(body.prompts), last_updated_at: new Date().toISOString() });
  }
  const fresh = (await getRun(runId))!;
  if (!storedPrompts(fresh).length) return Response.json({ success: false, error: "No Stage 4 prompts to generate from" }, { status: 400 });
  const refs: Record<number, string[]> = {};
  try {
    for (const [k, v] of Object.entries(body.refs ?? {})) {
      if (!Array.isArray(v)) continue;
      const urls = v.filter((u): u is string => typeof u === "string");
      await Promise.all(urls.map((u) => assertPublicUrl(u)));
      refs[Number(k)] = urls;
    }
  } catch (e) {
    return Response.json({ success: false, error: e instanceof Error ? e.message : "blocked reference URL" }, { status: 400 });
  }
  const prompts: Record<number, string> = {};
  for (const [k, v] of Object.entries(body.promptTexts ?? {})) if (typeof v === "string" && v.trim()) prompts[Number(k)] = v;
  const indices = Array.isArray(body.indices) ? body.indices.filter((n): n is number => Number.isInteger(n)) : undefined;

  await updateRun(runId, { status: "generating_remaining", current_step: "Stage 4: Generating the 8 images", error_message: null, last_updated_at: new Date().toISOString() });
  startJob("remaining", runId, (alive) => remainingBatchJob(runId, { indices, prompts, refs }, alive));
  return Response.json({ success: true, started: true });
}
