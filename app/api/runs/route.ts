import { NextRequest } from "next/server";
import getDb from "@/lib/db";
import type { Run } from "@/lib/db";

export async function GET() {
  const db = getDb();
  const runs = db
    .prepare(
      `SELECT id, created_at, product_url, product_name,
              feedback_stage1, feedback_stage2, feedback_stage3, notes
       FROM runs ORDER BY created_at DESC`
    )
    .all() as Pick<
    Run,
    | "id"
    | "created_at"
    | "product_url"
    | "product_name"
    | "feedback_stage1"
    | "feedback_stage2"
    | "feedback_stage3"
    | "notes"
  >[];

  return Response.json({ runs });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    product_url: string;
    product_name: string;
    stage1_output?: string;
    stage2_output?: string;
    stage3_prompts?: unknown;
    image_urls?: string[];
  };

  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO runs (created_at, product_url, product_name, stage1_output, stage2_output, stage3_prompts, image_urls)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      new Date().toISOString(),
      body.product_url,
      body.product_name,
      body.stage1_output ?? null,
      body.stage2_output ?? null,
      body.stage3_prompts ? JSON.stringify(body.stage3_prompts) : null,
      body.image_urls ? JSON.stringify(body.image_urls) : null
    );

  return Response.json({ success: true, id: result.lastInsertRowid });
}
