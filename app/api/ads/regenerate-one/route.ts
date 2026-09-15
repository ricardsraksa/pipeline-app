import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { assertPublicUrl } from "@/lib/ssrf";
import { regenerateOneAd } from "@/lib/ads/jobs";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { runId?: number; index?: number; prompt?: string; reference_images?: unknown };
  if (typeof body.runId !== "number" || typeof body.index !== "number") return Response.json({ success: false, error: "runId and index required" }, { status: 400 });
  const refs = Array.isArray(body.reference_images) ? body.reference_images.filter((u): u is string => typeof u === "string").slice(0, 6) : [];
  try { await Promise.all(refs.map((u) => assertPublicUrl(u))); } catch (e) {
    return Response.json({ success: false, error: e instanceof Error ? e.message : "blocked reference URL" }, { status: 400 });
  }
  try {
    const image = await regenerateOneAd(body.runId, body.index, typeof body.prompt === "string" ? body.prompt : undefined, refs);
    return Response.json({ success: true, image });
  } catch (err) {
    return Response.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
