import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { PlacementError, runPlacement } from "@/lib/stage3/placement";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { runId } = await req.json();
  if (!runId) return Response.json({ success: false, error: "runId required" }, { status: 400 });
  try {
    const placement = await runPlacement(Number(runId));
    return Response.json({ success: true, placement });
  } catch (err) {
    const status = err instanceof PlacementError ? err.status : 500;
    return Response.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
