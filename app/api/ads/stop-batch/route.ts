import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { jobKey, requestStop } from "@/lib/jobs";

export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { runId } = (await req.json().catch(() => ({}))) as { runId?: number };
  if (typeof runId !== "number") return Response.json({ success: false, error: "runId required" }, { status: 400 });
  return Response.json({ success: true, stopping: requestStop(jobKey.ads(runId)) });
}
