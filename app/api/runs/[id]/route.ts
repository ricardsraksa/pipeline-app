import { NextRequest } from "next/server";
import { db, detachRunFeedback, upsertFeedbackNote, type FeedbackStage } from "@/lib/db";
import type { Run } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<unknown> }
) {
  const { id } = (await context.params) as { id: string };

  const result = await db.execute({
    sql: "SELECT * FROM runs WHERE id = ?",
    args: [Number(id)],
  });

  if (!result.rows.length) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const run = result.rows[0] as unknown as Run;
  return Response.json({ run });
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<unknown> }
) {
  const { id } = (await context.params) as { id: string };
  const runId = Number(id);
  if (!Number.isFinite(runId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }
  // Preserve any feedback notes for this run before the row is gone.
  // detachRunFeedback nulls source_run_id but keeps the row + product snapshot.
  await detachRunFeedback(runId);
  await db.execute({ sql: "DELETE FROM runs WHERE id = ?", args: [runId] });
  return Response.json({ success: true });
}

const EDITABLE_FIELDS = [
  "stage1_research",
  "stage1_chief_mid",
  "stage1_avatar",
  "stage1_offer_brief",
  "stage1_necessary_beliefs",
  "stage1_chief_final",
  "stage1_avatar_revised",
  "stage1_offer_brief_revised",
  "stage1_necessary_beliefs_revised",
  "stage2_copy",
  "stage3_image_prompts",
  "stage1_one_pager",
] as const;

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<unknown> }
) {
  const { id } = (await context.params) as { id: string };
  const body = await req.json() as { type?: string } & {
    feedback_stage1?: string | null;
    feedback_stage2?: string | null;
    feedback_stage3?: string | null;
    feedback_stage1_note?: string | null;
    feedback_stage2_note?: string | null;
    feedback_stage3_note?: string | null;
    notes?: string | null;
    stage2_output?: string | null;
    stage3_prompts?: unknown;
    image_urls?: string[] | null;
    status?: string | null;
    image_prompts?: string | null;
    generated_images?: string | null;
    audit_results?: string | null;
    prompt_edits_made?: number | null;
    uploaded_image_count?: number | null;
    product_name?: string | null;
    brand_name?: string | null;
    revised_steps?: unknown;
    step_research?: string | null;
    step_chief_mid?: string | null;
    step_research_revised?: string | null;
    step_avatar?: string | null;
    step_offer_brief?: string | null;
    step_necessary_beliefs?: string | null;
    step_chief_final?: string | null;
    step_avatar_revised?: string | null;
    step_offer_brief_revised?: string | null;
    step_necessary_beliefs_revised?: string | null;
    scraped_image_urls?: string[] | null;
    approved_image_urls?: string[] | null;
  };

  const existing = await db.execute({
    sql: "SELECT id FROM runs WHERE id = ?",
    args: [Number(id)],
  });
  if (!existing.rows.length) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Handle image_approval requests
  if (body.type === "image_approval") {
    const { approved_urls } = body as { type: string; approved_urls: string[] };
    await db.execute({
      sql: "UPDATE runs SET approved_image_urls = ? WHERE id = ?",
      args: [JSON.stringify(approved_urls), Number(id)],
    });
    return Response.json({ success: true });
  }

  // Handle field_edit requests
  if (body.type === "field_edit") {
    const { field, value, stage } = body as { type: string; field: string; value: string; stage: string };
    if (!EDITABLE_FIELDS.includes(field as typeof EDITABLE_FIELDS[number])) {
      return Response.json({ error: "Unknown field" }, { status: 400 });
    }
    const editedCol = `${field}_edited`;
    const editedAtCol = `${stage}_edited_at`;
    const ts = new Date().toISOString();
    await db.execute({
      sql: `UPDATE runs SET ${editedCol} = ?, ${editedAtCol} = ? WHERE id = ?`,
      args: [value, ts, Number(id)],
    });
    return Response.json({ success: true });
  }

  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if ("feedback_stage1" in body)  { fields.push("feedback_stage1 = ?");  values.push(body.feedback_stage1 ?? null); }
  if ("feedback_stage2" in body)  { fields.push("feedback_stage2 = ?");  values.push(body.feedback_stage2 ?? null); }
  if ("feedback_stage3" in body)  { fields.push("feedback_stage3 = ?");  values.push(body.feedback_stage3 ?? null); }
  if ("feedback_stage1_note" in body) { fields.push("feedback_stage1_note = ?"); values.push(body.feedback_stage1_note ?? null); }
  if ("feedback_stage2_note" in body) { fields.push("feedback_stage2_note = ?"); values.push(body.feedback_stage2_note ?? null); }
  if ("feedback_stage3_note" in body) { fields.push("feedback_stage3_note = ?"); values.push(body.feedback_stage3_note ?? null); }
  if ("notes" in body)            { fields.push("notes = ?");            values.push(body.notes ?? null); }
  if ("stage2_output" in body)    { fields.push("stage2_output = ?");    values.push(body.stage2_output ?? null); }
  if ("stage3_prompts" in body)   { fields.push("stage3_prompts = ?");   values.push(body.stage3_prompts ? JSON.stringify(body.stage3_prompts) : null); }
  if ("image_urls" in body)       { fields.push("image_urls = ?");       values.push(body.image_urls ? JSON.stringify(body.image_urls) : null); }
  if ("status" in body)           { fields.push("status = ?");           values.push(body.status ?? null); }
  if ("image_prompts" in body)    { fields.push("image_prompts = ?");    values.push(body.image_prompts ?? null); }
  if ("generated_images" in body) { fields.push("generated_images = ?"); values.push(body.generated_images ?? null); }
  if ("audit_results" in body)    { fields.push("audit_results = ?");    values.push(body.audit_results ?? null); }
  if ("prompt_edits_made" in body)     { fields.push("prompt_edits_made = ?");      values.push(body.prompt_edits_made ?? null); }
  if ("uploaded_image_count" in body)   { fields.push("uploaded_image_count = ?");    values.push(body.uploaded_image_count ?? null); }
  if ("scraped_image_urls" in body)     { fields.push("scraped_image_urls = ?");      values.push(body.scraped_image_urls ? JSON.stringify(body.scraped_image_urls) : null); }
  if ("approved_image_urls" in body)    { fields.push("approved_image_urls = ?");     values.push(body.approved_image_urls ? JSON.stringify(body.approved_image_urls) : null); }
  if ("product_name" in body)                 { fields.push("product_name = ?");                 values.push(body.product_name ?? null); }
  if ("brand_name" in body)                   { fields.push("brand_name = ?");                   values.push(body.brand_name ?? null); }
  if ("revised_steps" in body)                { fields.push("revised_steps = ?");                values.push(body.revised_steps ? JSON.stringify(body.revised_steps) : null); }
  if ("step_research" in body)                { fields.push("step_research = ?");                values.push(body.step_research ?? null); }
  if ("step_chief_mid" in body)               { fields.push("step_chief_mid = ?");               values.push(body.step_chief_mid ?? null); }
  if ("step_research_revised" in body)        { fields.push("step_research_revised = ?");        values.push(body.step_research_revised ?? null); }
  if ("step_avatar" in body)                  { fields.push("step_avatar = ?");                  values.push(body.step_avatar ?? null); }
  if ("step_offer_brief" in body)             { fields.push("step_offer_brief = ?");             values.push(body.step_offer_brief ?? null); }
  if ("step_necessary_beliefs" in body)       { fields.push("step_necessary_beliefs = ?");       values.push(body.step_necessary_beliefs ?? null); }
  if ("step_chief_final" in body)             { fields.push("step_chief_final = ?");             values.push(body.step_chief_final ?? null); }
  if ("step_avatar_revised" in body)          { fields.push("step_avatar_revised = ?");          values.push(body.step_avatar_revised ?? null); }
  if ("step_offer_brief_revised" in body)     { fields.push("step_offer_brief_revised = ?");     values.push(body.step_offer_brief_revised ?? null); }
  if ("step_necessary_beliefs_revised" in body){ fields.push("step_necessary_beliefs_revised = ?");values.push(body.step_necessary_beliefs_revised ?? null); }

  if (fields.length === 0) {
    return Response.json({ success: true });
  }

  await db.execute({
    sql: `UPDATE runs SET ${fields.join(", ")} WHERE id = ?`,
    args: [...values, Number(id)],
  });

  // Mirror feedback writes into the durable feedback_notes table so they
  // outlive the run. Each stage's vote and note are tracked independently;
  // pass `undefined` to upsertFeedbackNote to leave the unspecified field
  // alone (i.e. don't clobber the note when only the vote changed).
  const runId = Number(id);
  const mirrors: Array<{ stage: FeedbackStage; voteKey: string; noteKey: string }> = [
    { stage: 1, voteKey: "feedback_stage1", noteKey: "feedback_stage1_note" },
    { stage: 2, voteKey: "feedback_stage2", noteKey: "feedback_stage2_note" },
    { stage: 3, voteKey: "feedback_stage3", noteKey: "feedback_stage3_note" },
  ];
  for (const m of mirrors) {
    const voteTouched = m.voteKey in body;
    const noteTouched = m.noteKey in body;
    if (!voteTouched && !noteTouched) continue;
    await upsertFeedbackNote(runId, m.stage, {
      vote: voteTouched ? ((body as Record<string, string | null | undefined>)[m.voteKey] ?? null) : undefined,
      note: noteTouched ? ((body as Record<string, string | null | undefined>)[m.noteKey] ?? null) : undefined,
    }).catch((err) => {
      // Feedback mirroring must never break the user-facing PATCH.
      console.error("[feedback_notes] mirror failed:", err);
    });
  }

  return Response.json({ success: true });
}
