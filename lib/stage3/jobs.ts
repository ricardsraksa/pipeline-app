// Stage 4 as server-side jobs. Everything that used to be driven from the
// browser (the eight-image batch, single regenerations) or that lived inside a
// long request (hero prompt + image, the eight prompts) runs here, writes its
// progress to the run row as it goes, and can be resumed from that row by the
// watchdog after a restart. Closing the tab changes nothing.
import { anglesBlock, parseSelectedAngles, angleKey } from "@/lib/angles";
import { getRun, updateRun, recordPromptUsed, type Run } from "@/lib/db";
import { generateHeroPrompt, generateRemainingPrompts, HERO_SYSTEM, REMAINING_SYSTEM, extractVisualSection, pageSectionsFromStage2Json, type HeroPrompt, type RemainingPrompt } from "@/lib/stage3/hero";
import { stage3ActiveSourceImages } from "@/lib/stage3/sources";
import { generateStage3Image } from "@/lib/stage3/higgsfield";
import { probeImportUrl } from "@/lib/higgsfield-mcp";
import { auditImage } from "@/lib/stage3/audit";
import { upsertStage3Image } from "@/lib/stage3/upsert";
import { runPlacement } from "@/lib/stage3/placement";
import { stopRequested, type Alive } from "@/lib/jobs";

const ALWAYS: Alive = () => true;
import { onePagerForDownstream, researchKey } from "@/lib/research-edits";
import { builtOnFor, contextBlock, effectiveDescription } from "@/lib/run-context";

export interface RemImage {
  index: number;
  category: string;
  image_url: string;
  status: "done" | "failed";
  error?: string;
  verdict?: "pass" | "fail";
  issues?: string[];
  user_override?: "pass" | "fail" | null;
  history?: Array<{ image_url: string; prompt?: string }>;
}

