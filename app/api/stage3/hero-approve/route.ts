import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { getRun, updateRun } from "@/lib/db";
import { probeImportUrl } from "@/lib/higgsfield-mcp";
import { remainingPromptsJob } from "@/lib/stage3/jobs";
import { startJob } from "@/lib/jobs";

// Approve the hero → write the 8 derivative prompts (server-side job) and land
// at the prompt-review gate. The approved hero is the reference for all 8.
export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { runId } = (await req.json()) as { runId?: number };
  if (!runId) return Response.json({ success: false, error: "runId required" }, { status: 400 });
  const run = await getRun(runId);
  if (!run) return Response.json({ success: false, error: "Run not found" }, { status: 404 });
  const heroUrl = run.stage3_hero_image_url;
  if (!heroUrl) return Response.json({ success: false, error: "No hero image to approve" }, { status: 400 });

  // Gate check, kept synchronous because it is quick and its fix is the
  // operator's: Higgsfield's import moderation must accept the hero as a
  // reference or all 8 generations would fail identically.
  const probe = await probeImportUrl(heroUrl);
  if (!probe.ok) {
    const message =
      "Higgsfield refuses this hero as a reference (their content filter — bare skin or body parts are the usual trigger, even in images they generated). " +
      "Regenerate the hero without visible skin (e.g. “product-only studio shot, no person”) — the 8 scene images can still depict people; only the reference can't.";
    await updateRun(runId, { status: "awaiting_hero_qc", error_message: message, last_updated_at: new Date().toISOString() });
    return Response.json({ success: false, error: message }, { status: 422 });
  }
  await updateRun(runId, { stage3_hero_approved: 1, status: "generating_remaining", current_step: "Stage 4: Writing the 8 derivative prompts", error_message: null, last_updated_at: new Date().toISOString() });
  startJob("remaining", runId, (alive) => remainingPromptsJob(runId, false, alive));
  return Response.json({ success: true, started: true });
}
