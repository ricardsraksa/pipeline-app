import { getRun, updateRun } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { appendStage2ToMasterDoc } from "@/lib/google/docs";
import type { Stage2Json } from "@/lib/stage2/shape";

export const maxDuration = 60;

// Manual "Send to Google Doc". Appends are not idempotent and have no undo, so
// a run that was already sent returns 409 unless the operator forces it.
export async function POST(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;

  const { runId, force } = (await req.json()) as { runId?: number; force?: boolean };
  if (typeof runId !== "number" || !Number.isInteger(runId)) {
    return Response.json({ success: false, error: "runId (integer) required" }, { status: 400 });
  }

  const run = await getRun(runId);
  if (!run) return Response.json({ success: false, error: "Run not found" }, { status: 404 });

  if (run.gdoc_appended_at && !force) {
    return Response.json(
      { success: false, already_sent_at: run.gdoc_appended_at, error: `Already sent ${run.gdoc_appended_at.slice(0, 10)} — send again?` },
      { status: 409 },
    );
  }

  let json: Stage2Json | null = null;
  try { json = run.stage2_json ? (JSON.parse(run.stage2_json) as Stage2Json) : null; } catch { /* fall through */ }
  if (!json) return Response.json({ success: false, error: "No structured Stage 2 copy on this run yet" }, { status: 400 });

  const result = await appendStage2ToMasterDoc(run.brand_name ?? json.product_name ?? "", json);
  const ts = new Date().toISOString();
  if (!result.ok) {
    await updateRun(runId, { gdoc_append_error: result.error ?? "unknown", last_updated_at: ts }).catch(() => {});
    return Response.json({ success: false, error: result.error }, { status: 502 });
  }
  await updateRun(runId, { gdoc_appended_at: ts, gdoc_append_error: null, last_updated_at: ts }).catch(() => {});
  return Response.json({ success: true, appended_at: ts });
}
