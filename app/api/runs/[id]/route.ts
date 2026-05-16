import { NextRequest } from "next/server";
import getDb from "@/lib/db";
import type { Run } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<unknown> }
) {
  const { id } = (await context.params) as { id: string };
  const db = getDb();
  const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(Number(id)) as Run | undefined;

  if (!run) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json({ run });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<unknown> }
) {
  const { id } = (await context.params) as { id: string };
  const body = await req.json() as {
    feedback_stage1?: string | null;
    feedback_stage2?: string | null;
    feedback_stage3?: string | null;
    notes?: string | null;
    // image update fields
    stage2_output?: string | null;
    stage3_prompts?: unknown;
    image_urls?: string[] | null;
    status?: string | null;
  };

  const db = getDb();
  const existing = db.prepare("SELECT id FROM runs WHERE id = ?").get(Number(id));
  if (!existing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const fields: string[] = [];
  const values: unknown[] = [];

  if ("feedback_stage1" in body) { fields.push("feedback_stage1 = ?"); values.push(body.feedback_stage1 ?? null); }
  if ("feedback_stage2" in body) { fields.push("feedback_stage2 = ?"); values.push(body.feedback_stage2 ?? null); }
  if ("feedback_stage3" in body) { fields.push("feedback_stage3 = ?"); values.push(body.feedback_stage3 ?? null); }
  if ("notes" in body) { fields.push("notes = ?"); values.push(body.notes ?? null); }
  if ("stage2_output" in body) { fields.push("stage2_output = ?"); values.push(body.stage2_output ?? null); }
  if ("stage3_prompts" in body) { fields.push("stage3_prompts = ?"); values.push(body.stage3_prompts ? JSON.stringify(body.stage3_prompts) : null); }
  if ("image_urls" in body) { fields.push("image_urls = ?"); values.push(body.image_urls ? JSON.stringify(body.image_urls) : null); }
  if ("status" in body) { fields.push("status = ?"); values.push(body.status ?? null); }

  if (fields.length === 0) {
    return Response.json({ success: true });
  }

  values.push(Number(id));
  db.prepare(`UPDATE runs SET ${fields.join(", ")} WHERE id = ?`).run(...values);

  return Response.json({ success: true });
}
