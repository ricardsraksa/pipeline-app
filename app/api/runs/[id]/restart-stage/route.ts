import { NextRequest, NextResponse } from "next/server";
import { getRun, updateRun, type Run } from "@/lib/db";
import { resumePipeline, runStage2Manually } from "@/lib/pipeline-runner";

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
    case "stage3-prompts":
      return {
        image_prompts: null,
        stage3_image_prompts_edited: null,
        generated_images: null,
        audit_results: null,
        stage3_edited_at: null,
      };
    case "stage3-images":
      return {
        generated_images: null,
        audit_results: null,
      };
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<unknown> }
) {
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

  await updateRun(runId, {
    ...fieldsToClear(stage),
    error_message: null,
    current_step: null,
    completed_at: null,
    // For a Stage 2 restart we need to flip to awaiting_stage2_approval so
    // runStage2Manually's guard passes; for all other stages resumePipeline
    // will overwrite status itself.
    ...(stage === "stage2" ? { status: "awaiting_stage2_approval" as const } : {}),
    last_updated_at: new Date().toISOString(),
  });

  // Stage 2 restart bypasses the QC gate (user already approved Stage 1 once).
  // Everything else routes through resumePipeline which will pause at the gate
  // again as appropriate.
  const runner = stage === "stage2" ? runStage2Manually : resumePipeline;
  runner(runId).catch((err) => {
    console.error(`Restart ${stage} for run ${runId} failed:`, err);
  });

  return NextResponse.json({ success: true });
}
