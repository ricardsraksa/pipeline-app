import { NextRequest, NextResponse } from "next/server";
import { getRun, updateRun } from "@/lib/db";
import { requireSession } from "@/lib/auth";

// Put a run aside for later, or bring it back. Snoozing only moves it out of
// "Needs you" on Home and out of the header count — the run itself, its
// status and its work are untouched, so picking it up later resumes exactly
// where it was.
export async function POST(req: NextRequest, context: { params: Promise<unknown> }) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { id } = (await context.params) as { id: string };
  const runId = parseInt(id, 10);
  if (!Number.isFinite(runId)) return NextResponse.json({ success: false, error: "Invalid run id" }, { status: 400 });
  const run = await getRun(runId);
  if (!run) return NextResponse.json({ success: false, error: "Run not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { snoozed?: unknown };
  const snoozed = body.snoozed !== false;
  const at = new Date().toISOString();
  await updateRun(runId, { snoozed_at: snoozed ? at : null, last_updated_at: at });
  return NextResponse.json({ success: true, snoozed_at: snoozed ? at : null });
}
