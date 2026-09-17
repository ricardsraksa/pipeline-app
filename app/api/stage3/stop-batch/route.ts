import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { requestStop } from "@/lib/jobs";

// "Stop after current": in-flight images finish and are saved; no new ones start.
export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { runId } = (await req.json().catch(() => ({}))) as { runId?: number };
  if (typeof runId !== "number") return Response.json({ success: false, error: "runId required" }, { status: 400 });
  return Response.json({ success: true, stopping: requestStop("remaining", runId) });
}
