import { requireSession } from "@/lib/auth";
import { sendRunToDoc } from "@/lib/google/send-run";

export const maxDuration = 60;

// Manual "Send to Google Doc". Appends are not idempotent and have no undo, so
// a run that was already sent returns 409 unless the operator forces it.
export async function POST(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;

  const { runId, force, dryRun } = (await req.json()) as { runId?: number; force?: boolean; dryRun?: boolean };
  if (typeof runId !== "number" || !Number.isInteger(runId)) {
    return Response.json({ success: false, error: "runId (integer) required" }, { status: 400 });
  }
  const r = await sendRunToDoc(runId, { force, dryRun });
  if (!r.ok) return Response.json({ success: false, error: r.error, already_sent_at: r.alreadySentAt, availableTabs: r.availableTabs }, { status: r.status });
  return Response.json({ success: true, appended_at: r.appendedAt, tab: r.tab, rows: r.rows, dryRun: r.dryRun });
}
