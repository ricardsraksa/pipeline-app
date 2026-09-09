import { NextRequest, NextResponse } from "next/server";
import { getRun, getKV } from "@/lib/db";

import { requireSession } from "@/lib/auth";
import { getPricingRules } from "@/lib/pricing-store";
import type { PricingRules } from "@/lib/pricing";
import { angleKey } from "@/lib/angles";

// This route is polled every few seconds per open run, so the two settings
// lookups (worker heartbeat, pricing rules) are cached in-process for 10s —
// otherwise every poll costs three round trips to a remote database instead
// of one. Both change rarely; 10s of staleness is invisible in the UI.
type Cached<T> = { at: number; value: T };
let kvCache: Cached<string | null> | null = null;
let rulesCache: Cached<PricingRules> | null = null;
const TTL = 10_000;

// The scrape is sent on every poll but the browser only reads the structured
// fields — never the raw page text. Dropping those keeps a poll small even on
// runs with long listings and several competitor pages.
function slimScrape(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { pages?: Array<Record<string, unknown>> };
    if (!Array.isArray(v?.pages)) return raw;
    return JSON.stringify({
      ...v,
      pages: v.pages.map(({ scraped_text, long_description, image_text, specs, ...rest }) => rest),
    });
  } catch { return raw; }
}
export async function GET(
  _req: NextRequest,
  context: { params: Promise<unknown> }
) {
  const denied = requireSession(_req);
  if (denied) return denied;
  const { id } = (await context.params) as { id: string };
  const run = await getRun(parseInt(id, 10));
  const now = Date.now();
  let workerLastSeen: string | null = kvCache && now - kvCache.at < TTL ? kvCache.value : null;
  if (!kvCache || now - kvCache.at >= TTL) {
    try { workerLastSeen = await getKV("worker_last_seen"); kvCache = { at: now, value: workerLastSeen }; } catch { /* optional */ }
  }
  let pricingRules: PricingRules;
  if (rulesCache && now - rulesCache.at < TTL) pricingRules = rulesCache.value;
  else { pricingRules = await getPricingRules(); rulesCache = { at: now, value: pricingRules }; }

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
    ? "Stage 2: Product Identification (1/6)"
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
    // Stage 4 output as it stands — the rail unlocks Shopify/Drive on this,
    // not on the status word (a lost "completed" write must not block them).
    stage4: (() => {
      let done = 0, total = 0;
      try {
        const arr = JSON.parse(run.stage3_remaining_images ?? "[]");
        if (Array.isArray(arr)) {
          total = arr.length;
          done = arr.filter((x: { image_url?: string; status?: string }) => x?.image_url && x.status === "done").length;
        }
      } catch { /* none */ }
      return { hero: run.stage3_hero_image_url ?? null, done, total };
    })(),
    // Stage 1 · Product: the scrape, the analyst text, the operator's edit
    // and photo selection, and when the gate was passed.
    product: {
      scrape: slimScrape(run.product_scrape),
      descriptionAi: run.product_description_ai ?? null,
      descriptionEdited: run.product_description_edited ?? null,
      selectedImages: safeJson(run.product_selected_images) ?? [],
      approvedAt: run.product_approved_at ?? null,
      // Last time the Mac worker polled the queue (ISO) — the gate shows
      // whether it is online while a page is waiting on it.
      workerLastSeen,
    },
    // Angles gate (after research): proposals + the operator's pick.
    angles: {
      proposed: run.product_angles ?? null,
      selected: run.product_angle_selected ?? null,
      // Current pick vs. what each stage was built with (null = unknown/none).
      key: angleKey(run.product_angle_selected),
      stage2Key: run.stage2_angle_key ?? null,
      stage3Key: run.stage3_angle_key ?? null,
      adsKey: run.ads_angle_key ?? null,
    },
    meta: {
      productUrl: run.product_url,
      productName: run.product_name,
      productCode: run.product_code ?? null,
      shopifyProductUrl: run.shopify_product_url ?? null,
      brandName: run.brand_name,
      productDescription: run.product_description,
      uploadedSourceImages: safeJson(run.uploaded_source_images) ?? [],
      competitorUrls: safeJson(run.competitor_urls) ?? [],
      // Stage 3 Pricing card: the stored suggestion and the current rules.
      pricing: safeJson(run.product_pricing) ?? null,
      pricingRules,
      // Schwartz coordinates: what the angles, copy and ads open on.
      marketPosition: safeJson(run.market_position) ?? null,
      variantsRequestedAt: run.variants_refresh_requested ?? null,
      variantsEdited: run.product_variants_edited ?? null,
      // Stage 5 · Image ads
      ads: (() => {
        let prompts = 0, done = 0, failed = 0;
        try { const p = JSON.parse(run.ads_prompts ?? "[]"); if (Array.isArray(p)) prompts = p.length; } catch { /* none */ }
        try {
          const a = JSON.parse(run.ads_images ?? "[]");
          if (Array.isArray(a)) { done = a.filter((x: { status?: string; image_url?: string }) => x?.status === "done" && x.image_url).length; failed = a.filter((x: { status?: string }) => x?.status === "failed").length; }
        } catch { /* none */ }
        // A step that has not moved in 15 minutes is stalled, not working:
        // the browser tab that was generating is gone, or the process that was
        // writing the briefs died. Reported so the UI can offer a retry
        // instead of spinning forever.
        const working = run.ads_step === "writing" || run.ads_step === "generating";
        const ageMs = run.last_updated_at ? Date.now() - new Date(run.last_updated_at).getTime() : 0;
        const stalled = working && ageMs > 15 * 60 * 1000;
        return { step: run.ads_step ?? null, error: run.ads_error ?? null, prompts, done, failed, stalled };
      })(),
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
