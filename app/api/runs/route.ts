import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import type { Run } from "@/lib/db";

export async function GET() {
  const result = await db.execute(
    `SELECT id, created_at, product_url, product_name, brand_name, status,
            feedback_stage1, feedback_stage2, feedback_stage3, notes,
            step_research, step_chief_mid, step_research_revised,
            step_avatar, step_offer_brief, step_necessary_beliefs,
            step_chief_final, step_avatar_revised, step_offer_brief_revised,
            step_necessary_beliefs_revised, stage2_output, image_urls
     FROM runs ORDER BY created_at DESC`
  );

  const rows = result.rows as unknown as (Pick<
    Run,
    | "id"
    | "created_at"
    | "product_url"
    | "product_name"
    | "brand_name"
    | "status"
    | "feedback_stage1"
    | "feedback_stage2"
    | "feedback_stage3"
    | "notes"
    | "step_research"
    | "step_chief_mid"
    | "step_research_revised"
    | "step_avatar"
    | "step_offer_brief"
    | "step_necessary_beliefs"
    | "step_chief_final"
    | "step_avatar_revised"
    | "step_offer_brief_revised"
    | "step_necessary_beliefs_revised"
    | "stage2_output"
    | "image_urls"
  >)[];

  const runs = rows.map((row) => {
    const stepFields = [
      row.step_research,
      row.step_chief_mid,
      row.step_research_revised,
      row.step_avatar,
      row.step_offer_brief,
      row.step_necessary_beliefs,
      row.step_chief_final,
      row.step_avatar_revised,
      row.step_offer_brief_revised,
      row.step_necessary_beliefs_revised,
      row.stage2_output,
    ];
    const doc_count = stepFields.filter((f) => f !== null && f !== undefined).length;
    return { ...row, doc_count };
  });

  return Response.json({ runs });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    product_url: string;
    product_name: string;
    product_description?: string;
    competitor_urls?: string[];
    scraper_data?: { scraped_text: string; images: string[] };
    step_research?: string;
    step_chief_mid?: string;
    step_research_revised?: string;
    step_avatar?: string;
    step_offer_brief?: string;
    step_necessary_beliefs?: string;
    step_chief_final?: string;
    step_avatar_revised?: string;
    step_offer_brief_revised?: string;
    step_necessary_beliefs_revised?: string;
    brand_name?: string;
    status?: string;
    revised_steps?: number[];
    image_prompts?: unknown;
    stage1_output?: string;
    stage2_output?: string;
    stage3_prompts?: unknown;
    image_urls?: string[];
  };

  const result = await db.execute({
    sql: `INSERT INTO runs (
      created_at, product_url, product_name,
      stage1_output, stage2_output, stage3_prompts, image_urls,
      product_description, competitor_urls, scraper_data,
      step_research, step_chief_mid, step_research_revised,
      step_avatar, step_offer_brief, step_necessary_beliefs,
      step_chief_final, step_avatar_revised, step_offer_brief_revised,
      step_necessary_beliefs_revised,
      brand_name, status, revised_steps, image_prompts
    ) VALUES (
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?,
      ?, ?, ?, ?
    )`,
    args: [
      new Date().toISOString(),
      body.product_url,
      body.product_name,
      body.stage1_output ?? null,
      body.stage2_output ?? null,
      body.stage3_prompts ? JSON.stringify(body.stage3_prompts) : null,
      body.image_urls ? JSON.stringify(body.image_urls) : null,
      body.product_description ?? null,
      body.competitor_urls ? JSON.stringify(body.competitor_urls) : null,
      body.scraper_data ? JSON.stringify(body.scraper_data) : null,
      body.step_research ?? null,
      body.step_chief_mid ?? null,
      body.step_research_revised ?? null,
      body.step_avatar ?? null,
      body.step_offer_brief ?? null,
      body.step_necessary_beliefs ?? null,
      body.step_chief_final ?? null,
      body.step_avatar_revised ?? null,
      body.step_offer_brief_revised ?? null,
      body.step_necessary_beliefs_revised ?? null,
      body.brand_name ?? null,
      body.status ?? null,
      body.revised_steps ? JSON.stringify(body.revised_steps) : null,
      body.image_prompts ? JSON.stringify(body.image_prompts) : null,
    ],
  });

  return Response.json({ success: true, id: Number(result.lastInsertRowid) });
}
