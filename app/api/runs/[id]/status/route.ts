import { NextRequest, NextResponse } from "next/server";
import { getRun } from "@/lib/db";

import { requireSession } from "@/lib/auth";
export async function GET(
  _req: NextRequest,
  context: { params: Promise<unknown> }
) {
  const denied = requireSession(_req);
  if (denied) return denied;
  const { id } = (await context.params) as { id: string };
  const run = await getRun(parseInt(id, 10));

  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const safeJson = (s: string | null) => {
    if (!s) return null;
    try { return JSON.parse(s); } catch { return null; }
  };

  // Scraping is an internal implementation detail — never expose it to the UI.
  const status = run.status === "scraping" ? "stage1" : run.status;
  const currentStep = run.status === "scraping"
    ? "Stage 1: Product Identification (1/6)"
    : run.current_step;

  return NextResponse.json({
    runId: run.id,
    status,
    currentStep,
    error: run.error_message,
    // JSON string: { stage1?, stage2?, stage3_hero?, stage3_remaining? } — the
    // exact system prompts this run executed with (null on pre-v2.11 runs).
    promptsUsed: run.prompts_used,
    // Stage outputs
    outputs: {
      research: run.step_research,
      chiefMid: run.step_chief_mid,
      researchRevised: run.step_research_revised,
      avatar: run.step_avatar,
      offerBrief: run.step_offer_brief,
      necessaryBeliefs: run.step_necessary_beliefs,
      chiefFinal: run.step_chief_final,
      avatarRevised: run.step_avatar_revised,
      offerBriefRevised: run.step_offer_brief_revised,
      necessaryBeliefsRevised: run.step_necessary_beliefs_revised,
      onePager: run.stage1_one_pager,
      onePagerEdited: run.stage1_one_pager_edited,
      onePagerEditedAt: run.stage1_one_pager_edited_at,
      stage2Output: run.stage2_output,
      stage2OutputEdited: run.stage2_copy_edited,
      stage2EditedAt: run.stage2_edited_at,
      stage2Json: run.stage2_json,
      gdocAppendedAt: run.gdoc_appended_at ?? null,
    },
    images: {
      scrapedUrls: safeJson(run.scraped_image_urls) ?? [],
      approvedUrls: safeJson(run.approved_image_urls) ?? [],
    },
    meta: {
      productUrl: run.product_url,
      productName: run.product_name,
      brandName: run.brand_name,
      productDescription: run.product_description,
      uploadedSourceImages: safeJson(run.uploaded_source_images) ?? [],
      competitorUrls: safeJson(run.competitor_urls) ?? [],
    },
    timestamps: {
      startedAt: run.started_at,
      lastUpdatedAt: run.last_updated_at,
      completedAt: run.completed_at,
    },
    feedback: {
      stage1: run.feedback_stage1,
      stage2: run.feedback_stage2,
      stage3: run.feedback_stage3,
      stage1Note: run.feedback_stage1_note,
      stage2Note: run.feedback_stage2_note,
      stage3Note: run.feedback_stage3_note,
    },
    scrapeErrors: (() => {
      try { return run.notes ? JSON.parse(run.notes)?.scrapeErrors ?? [] : []; }
      catch { return []; }
    })(),
  });
}
