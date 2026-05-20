import { NextRequest, NextResponse } from "next/server";
import { getRun } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<unknown> }
) {
  const { id } = (await context.params) as { id: string };
  const run = await getRun(parseInt(id, 10));

  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const safeJson = (s: string | null) => {
    if (!s) return null;
    try { return JSON.parse(s); } catch { return null; }
  };

  return NextResponse.json({
    runId: run.id,
    status: run.status,
    currentStep: run.current_step,
    error: run.error_message,
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
      stage2Output: run.stage2_output,
    },
    images: {
      scrapedUrls: safeJson(run.scraped_image_urls) ?? [],
      approvedUrls: safeJson(run.approved_image_urls) ?? [],
    },
    meta: {
      productUrl: run.product_url,
      productName: run.product_name,
      brandName: run.brand_name,
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
    },
    scrapeErrors: (() => {
      try { return run.notes ? JSON.parse(run.notes)?.scrapeErrors ?? [] : []; }
      catch { return []; }
    })(),
  });
}
