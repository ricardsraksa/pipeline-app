import { NextRequest } from "next/server";
import { db, detachRunFeedback, upsertFeedbackNote, type FeedbackStage } from "@/lib/db";
import type { Run } from "@/lib/db";
import { structureStage2Copy } from "@/lib/stage2/format";

import { requireSession } from "@/lib/auth";
import { assertPublicUrl } from "@/lib/ssrf";
// A stage2_copy edit re-derives the structured JSON via a (small) model call,
// so this route needs more than the default budget.
export const maxDuration = 120;

// Every stored image URL must be public https; reject anything else so a
// poisoned row can't later steer a server-side fetch at an internal host.
async function assertImageUrls(urls: unknown[]): Promise<void> {
  if (urls.length > 200) throw new Error("Too many image URLs");
  for (const u of urls) {
    if (typeof u !== "string" || u.length > 2048) throw new Error("Image URLs must be strings");
    if (!u.startsWith("https://")) throw new Error(`Image URL must be https: ${u.slice(0, 80)}`);
    await assertPublicUrl(u);
  }
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<unknown> }
) {
  const denied = requireSession(_req);
  if (denied) return denied;
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
  const denied = requireSession(_req);
  if (denied) return denied;
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
  const denied = requireSession(req);
  if (denied) return denied;
  const { id } = (await context.params) as { id: string };
  const rawBody = await req.text();
  if (rawBody.length > 2_000_000) return Response.json({ error: "Payload too large" }, { status: 413 });
  const body = JSON.parse(rawBody) as { type?: string } & {
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
    // Hero-first Stage 3
    stage3_hero_prompt_edited?: string | null;
    stage3_remaining_prompts?: string | null;
    stage3_remaining_prompts_edited?: string | null;
    stage3_remaining_images?: string | null;
    stage3_reference_images?: string | null;
    stage3_source_blacklist?: string | null;
    stage3_ref_overrides?: string | null;
    product_code?: string | null;
  };

  const existing = await db.execute({
    sql: "SELECT id FROM runs WHERE id = ?",
    args: [Number(id)],
  });
  if (!existing.rows.length) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Image URL fields are later fed to the vision model, Higgsfield import,
  // Shopify and Drive — everything stored here must be a public https URL.
  try {
    if (body.type === "stage3_image_upsert") {
      const img = (body as { image?: { image_url?: unknown } }).image;
      if (img && img.image_url != null) await assertImageUrls([img.image_url]);
    }
    if (typeof body.stage3_remaining_images === "string") {
      const parsed = JSON.parse(body.stage3_remaining_images);
      if (!Array.isArray(parsed)) throw new Error("stage3_remaining_images must be an array");
      await assertImageUrls(parsed.map((x: { image_url?: unknown }) => x?.image_url).filter((u) => u != null));
    }
    if (typeof body.stage3_reference_images === "string") {
      const parsed = JSON.parse(body.stage3_reference_images);
      if (!Array.isArray(parsed)) throw new Error("stage3_reference_images must be an array");
      await assertImageUrls(parsed);
    }
    if (Array.isArray(body.image_urls)) await assertImageUrls(body.image_urls);
    if (Array.isArray(body.approved_image_urls)) await assertImageUrls(body.approved_image_urls);
    if (Array.isArray(body.scraped_image_urls)) await assertImageUrls(body.scraped_image_urls);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Invalid image URL" }, { status: 400 });
  }

  // Merge a single Stage 3 image into stage3_remaining_images server-side.
  // Read-modify-write here (instead of the client overwriting the whole array)
  // makes per-image saves durable mid-generation and prevents two tabs / two
  // in-flight regenerations from clobbering each other with stale snapshots.
  if (body.type === "stage3_image_upsert") {
    const { image } = body as { type: string; image?: { index?: number } & Record<string, unknown> };
    if (!image || typeof image.index !== "number") {
      return Response.json({ error: "image with numeric index required" }, { status: 400 });
    }
    // Read-modify-write via plain db.execute — the same reliable path every
    // other write uses. The previous db.transaction("write") (interactive
    // transaction) proved unreliable against the remote database: writes failed
    // silently, so generated images never persisted and every run stalled at
    // awaiting_qc with an empty stage3_remaining_images. Generation runs a few
    // images at once, so two saves can race and one lost update is possible; the
    // client's authoritative full-array write on completion self-heals that.
    let images: Array<{ index?: number }> = [];
    for (let attempt = 0; ; attempt++) {
      try {
        const row = await db.execute({
          sql: "SELECT stage3_remaining_images FROM runs WHERE id = ?",
          args: [Number(id)],
        });
        let arr: Array<{ index?: number }> = [];
        try {
          const raw = (row.rows[0] as unknown as { stage3_remaining_images: string | null })?.stage3_remaining_images;
          const parsed = raw ? JSON.parse(raw) : [];
          if (Array.isArray(parsed)) arr = parsed;
        } catch { /* treat unparseable as empty */ }
        const i = arr.findIndex((x) => x?.index === image.index);
        if (i >= 0) arr[i] = image;
        else { arr.push(image); arr.sort((a, b) => (a.index ?? 0) - (b.index ?? 0)); }
        await db.execute({
          sql: "UPDATE runs SET stage3_remaining_images = ?, last_updated_at = ? WHERE id = ?",
          args: [JSON.stringify(arr), new Date().toISOString(), Number(id)],
        });
        images = arr;
        break;
      } catch (e) {
        const busy = e instanceof Error && /SQLITE_BUSY|database is locked/i.test(e.message);
        if (busy && attempt < 4) { await new Promise((r) => setTimeout(r, 50 * (attempt + 1))); continue; }
        throw e;
      }
    }
    return Response.json({ success: true, images });
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
    if (typeof value === "string" && value.length > 200_000) {
      return Response.json({ error: "Edited value too long (max 200,000 characters)" }, { status: 413 });
    }
    // `stage` is interpolated into the column name — whitelist it so a
    // malformed (or malicious) value can't inject SQL.
    if (!["stage1", "stage2", "stage3"].includes(stage)) {
      return Response.json({ error: "Unknown stage" }, { status: 400 });
    }
    const editedCol = `${field}_edited`;
    const editedAtCol = `${stage}_edited_at`;
    const ts = new Date().toISOString();
    // Snapshot the pre-save Stage 2 text so the re-structuring below can skip
    // its (billed) Haiku call when a Save click didn't actually change anything.
    let stage2TextUnchanged = false;
    if (field === "stage2_copy" && typeof value === "string") {
      try {
        const prev = await db.execute({
          sql: "SELECT stage2_copy_edited, stage2_output FROM runs WHERE id = ?",
          args: [Number(id)],
        });
        const prevRow = prev.rows[0] as unknown as { stage2_copy_edited: string | null; stage2_output: string | null } | undefined;
        const prevText = prevRow?.stage2_copy_edited ?? prevRow?.stage2_output ?? "";
        stage2TextUnchanged = prevText.trim() === value.trim();
      } catch { /* on any doubt, re-structure */ }
    }
    await db.execute({
      sql: `UPDATE runs SET ${editedCol} = ?, ${editedAtCol} = ? WHERE id = ?`,
      args: [value, ts, Number(id)],
    });

    // Editing the Stage 2 copy must also refresh the structured JSON — it's what
    // the per-field Copy tab renders, and it was previously derived once at
    // generation time, so edits never reached it. Re-derive from the edited text
    // (cheap mechanical model, same helper the generate/regenerate paths use).
    // Best-effort: the free text stays canonical, so a failure here never fails
    // the save — the Copy tab just keeps showing the previous structure.
    if (field === "stage2_copy" && typeof value === "string" && value.trim() && !stage2TextUnchanged) {
      try {
        const structured = await structureStage2Copy(value, Number(id));
        if (structured) {
          await db.execute({
            sql: "UPDATE runs SET stage2_json = ? WHERE id = ?",
            args: [JSON.stringify(structured), Number(id)],
          });
        }
      } catch (err) {
        console.error(`[field_edit] re-structuring stage2_json for run ${id} failed:`, err);
      }
    }
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
  if ("stage3_hero_prompt_edited" in body)        { fields.push("stage3_hero_prompt_edited = ?");        values.push(body.stage3_hero_prompt_edited ?? null); }
  if ("stage3_remaining_prompts" in body)         { fields.push("stage3_remaining_prompts = ?");         values.push(body.stage3_remaining_prompts ?? null); }
  if ("stage3_remaining_prompts_edited" in body)  { fields.push("stage3_remaining_prompts_edited = ?");  values.push(body.stage3_remaining_prompts_edited ?? null); }
  if ("stage3_remaining_images" in body)          { fields.push("stage3_remaining_images = ?");          values.push(body.stage3_remaining_images ?? null); }
  if ("stage3_reference_images" in body) {
    // Validate on write: these URLs later feed server-side generation fetches.
    const raw = body.stage3_reference_images;
    if (raw !== null && raw !== undefined) {
      let arr: unknown;
      try { arr = JSON.parse(String(raw)); } catch { return Response.json({ error: "stage3_reference_images must be JSON" }, { status: 400 }); }
      if (!Array.isArray(arr) || arr.length > 20 || !arr.every((u) => typeof u === "string" && /^https:\/\//.test(u) && u.length < 2048)) {
        return Response.json({ error: "stage3_reference_images must be an array of https URLs" }, { status: 400 });
      }
    }
    fields.push("stage3_reference_images = ?");
    values.push(raw ?? null);
  }
  if ("stage3_source_blacklist" in body)          { fields.push("stage3_source_blacklist = ?");          values.push(body.stage3_source_blacklist ?? null); }
  if ("stage3_ref_overrides" in body)             { fields.push("stage3_ref_overrides = ?");             values.push(body.stage3_ref_overrides ?? null); }
  if ("product_code" in body)                     { fields.push("product_code = ?");                     values.push(body.product_code?.toString().trim() || null); }

  if (fields.length === 0) {
    return Response.json({ success: true });
  }

  // Reject oversized payloads before they hit the DB. 500K covers the largest
  // legitimate write (a full Stage 2 copy kit / serialized prompt array) with
  // headroom; anything past it is abuse, not data.
  if (values.some((v) => typeof v === "string" && v.length > 500_000)) {
    return Response.json({ error: "Field value too long" }, { status: 413 });
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
