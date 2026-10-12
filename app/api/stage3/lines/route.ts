import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { getRun } from "@/lib/db";
import { promptLines } from "@/lib/stage3/lines";

// The one-line "what the picture shows" for each of the 8 prompt cards.
export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { runId } = (await req.json().catch(() => ({}))) as { runId?: number };
  if (!runId) return Response.json({ success: false, error: "runId required" }, { status: 400 });
  const run = await getRun(runId);
  if (!run) return Response.json({ success: false, error: "Run not found" }, { status: 404 });
  try {
    return Response.json({ success: true, lines: await promptLines(run) });
  } catch (e) {
    return Response.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
