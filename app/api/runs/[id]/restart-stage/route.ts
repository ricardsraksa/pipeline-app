import { NextRequest, NextResponse } from "next/server";
import { getRun, updateRun, type Run } from "@/lib/db";
import { resumePipeline, runStage2Manually } from "@/lib/pipeline-runner";

import { requireSession } from "@/lib/auth";
import { invalidateRun } from "@/lib/jobs";
export const maxDuration = 10;

type RestartStage = "run" | "product" | "stage1" | "stage2" | "stage3-prompts" | "stage3-images" | "ads";

// Map a stage label to the DB columns that need to be cleared so the pipeline
// runner picks the stage back up from scratch on the next resume.
function fieldsToClear(stage: RestartStage): Partial<Run> {
  switch (stage) {
    case "run":
      // Everything this run generated, back to the links and photos it was
      // started from. The product code, the URLs and the operator's own
      // uploads stay; every generated artefact, every edit made to one, and
      // the delivery state go, so the rerun starts from a clean sheet.
      return {
        ...fieldsToClear("product"),
        ...fieldsToClear("stage2"),
        ...fieldsToClear("stage3-prompts"),
        ...fieldsToClear("ads"),
        product_pricing: null,
        product_variants_edited: null,
        variants_refresh_requested: null,
        stage3_source_blacklist: null,
        stage3_reference_images: null,
        market_position: null,
        run_edits: null,
        research_edit_notes: null,
        angles_built_on: null,
        stage2_built_on: null,
        stage3_built_on: null,
        ads_built_on: null,
        angles_research_key: null,
        stage2_research_key: null,
        stage3_research_key: null,
        ads_research_key: null,
        stage2_angle_key: null,
        stage3_angle_key: null,
        ads_angle_key: null,
        stage1_edited_at: null,
        stage1_one_pager_edited_at: null,
        prompts_used: null,
        // Delivery state: what was sent where no longer describes this run.
        gdoc_appended_at: null,
        shopify_push_state: null,
        ads_drive_state: null,
        snoozed_at: null,
      };
    case "product":
      // Re-scrape + re-describe. Research depends on the description and the
      // photo selection, so it is cleared too (it re-runs after the gate).
      return {
        product_scrape: null,
        product_description_ai: null,
        product_description_edited: null,
        product_selected_images: null,
        product_approved_at: null,
        product_description: null,
        scraper_data: null,
        scraped_image_urls: null,
        product_pricing: null,
        ...fieldsToClear("stage1"),
      };
    case "stage1":
      // Clear every Stage 1 sub-step AND the one-pager so runStage1 starts
      // from sub-step 1 instead of granular-skipping.
      return {
        step_research: null,
        step_chief_mid: null,
        step_research_revised: null,
        step_avatar: null,
        step_offer_brief: null,
        step_necessary_beliefs: null,
        step_chief_final: null,
        step_avatar_revised: null,
        step_offer_brief_revised: null,
        step_necessary_beliefs_revised: null,
        stage1_one_pager: null,
        stage1_one_pager_edited: null,
        stage1_one_pager_edited_at: null,
        product_angles: null,
        product_angle_selected: null,
        audience: null,
        // product_name and brand_name will be overwritten when Stage 1 re-runs;
        // leave them in place so they show in the UI while the rerun is in flight.
        brand_name: null,
      };
    case "stage2":
      return {
        stage2_output: null,
        stage2_copy_edited: null,
        stage2_edited_at: null,
        stage2_angle_key: null,
      };
    // Both Stage 3 restart variants do a FULL reset: wipe the entire hero-first
    // flow (hero prompt/image/approval, the 8 derivative prompts/images, and the
    // AI section placement) plus any legacy /stage3 columns, so the run drops
    // back to the Stage 3 entry point and the whole stage runs again from scratch.
    case "ads":
      // Stage 5 only — Stage 4's images and the run status are untouched.
      return {
        ads_prompts: null,
        ads_prompts_edited: null,
        ads_images: null,
        ads_step: null,
        ads_error: null,
        ads_ref_overrides: null,
        ads_angle_key: null,
        ads_research_key: null,
        ads_drive_state: null,
      };
    case "stage3-prompts":
    case "stage3-images":
      return {
        stage3_hero_prompt: null,
        stage3_hero_prompt_edited: null,
        stage3_hero_image_url: null,
        stage3_hero_approved: 0,
        stage3_remaining_prompts: null,
        stage3_remaining_prompts_edited: null,
        stage3_remaining_images: null,
        stage3_ref_overrides: null,
        stage3_prompt_history: null,
        stage3_placement: null,
        stage3_angle_key: null,
        stage3_research_key: null,
        // Format-validation results from the previous pass — stale after a
        // restart, and their badges would otherwise show against fresh prompts.
        stage3_hero_validation: null,
        stage3_remaining_validation: null,
        // Legacy /stage3 flow columns.
        image_prompts: null,
        stage3_image_prompts_edited: null,
        generated_images: null,
        audit_results: null,
        stage3_edited_at: null,
      };
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<unknown> }
) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { id } = (await context.params) as { id: string };
  const runId = parseInt(id, 10);

  if (!Number.isFinite(runId)) {
    return NextResponse.json({ error: "Invalid run id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { stage?: string };
  const stage = body.stage as RestartStage | undefined;
  const validStages: RestartStage[] = ["run", "product", "stage1", "stage2", "stage3-prompts", "stage3-images", "ads"];
  if (!stage || !validStages.includes(stage)) {
    return NextResponse.json({ error: `stage must be one of ${validStages.join(", ")}` }, { status: 400 });
  }

  const run = await getRun(runId);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  // Any server-side image job still rendering for this run belongs to the
  // stage being cleared: supersede it so it cannot write over the reset.
  invalidateRun(runId);

  const isStage3 = stage === "stage3-prompts" || stage === "stage3-images";
  // A whole-run restart goes back to the very beginning, exactly like "product".
  if (stage === "ads") {
    await updateRun(runId, { ...fieldsToClear(stage), last_updated_at: new Date().toISOString() });
    return NextResponse.json({ success: true });
  }

  await updateRun(runId, {
    ...fieldsToClear(stage),
    error_message: null,
    current_step: null,
    completed_at: null,
    // For a Stage 2 restart we need to flip to awaiting_stage2_approval so
    // runStage2Manually's guard passes. For a Stage 3 restart we drop to
    // 'awaiting_user' — the Stage 3 entry gate — so the hero flow shows its
    // start button. For other stages resumePipeline overwrites status itself.
    ...(stage === "stage2" ? { status: "awaiting_stage2_approval" as const } : {}),
    ...(isStage3 ? { status: "awaiting_user" as const } : {}),
    last_updated_at: new Date().toISOString(),
  });

  // Stage 3 is the hero-first flow, driven from the UI (the user clicks
  // "Generate hero" to start) — no pipeline resume needed. The status reset
  // above puts the run back at the Stage 3 entry point.
  if (isStage3) {
    return NextResponse.json({ success: true });
  }

  // Stage 2 restart bypasses the QC gate (user already approved Stage 1 once).
  // Everything else routes through resumePipeline which will pause at the gate
  // again as appropriate.
  const runner = stage === "stage2" ? runStage2Manually : resumePipeline;
  runner(runId).catch((err) => {
    console.error(`Restart ${stage} for run ${runId} failed:`, err);
  });

  return NextResponse.json({ success: true });
}
