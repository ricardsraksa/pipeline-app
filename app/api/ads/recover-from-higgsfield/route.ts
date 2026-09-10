import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { getRun, updateRun } from "@/lib/db";
import { listImageGenerations, type HiggsfieldGeneration } from "@/lib/higgsfield-mcp";
import { parseAdImages, parseAdPrompts, type AdImage } from "@/lib/ads/shape";

// Stage 5 twin of /api/stage3/recover-from-higgsfield. An ad that timed out
// while Higgsfield was still rendering is stored as failed even though the
// image finished there. Each ad is sent to Higgsfield as its stored prompt
// text verbatim, so a generation's prompt STARTS WITH the stored prompt: match
// on a normalized prefix and take the newest completed image.
export const maxDuration = 120;

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const urlOf = (g: HiggsfieldGeneration) => g.results?.rawUrl || g.results?.minUrl || "";

export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { runId } = (await req.json().catch(() => ({}))) as { runId?: number };
  if (typeof runId !== "number") return Response.json({ success: false, error: "runId required" }, { status: 400 });

  const run = await getRun(runId);
  if (!run) return Response.json({ success: false, error: "Run not found" }, { status: 404 });

  const prompts = parseAdPrompts(run.ads_prompts_edited ?? run.ads_prompts);
  if (!prompts.length) return Response.json({ success: false, error: "This run has no ad briefs to match against." }, { status: 400 });

  const existing = parseAdImages(run.ads_images);
  const byIndex = new Map(existing.map((im) => [im.index, im]));

  let gens: HiggsfieldGeneration[];
  try {
    gens = await listImageGenerations();
  } catch (err) {
    return Response.json({ success: false, error: `Couldn't read Higgsfield history: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
  }
  const usable = gens
    .filter((g) => g.status === "completed" && urlOf(g) && g.params?.prompt)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  const matched: number[] = [];
  const unmatched: number[] = [];
  const images: AdImage[] = [];
  for (const p of prompts) {
    const prior = byIndex.get(p.index);
    if (prior?.status === "done" && prior.image_url) { images.push(prior); matched.push(p.index); continue; }
    const key = norm(p.prompt || "").slice(0, 200);
    const hit = key ? usable.find((g) => norm(g.params!.prompt!).startsWith(key)) : undefined;
    if (hit) {
      // Not audited: the auditor runs in the browser after generation, and a
      // relinked image never went through it. The card shows "not audited".
      images.push({ index: p.index, concept: p.concept, image_url: urlOf(hit), status: "done", user_override: null, history: prior?.history ?? [] });
      matched.push(p.index);
    } else {
      if (prior) images.push(prior);
      unmatched.push(p.index);
    }
  }
  images.sort((a, b) => a.index - b.index);
  const recovered = matched.length - existing.filter((im) => im.status === "done" && im.image_url).length;
  if (recovered <= 0) {
    return Response.json({ success: false, error: "No matching images found in Higgsfield history.", matched, unmatched }, { status: 404 });
  }

  await updateRun(runId, {
    ads_images: JSON.stringify(images),
    ...(unmatched.length === 0 && run.ads_step !== "done" ? { ads_step: "done" } : {}),
    last_updated_at: new Date().toISOString(),
  });
  return Response.json({ success: true, recovered, total: prompts.length, matched, unmatched });
}
