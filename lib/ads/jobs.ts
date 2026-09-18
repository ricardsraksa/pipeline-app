// Stage 5 image generation as a server-side job, mirroring lib/stage3/jobs.ts.
// Progress lives in ads_images / ads_step so a restart resumes from the row.
import { getRun, updateRun, type Run } from "@/lib/db";
import { parseAdImages, parseAdPrompts, type AdImage, type AdPrompt } from "@/lib/ads/shape";
import { generateStage3Image } from "@/lib/stage3/higgsfield";
import { auditImage } from "@/lib/stage3/audit";
import { upsertAdImage } from "@/lib/stage3/upsert";
import { stopRequested, type Alive } from "@/lib/jobs";
import { effectiveDescription } from "@/lib/run-context";

const ALWAYS: Alive = () => true;

const now = () => new Date().toISOString();
const safeJson = <T,>(json: string | null | undefined, fallback: T): T => {
  if (!json) return fallback;
  try { return JSON.parse(json) as T; } catch { return fallback; }
};
const isDone = (im: AdImage | undefined) => !!im && im.status === "done" && !!im.image_url;

function refsFor(run: Run, p: AdPrompt): string[] {
  const overrides = safeJson<Record<string, string[]>>(run.ads_ref_overrides, {});
  return overrides[String(p.index)] ?? p.source_image_references ?? [];
}
/** Only photographs of the real product are fair fidelity references: the hero and the uploads, never Stage 4 scenes. */
function productRefs(run: Run, refs: string[]): string[] {
  const real = new Set<string>([...(run.stage3_hero_image_url ? [run.stage3_hero_image_url] : []), ...safeJson<string[]>(run.uploaded_source_images, [])]);
  return refs.filter((u) => real.has(u));
}

async function produceAd(runId: number, run: Run, p: AdPrompt, promptText: string, refs: string[], prior: AdImage | undefined): Promise<AdImage> {
  const productDesc = effectiveDescription(run);
  const history = [
    ...(prior?.image_url ? [{ image_url: prior.image_url, prompt: p.prompt }] : []),
    ...(prior?.history ?? []),
  ].slice(0, 5);
  try {
    const image_url = await generateStage3Image({ prompt: promptText, model: p.model || "gpt_image_2", reference_images: refs, aspect_ratio: "1:1" });
    let verdict: "pass" | "fail" | undefined;
    let issues: string[] = [];
    try {
      const a = await auditImage({ image_url, category: `ad_${p.concept}`, prompt_used: promptText, product_description: productDesc, overlay_text_used: p.headline || null, reference_urls: productRefs(run, refs), run_id: runId });
      verdict = a.verdict; issues = a.issues;
    } catch (e) {
      issues = [`Audit unavailable: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`];
    }
    return { index: p.index, concept: p.concept, image_url, status: "done", verdict, issues, user_override: null, history };
  } catch (e) {
    return { index: p.index, concept: p.concept, image_url: prior?.image_url ?? "", status: "failed", error: e instanceof Error ? e.message : String(e), history };
  }
}

/** The batch: every brief without a finished ad (or the given indices), two at a time. Ends at done when anything finished, else review. */
export async function adsBatchJob(runId: number, opts: { indices?: number[] } = {}, alive: Alive = ALWAYS): Promise<void> {
  const run = await getRun(runId);
  if (!run || !alive()) return;
  const prompts = parseAdPrompts(run.ads_prompts_edited ?? run.ads_prompts);
  if (!prompts.length) { await updateRun(runId, { ads_step: "review", ads_error: "No ad briefs to generate from", last_updated_at: now() }); return; }
  const existing = new Map(parseAdImages(run.ads_images).map((im) => [im.index, im]));
  const targets = opts.indices?.length ? prompts.filter((p) => opts.indices!.includes(p.index)) : prompts.filter((p) => !isDone(existing.get(p.index)));

  await updateRun(runId, { ads_step: "generating", ads_error: null, last_updated_at: now() });
  const queue = [...targets];
  const worker = async () => {
    for (;;) {
      if (!alive() || stopRequested("ads", runId)) break;
      const p = queue.shift();
      if (!p) break;
      const result = await produceAd(runId, run, p, p.prompt, refsFor(run, p), existing.get(p.index));
      if (!alive()) break;     // Stage 5 was restarted while this ad rendered
      existing.set(p.index, result);
      await upsertAdImage(runId, result);
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, queue.length) }, () => worker()));

  if (!alive()) return;
  const all = prompts.map((p) => existing.get(p.index)).filter((x): x is AdImage => !!x).sort((a, b) => a.index - b.index);
  const finished = all.filter(isDone).length;
  await updateRun(runId, { ads_images: JSON.stringify(all), ads_step: finished > 0 ? "done" : "review", last_updated_at: now() });
}

/** One ad, synchronously: generate, audit, store. */
export async function regenerateOneAd(runId: number, index: number, promptText?: string, refsExplicit?: string[]): Promise<AdImage> {
  const run = await getRun(runId);
  if (!run) throw new Error("Run not found");
  const p = parseAdPrompts(run.ads_prompts_edited ?? run.ads_prompts).find((x) => x.index === index);
  if (!p) throw new Error(`No ad brief with index ${index}`);
  const prior = parseAdImages(run.ads_images).find((im) => im.index === index);
  const result = await produceAd(runId, run, p, promptText?.trim() || p.prompt, refsExplicit?.length ? refsExplicit : refsFor(run, p), prior);
  await upsertAdImage(runId, result);
  return result;
}