const now = () => new Date().toISOString();
const safeArr = (json: string | null | undefined): string[] => {
  if (!json) return [];
  try { const v = JSON.parse(json); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { return []; }
};
const safeJson = <T,>(json: string | null | undefined, fallback: T): T => {
  if (!json) return fallback;
  try { return JSON.parse(json) as T; } catch { return fallback; }
};

export function storedPrompts(run: Run): RemainingPrompt[] {
  return safeJson<RemainingPrompt[]>(run.stage3_remaining_prompts_edited ?? run.stage3_remaining_prompts, []).filter((p) => p && typeof p.index === "number");
}
export function storedImages(run: Run): RemImage[] {
  return safeJson<RemImage[]>(run.stage3_remaining_images, []).filter((im) => im && typeof im.index === "number");
}
export const isDone = (im: RemImage | undefined) => !!im && im.status === "done" && !!im.image_url;

/** The reference photos a prompt generates from: the operator's override, else the writer's picks, else the hero. */
export function refsFor(p: RemainingPrompt, overrides: Record<string, string[]>, heroUrl: string | null): string[] {
  const o = overrides[String(p.index)];
  if (o && o.length) return o;
  return p.source_image_references?.length ? p.source_image_references : (heroUrl ? [heroUrl] : []);
}

// ── Hero ────────────────────────────────────────────────────────────────────

/**
 * Write the hero prompt (unless one is stored already) and generate the hero.
 * Resumable: a restart mid-generation re-enters here and, finding the prompt,
 * only generates the image. Ends at awaiting_hero_qc; on failure drops back
 * to the Stage 4 entry gate with the reason.
 */
export async function heroJob(runId: number, alive: Alive = ALWAYS): Promise<void> {
  const run = await getRun(runId);
  if (!run || !alive()) return;
  const sourceImageUrls = stage3ActiveSourceImages(run);
  if (!sourceImageUrls.length) {
    await updateRun(runId, { status: "awaiting_user", error_message: "No source product images to build a hero from", last_updated_at: now() });
    return;
  }
  try {
    await updateRun(runId, { status: "generating_hero", current_step: "Stage 4: Generating hero shot", error_message: null, last_updated_at: now() });
    let hero = safeJson<HeroPrompt | null>(run.stage3_hero_prompt, null);
    if (!hero) {
      const onePager = onePagerForDownstream(run);
      const copy = run.stage2_copy_edited ?? run.stage2_output ?? "";
      await recordPromptUsed(runId, "stage3_hero", HERO_SYSTEM);
      const out = await generateHeroPrompt({ onePager: onePager + contextBlock(run, "stage3"), copy, angle: anglesBlock(parseSelectedAngles(run.product_angle_selected)), sourceImageUrls, extraReferenceUrls: safeArr(run.stage3_reference_images), runId });
      hero = out.hero;
      if (!alive()) return;
      await updateRun(runId, { stage3_hero_prompt: JSON.stringify(hero), stage3_hero_validation: JSON.stringify(out.validation), last_updated_at: now() });
    }
    const promptText = run.stage3_hero_prompt_edited?.trim() || hero.prompt;
    const imageUrl = await generateStage3Image({
      prompt: promptText,
      model: hero.model,
      reference_images: hero.source_image_references?.length ? hero.source_image_references : sourceImageUrls,
      aspect_ratio: hero.aspect_ratio,
    });
    if (!alive()) return;
    await updateRun(runId, { stage3_hero_image_url: imageUrl, stage3_hero_approved: 0, status: "awaiting_hero_qc", current_step: "Stage 4: Review the hero shot", last_updated_at: now() });
  } catch (err) {
    if (!alive()) return;
    const message = err instanceof Error ? err.message : String(err);
    // Back to the gate the operator can act from: the hero review when an older
    // hero exists, otherwise the Stage 4 entry.
    const fresh = await getRun(runId);
    await updateRun(runId, { status: fresh?.stage3_hero_image_url ? "awaiting_hero_qc" : "awaiting_user", error_message: message, last_updated_at: now() }).catch(() => {});
  }
}

/** Regenerate the hero, optionally from an edited prompt. A new hero invalidates everything derived from the old one. */
export async function heroRegenJob(runId: number, editedPrompt?: string, alive: Alive = ALWAYS): Promise<void> {
  const run = await getRun(runId);
  if (!run || !alive()) return;
  const hero = safeJson<HeroPrompt | null>(run.stage3_hero_prompt, null);
  if (!hero) { await updateRun(runId, { error_message: "No hero prompt to regenerate", last_updated_at: now() }); return; }
  const edited = editedPrompt?.trim() || "";
  const promptText = edited || run.stage3_hero_prompt_edited?.trim() || hero.prompt;
  const referenceImages = [...stage3ActiveSourceImages(run), ...safeArr(run.stage3_reference_images)].filter((u, i, a) => u && a.indexOf(u) === i).slice(0, 6);
  try {
    // The edited prompt is stored before generating, so a resume uses it.
    await updateRun(runId, { ...(edited ? { stage3_hero_prompt_edited: edited } : {}), status: "generating_hero", current_step: "Stage 4: Regenerating hero shot", error_message: null, last_updated_at: now() });
    const imageUrl = await generateStage3Image({ prompt: promptText, model: hero.model || "gpt_image_2", reference_images: referenceImages, aspect_ratio: hero.aspect_ratio || "1:1" });
    if (!alive()) return;
    await updateRun(runId, {
      stage3_hero_image_url: imageUrl,
      stage3_remaining_prompts: null,
      stage3_remaining_prompts_edited: null,
      stage3_remaining_images: null,
      stage3_ref_overrides: null,
      stage3_placement: null,
      status: "awaiting_hero_qc",
      current_step: "Stage 4: Review the hero shot",
      last_updated_at: now(),
    });
  } catch (err) {
    if (!alive()) return;
    const message = err instanceof Error ? err.message : String(err);
    await updateRun(runId, { status: "awaiting_hero_qc", error_message: message, last_updated_at: now() }).catch(() => {});
  }
}

// ── The eight prompts ───────────────────────────────────────────────────────

/** Write the eight derivative prompts from the approved hero, or from the source photos when the hero is skipped. Ends at awaiting_qc. */
export async function remainingPromptsJob(runId: number, fromSource: boolean, alive: Alive = ALWAYS): Promise<void> {
  const run = await getRun(runId);
  if (!run || !alive()) return;
  const heroUrl = fromSource ? null : run.stage3_hero_image_url;
  const sourceImageUrls = stage3ActiveSourceImages(run);
  const gateOnError = heroUrl ? "awaiting_hero_qc" : "awaiting_user";
  try {
    if (!fromSource && !heroUrl) throw new Error("No hero image to approve");
    if (fromSource && !sourceImageUrls.length) throw new Error("No source product images to generate from");
    await updateRun(runId, {
      ...(fromSource ? { stage3_hero_prompt: null, stage3_hero_prompt_edited: null, stage3_hero_image_url: null, stage3_hero_approved: 0 } : { stage3_hero_approved: 1 }),
      status: "generating_remaining",
      current_step: fromSource ? "Stage 4: Writing the 8 prompts from source images" : "Stage 4: Writing the 8 derivative prompts",
      error_message: null,
      last_updated_at: now(),
    });
    const onePager = onePagerForDownstream(run);
    const copy = run.stage2_copy_edited ?? run.stage2_output ?? "";
    const avatar = run.step_avatar_revised ?? run.step_avatar ?? "";
    const visual = extractVisualSection(run.step_research_revised ?? run.step_research ?? "");
    await recordPromptUsed(runId, "stage3_remaining", REMAINING_SYSTEM);
    const { prompts, validation } = await generateRemainingPrompts({
      onePager: onePager + contextBlock(run, "stage3"), copy, avatar, visual,
      angle: anglesBlock(parseSelectedAngles(run.product_angle_selected)),
      referenceImageUrls: heroUrl ? [heroUrl] : sourceImageUrls,
      extraReferenceUrls: safeArr(run.stage3_reference_images),
      fromSource,
      runId,
      sections: pageSectionsFromStage2Json(run.stage2_json),
    });
    if (!prompts.length) throw new Error("Prompt generation produced no prompts");
    if (!alive()) return;
    await updateRun(runId, {
      stage3_remaining_prompts: JSON.stringify(prompts),
      stage3_angle_key: angleKey(run.product_angle_selected),
      stage3_research_key: researchKey(run),
      stage3_built_on: builtOnFor(run, "stage3"),
      stage3_remaining_validation: JSON.stringify(validation),
      status: "awaiting_qc",
      current_step: "Stage 4: Review the 8 prompts before generating",
      last_updated_at: now(),
    });
  } catch (err) {
    if (!alive()) return;
    const message = err instanceof Error ? err.message : String(err);
    await updateRun(runId, { status: gateOnError, error_message: message, last_updated_at: now() }).catch(() => {});
  }
}

// ── The eight images ────────────────────────────────────────────────────────

/** Generate, audit and store one image for a prompt. Keeps the replaced image in history. */
async function produceImage(runId: number, run: Run, p: RemainingPrompt, promptText: string, refs: string[], prior: RemImage | undefined): Promise<RemImage> {
  const productDesc = effectiveDescription(run);
  const history = [
    ...(prior?.image_url ? [{ image_url: prior.image_url, prompt: p.prompt }] : []),
    ...(prior?.history ?? []),
  ].slice(0, 5);
  try {
    const image_url = await generateStage3Image({ prompt: promptText, model: p.model, reference_images: refs, aspect_ratio: p.aspect_ratio });
    let verdict: "pass" | "fail" | undefined;
    let issues: string[] = [];
    try {
      const a = await auditImage({ image_url, category: p.category, prompt_used: promptText, product_description: productDesc, overlay_text_used: p.overlay_text || null, reference_urls: refs, run_id: runId });
      verdict = a.verdict; issues = a.issues;
    } catch (e) {
      issues = [`Audit unavailable: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`];
    }
    return { index: p.index, category: p.category, image_url, status: "done", verdict, issues, user_override: null, history };
  } catch (e) {
    return { index: p.index, category: p.category, image_url: prior?.image_url ?? "", status: "failed", error: e instanceof Error ? e.message : String(e), history };
  }
}

/**
 * The batch. Targets every prompt without a finished image (or the given
 * indices, for a bulk regeneration), three at a time, each stored the moment
 * it settles. Resumable: a restart re-enters and skips what is already done.
 * Ends at completed with placement made and the ad briefs started; a stop
 * request or a still-missing image leaves it at the prompt gate.
 */
export async function remainingBatchJob(runId: number, opts: { indices?: number[]; prompts?: Record<number, string>; refs?: Record<number, string[]> } = {}, alive: Alive = ALWAYS): Promise<void> {
  const run = await getRun(runId);
  if (!run || !alive()) return;
  const prompts = storedPrompts(run);
  if (!prompts.length) { await updateRun(runId, { status: run.stage3_hero_image_url ? "awaiting_hero_qc" : "awaiting_user", error_message: "No Stage 4 prompts to generate from", last_updated_at: now() }); return; }
  const heroUrl = run.stage3_hero_image_url ?? null;
  const overrides = safeJson<Record<string, string[]>>(run.stage3_ref_overrides, {});
  const existing = new Map(storedImages(run).map((im) => [im.index, im]));
  const targets = opts.indices?.length
    ? prompts.filter((p) => opts.indices!.includes(p.index))
    : prompts.filter((p) => !isDone(existing.get(p.index)));
  const total = prompts.length;
  const doneCount = () => prompts.filter((p) => isDone(existing.get(p.index))).length;

  await updateRun(runId, { status: "generating_remaining", current_step: `Stage 4: Generating the ${total} images (${doneCount()}/${total})`, error_message: null, last_updated_at: now() });

  const queue = [...targets];
  const worker = async () => {
    for (;;) {
      if (!alive() || stopRequested("remaining", runId)) break;
      const p = queue.shift();
      if (!p) break;
      const promptText = opts.prompts?.[p.index] ?? p.prompt;
      const refs = opts.refs?.[p.index]?.length ? opts.refs[p.index] : refsFor(p, overrides, heroUrl);
      const result = await produceImage(runId, run, p, promptText, refs, existing.get(p.index));
      // Superseded while this image was rendering (stage restarted, run
      // killed, hero regenerated): the result belongs to a stage that no
      // longer exists, so it is dropped rather than written over the reset.
      if (!alive()) break;
      existing.set(p.index, result);
      await upsertStage3Image(runId, result, `Stage 4: Generating the ${total} images (${doneCount()}/${total})`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, () => worker()));

  if (!alive()) return;
  const settledAll = prompts.every((p) => existing.has(p.index));
  const stopped = stopRequested("remaining", runId) && queue.length > 0;
  if (!settledAll || stopped) {
    await updateRun(runId, { status: "awaiting_qc", current_step: "Stage 4: Review the 8 prompts before generating", last_updated_at: now() });
    return;
  }
  // Authoritative write of the whole array with the status flip: a completed
  // run always has all its entries even if a per-image save was lost.
  const all = prompts.map((p) => existing.get(p.index)!).sort((a, b) => a.index - b.index);
  await updateRun(runId, { stage3_remaining_images: JSON.stringify(all), status: "completed", current_step: "Complete", completed_at: now(), last_updated_at: now() });
  // Placement and the ad briefs follow on their own; neither failing undoes the images.
  try { if (all.filter(isDone).length >= 2 && !run.stage3_placement) await runPlacement(runId); } catch (e) { console.warn(`[stage4 ${runId}] placement skipped:`, e instanceof Error ? e.message : String(e)); }
  try { const { maybeStartAds } = await import("@/lib/ads/write"); await maybeStartAds(runId); } catch { /* reported by maybeStartAds */ }
}

/** One image, synchronously: generate, audit, store. The caller (a route) awaits it; the tab closing does not stop it. */
export async function regenerateOneImage(runId: number, index: number, promptText?: string, refsExplicit?: string[]): Promise<RemImage> {
  const run = await getRun(runId);
  if (!run) throw new Error("Run not found");
  const p = storedPrompts(run).find((x) => x.index === index);
  if (!p) throw new Error(`No prompt with index ${index}`);
  const heroUrl = run.stage3_hero_image_url ?? null;
  const overrides = safeJson<Record<string, string[]>>(run.stage3_ref_overrides, {});
  const text = promptText?.trim() || p.prompt;
  const refs = refsExplicit?.length ? refsExplicit : refsFor(p, overrides, heroUrl);
  const prior = storedImages(run).find((im) => im.index === index);
  const result = await produceImage(runId, run, p, text, refs, prior);
  await upsertStage3Image(runId, result);
  return result;
}
