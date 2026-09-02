import { NextRequest, NextResponse } from "next/server";
import { getRun, updateRun, type Run } from "@/lib/db";
import { resumePipeline, runStage2Manually } from "@/lib/pipeline-runner";

import { requireSession } from "@/lib/auth";
export const maxDuration = 10;

type RestartStage = "stage1" | "stage2" | "stage3-prompts" | "stage3-images";

// Map a stage label to the DB columns that need to be cleared so the pipeline
// runner picks the stage back up from scratch on the next resume.
function fieldsToClear(stage: RestartStage): Partial<Run> {
  switch (stage) {
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
        // product_name and brand_name will be overwritten when Stage 1 re-runs;
        // leave them in place so they show in the UI while the rerun is in flight.
        brand_name: null,
      };
    case "stage2":
      return {
        stage2_output: null,
        stage2_copy_edited: null,
        stage2_edited_at: null,
      };
    // Both Stage 3 restart variants do a FULL reset: wipe the entire hero-first
    // flow (hero prompt/image/approval, the 8 derivative prompts/images, and the
    // AI section placement) plus any legacy /stage3 columns, so the run drops
    // back to the Stage 3 entry point and the whole stage runs again from scratch.
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
        stage3_placement: null,
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
  const validStages: RestartStage[] = ["stage1", "stage2", "stage3-prompts", "stage3-images"];
  if (!stage || !validStages.includes(stage)) {
    return NextResponse.json({ error: `stage must be one of ${validStages.join(", ")}` }, { status: 400 });
  }

  const run = await getRun(runId);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const isStage3 = stage === "stage3-prompts" || stage === "stage3-images";

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
