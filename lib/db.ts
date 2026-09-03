import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  throw new Error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN env vars");
}

export const db = createClient({ url, authToken });

export async function initDB() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      product_url TEXT,
      product_name TEXT NOT NULL,
      stage1_output TEXT,
      stage2_output TEXT,
      stage3_prompts TEXT,
      image_urls TEXT,
      feedback_stage1 TEXT,
      feedback_stage2 TEXT,
      feedback_stage3 TEXT,
      notes TEXT,
      product_description TEXT,
      competitor_urls TEXT,
      scraper_data TEXT,
      step_research TEXT,
      step_chief_mid TEXT,
      step_research_revised TEXT,
      step_avatar TEXT,
      step_offer_brief TEXT,
      step_necessary_beliefs TEXT,
      step_chief_final TEXT,
      step_avatar_revised TEXT,
      step_offer_brief_revised TEXT,
      step_necessary_beliefs_revised TEXT,
      brand_name TEXT,
      status TEXT,
      revised_steps TEXT,
      image_prompts TEXT,
      generated_images TEXT,
      audit_results TEXT,
      prompt_edits_made INTEGER
    )
  `);
  // Generic key/value store — used for the rotating Higgsfield MCP OAuth tokens.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS app_kv (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT
    )
  `);
  // Durable feedback log. Rows are mirrored from the runs.feedback_stage{1,2,3}_*
  // columns whenever a vote or note is saved. They outlive the source run (when
  // a run is deleted, source_run_id is set to NULL, but product_name / brand_name
  // snapshots stay so the prompt-builder can still attribute the note).
  await db.execute(`
    CREATE TABLE IF NOT EXISTS feedback_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_run_id INTEGER,
      stage INTEGER NOT NULL,
      vote TEXT,
      note TEXT,
      product_name TEXT,
      brand_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  // SQLite allows multiple NULLs in a unique index, which is exactly what we
  // want post-deletion: each delete-orphaned row keeps its own identity.
  await db.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_notes_run_stage
       ON feedback_notes(source_run_id, stage)`,
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_feedback_notes_stage_updated
       ON feedback_notes(stage, updated_at DESC)`,
  );
}

async function migrateDB() {
  const newColumns = [
    "stage1_research_edited TEXT",
    "stage1_chief_mid_edited TEXT",
    "stage1_avatar_edited TEXT",
    "stage1_offer_brief_edited TEXT",
    "stage1_necessary_beliefs_edited TEXT",
    "stage1_chief_final_edited TEXT",
    "stage1_avatar_revised_edited TEXT",
    "stage1_offer_brief_revised_edited TEXT",
    "stage1_necessary_beliefs_revised_edited TEXT",
    "stage2_copy_edited TEXT",
    "stage3_image_prompts_edited TEXT",
    "stage1_edited_at TEXT",
    "stage2_edited_at TEXT",
    "stage3_edited_at TEXT",
    "uploaded_image_count INTEGER DEFAULT 0",
    "scraped_image_urls TEXT",
    "approved_image_urls TEXT",
    // Pipeline execution tracking
    "current_step TEXT",
    "started_at TEXT",
    "last_updated_at TEXT",
    "completed_at TEXT",
    "error_message TEXT",
    // Stage 1 one-pager synthesis (the only Stage 1 output shown to user)
    "stage1_one_pager TEXT",
    "stage1_one_pager_edited TEXT",
    "stage1_one_pager_edited_at TEXT",
    // Source images: user-uploaded reference photos that drive Stage 1 vision
    "uploaded_source_images TEXT",
    // Free-text feedback notes alongside the thumbs vote per stage.
    "feedback_stage1_note TEXT",
    "feedback_stage2_note TEXT",
    "feedback_stage3_note TEXT",
    // ── Hero-first Stage 3 (two-phase) ────────────────────────────────────
    // Phase 1: one hero studio shot generated from the SOURCE product photos.
    "stage3_hero_prompt TEXT",
    "stage3_hero_prompt_edited TEXT",
    "stage3_hero_image_url TEXT",
    "stage3_hero_approved INTEGER DEFAULT 0",
    // Phase 2: the 8 derivative prompts/images, all referencing the approved hero.
    "stage3_remaining_prompts TEXT",
    "stage3_remaining_prompts_edited TEXT",
    "stage3_remaining_images TEXT",
    // Extra reference images the operator adds during Stage 3. The prompt writer
    // sees them and chooses per image which to attach to Higgsfield (via each
    // prompt's source_image_references). JSON array of R2 URLs.
    "stage3_reference_images TEXT",
    // Source photos the operator EXCLUDED from Stage 3 reference use (JSON
    // array of URLs). Uploads default to included; this is the blacklist.
    "stage3_source_blacklist TEXT",
    // Per-image reference overrides for the 8 derivative images: JSON object
    // { "<prompt index>": [urls] }. When set for an index, generation uses
    // exactly those references instead of the prompt's curated defaults.
    "stage3_ref_overrides TEXT",
    // AI placement: which image anchors each of the 3 body sections; the rest
    // are top-of-page product shots. JSON { section_1, section_2, section_3, reasons }.
    "stage3_placement TEXT",
    // Operator-assigned product code (free text, e.g. "P50") to cross-reference
    // an external product sheet.
    "product_code TEXT",
    // Structured (JSON) form of the Stage 2 copy kit, derived from stage2_output
    // for the per-field copy UI. The free text stays canonical.
    "stage2_json TEXT",
    // Format-validation results for the Stage 3 prompt generations. JSON
    // Stage3Validation: {"passed":true} or {"passed":false,"errors":[...],"retried":true}.
    // Informational only — the QC gates never block on these.
    "stage3_hero_validation TEXT",
    "stage3_remaining_validation TEXT",
    // Snapshot of the exact system prompt(s) used when each stage ran. JSON
    // object keyed by stage ("stage1", "stage2", "stage3_hero",
    // "stage3_remaining") → the full resolved prompt text (Settings override or
    // default, plus any feedback suffix). Recorded at execution time so a run
    // remains auditable after defaults/overrides change.
    "prompts_used TEXT",
    // Google Doc export bookkeeping: when the Stage 2 copy kit was appended to
    // the master doc (appends are not idempotent, so this gates re-sends).
    "gdoc_appended_at TEXT",
    "gdoc_append_error TEXT",
    // Shopify fill bookkeeping: which product this run last pushed to and
    // which image URLs were already appended (re-push dedupe).
    "shopify_push_state TEXT",
    // ── Stage 1 · Product (scrapling + analyst description) ──────────────
    // JSON ProductScrape: { product, competitors[], errors[], scraped_at, source }
    "product_scrape TEXT",
    // The analyst model's 120-word description, and the operator's edit of it.
    "product_description_ai TEXT",
    "product_description_edited TEXT",
    // JSON array of image URLs the operator ticked at the Stage 1 gate.
    "product_selected_images TEXT",
    "product_approved_at TEXT",
    // ── Angles gate (after Research, before Copy) ──────────────────────────
    // JSON Angle[] proposed by the strategist, and the operator's pick (JSON
    // Angle, possibly edited). Copy + Images build around the pick.
    "product_angles TEXT",
    "product_angle_selected TEXT",
    // Stage 4 prompt history: JSON { "<image index>": [{ prompt, at, source }] },
    // newest first. Every edit and AI rewrite pushes the PREVIOUS text here, so
    // an operator can always get back to what the writer produced.
    "stage3_prompt_history TEXT",
    // The Shopify product this run fills. Settable at any point in the run
    // (rail → Deliver), read by the fill panel as its default.
    "shopify_product_url TEXT",
    // Stage 3 Pricing card: JSON ProductPricing (lib/pricing.ts). Display only.
    "product_pricing TEXT",
    // Set when the operator asks the Mac worker to re-read the listing's
    // options + per-SKU prices; cleared by scrape-push mode=variants.
    "variants_refresh_requested TEXT",
  ];
  for (const col of newColumns) {
    try {
      await db.execute(`ALTER TABLE runs ADD COLUMN ${col}`);
    } catch { /* column already exists — safe to ignore */ }
  }

  // Cost tracker: one row per Anthropic API call. Usage numbers come free in
  // every API response — recording them costs nothing extra.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS api_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER,
      label TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_api_usage_run ON api_usage(run_id)`,
  );
}

// ── DB helper functions ───────────────────────────────────────────────────────

// Lightweight row shape for the history list — no heavy text fields, so loading
// is fast even with hundreds of runs in the DB.
export interface RunSummary {
  id: number;
  created_at: string;
  product_url: string | null;
  product_name: string | null;
  brand_name: string | null;
  status: string | null;
  current_step: string | null;
  last_updated_at: string | null;
  doc_count: number;
  /** Generated Stage 3 hero image, used as the list thumbnail when present. */
  stage3_hero_image_url: string | null;
  /** JSON array of uploaded source image URLs — thumbnail fallback. */
  uploaded_source_images: string | null;
  /** Operator-assigned product code (e.g. "P50"). */
  product_code: string | null;
}

export async function listRuns(): Promise<RunSummary[]> {
  // Pull just the fields the list view needs. doc_count is computed from
  // CASE-WHEN-NOT-NULL across the step fields so we don't ship MBs of text.
  const result = await db.execute(`
    SELECT
      id, created_at, product_url, product_name, brand_name, status,
      current_step, last_updated_at, stage3_hero_image_url, uploaded_source_images,
      product_code,
      (
        (CASE WHEN step_research              IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN step_chief_mid             IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN step_research_revised      IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN step_avatar                IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN step_offer_brief           IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN step_necessary_beliefs     IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN step_chief_final           IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN step_avatar_revised        IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN step_offer_brief_revised   IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN step_necessary_beliefs_revised IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN stage1_one_pager           IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN stage2_output              IS NOT NULL THEN 1 ELSE 0 END)
      ) AS doc_count
    FROM runs
    ORDER BY created_at DESC
  `);
  return result.rows as unknown as RunSummary[];
}

export async function getRun(id: number): Promise<Run | null> {
  const result = await db.execute({ sql: "SELECT * FROM runs WHERE id = ?", args: [id] });
  if (!result.rows.length) return null;
  return result.rows[0] as unknown as Run;
}

export async function createRun(data: {
  /** Optional in the new description-first flow. Stored as "" when absent so we
   *  remain compatible with existing tables that still have a NOT NULL constraint. */
  product_url?: string | null;
  product_name?: string;
  product_description?: string | null;
  competitor_urls?: string[] | null;
  uploaded_source_images?: string[] | null;
  product_code?: string | null;
  status?: string;
}): Promise<number> {
  const url = data.product_url ?? "";
  // Compute a sensible display name: description excerpt → URL → fallback.
  const fallbackName =
    data.product_description
      ? data.product_description.trim().split(/\s+/).slice(0, 6).join(" ")
      : url || "(unnamed run)";
  const result = await db.execute({
    sql: `INSERT INTO runs (
            created_at, product_url, product_name, product_description,
            competitor_urls, uploaded_source_images, product_code, status,
            started_at, last_updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      new Date().toISOString(),
      url,
      data.product_name ?? fallbackName,
      data.product_description ?? null,
      data.competitor_urls && data.competitor_urls.length ? JSON.stringify(data.competitor_urls) : null,
      data.uploaded_source_images && data.uploaded_source_images.length ? JSON.stringify(data.uploaded_source_images) : null,
      data.product_code?.trim() || null,
      data.status ?? "pending",
      new Date().toISOString(),
      new Date().toISOString(),
    ],
  });
  return Number(result.lastInsertRowid);
}

export async function updateRun(id: number, fields: Partial<Run & { error_message: string | null }>): Promise<void> {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (!entries.length) return;
  const setClauses = entries.map(([k]) => `${k} = ?`).join(", ");
  const values = entries.map(([, v]) => v);
  await db.execute({
    sql: `UPDATE runs SET ${setClauses} WHERE id = ?`,
    args: [...values, id],
  });
}

/**
 * Record the exact system prompt a stage ran with (merged into the run's
 * prompts_used JSON). Best-effort by design: prompt auditing must never fail
 * or slow a run, so errors are logged and swallowed. Stages run sequentially,
 * so the read-modify-write here doesn't race in practice.
 */
export async function recordPromptUsed(
  id: number,
  key: "product" | "stage1" | "angles" | "stage2" | "stage3_hero" | "stage3_remaining",
  prompt: string,
): Promise<void> {
  try {
    const row = await db.execute({ sql: "SELECT prompts_used FROM runs WHERE id = ?", args: [id] });
    let obj: Record<string, string> = {};
    try {
      const raw = (row.rows[0] as unknown as { prompts_used: string | null })?.prompts_used;
      const parsed = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) obj = parsed;
    } catch { /* treat unparseable as empty */ }
    obj[key] = prompt;
    await db.execute({
      sql: "UPDATE runs SET prompts_used = ? WHERE id = ?",
      args: [JSON.stringify(obj), id],
    });
  } catch (err) {
    console.error(`[prompts_used] run ${id} ${key}:`, err);
  }
}

// Loose shape of the SDK's response.usage — field names vary slightly across
// SDK versions, so read defensively.
export interface AnthropicUsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

// Cost tracker insert. Best-effort: a DB hiccup must never fail the API call
// whose usage is being recorded.
export async function recordUsage(
  runId: number | null,
  label: string,
  model: string,
  usage: AnthropicUsageLike | null | undefined,
): Promise<void> {
  if (!usage) return;
  try {
    await db.execute({
      sql: `INSERT INTO api_usage
              (run_id, label, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        runId,
        label,
        model,
        usage.input_tokens ?? 0,
        usage.output_tokens ?? 0,
        usage.cache_read_input_tokens ?? 0,
        usage.cache_creation_input_tokens ?? 0,
        new Date().toISOString(),
      ],
    });
  } catch (err) {
    console.error(`[api_usage] ${label}:`, err);
  }
}

export interface ApiUsageRow {
  id: number;
  run_id: number | null;
  label: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  created_at: string;
}

export async function getUsageForRun(runId: number): Promise<ApiUsageRow[]> {
  const res = await db.execute({
    sql: "SELECT * FROM api_usage WHERE run_id = ? ORDER BY id ASC",
    args: [runId],
  });
  return res.rows as unknown as ApiUsageRow[];
}

// ── Key/value store (Higgsfield MCP OAuth tokens, etc.) ──────────────────────

export async function getKV(key: string): Promise<string | null> {
  const result = await db.execute({ sql: "SELECT value FROM app_kv WHERE key = ?", args: [key] });
  if (!result.rows.length) return null;
  const v = (result.rows[0] as unknown as { value: string | null }).value;
  return v ?? null;
}

export async function setKV(key: string, value: string): Promise<void> {
  await db.execute({
    sql: `INSERT INTO app_kv (key, value, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [key, value, new Date().toISOString()],
  });
}

// ── Durable feedback log ─────────────────────────────────────────────────────

export type FeedbackStage = 1 | 2 | 3;

/**
 * Mirror the run row's feedback into the feedback_notes table.
 * Idempotent — upserts on (source_run_id, stage). Pass undefined to leave a
 * field alone; pass null to clear it. Reading product_name / brand_name from
 * the runs table keeps the snapshot fresh on each write.
 */
export async function upsertFeedbackNote(
  runId: number,
  stage: FeedbackStage,
  fields: { vote?: string | null; note?: string | null },
): Promise<void> {
  const row = await db.execute({
    sql: "SELECT product_name, brand_name FROM runs WHERE id = ?",
    args: [runId],
  });
  if (!row.rows.length) return;
  const productName = (row.rows[0] as unknown as { product_name: string | null }).product_name ?? null;
  const brandName = (row.rows[0] as unknown as { brand_name: string | null }).brand_name ?? null;

  const now = new Date().toISOString();
  // Look up existing row (if any) so we can leave unchanged fields alone.
  const existing = await db.execute({
    sql: "SELECT vote, note FROM feedback_notes WHERE source_run_id = ? AND stage = ?",
    args: [runId, stage],
  });
  const prev = existing.rows[0] as unknown as { vote: string | null; note: string | null } | undefined;

  const nextVote = fields.vote !== undefined ? fields.vote : (prev?.vote ?? null);
  const nextNote = fields.note !== undefined ? fields.note : (prev?.note ?? null);

  // If both are empty, no point persisting an empty row.
  if ((nextVote === null || nextVote === "") && (nextNote === null || nextNote === "")) {
    if (prev) {
      await db.execute({
        sql: "DELETE FROM feedback_notes WHERE source_run_id = ? AND stage = ?",
        args: [runId, stage],
      });
    }
    return;
  }

  await db.execute({
    sql: `INSERT INTO feedback_notes (source_run_id, stage, vote, note, product_name, brand_name, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(source_run_id, stage) DO UPDATE SET
            vote = excluded.vote,
            note = excluded.note,
            product_name = excluded.product_name,
            brand_name = excluded.brand_name,
            updated_at = excluded.updated_at`,
    args: [runId, stage, nextVote, nextNote, productName, brandName, now, now],
  });
}

/**
 * Sever the link between a run and its feedback_notes rows so deleting the
 * run doesn't drop them. The product_name/brand_name snapshot is enough for
 * the prompt builder to keep attributing the note.
 */
export async function detachRunFeedback(runId: number): Promise<void> {
  await db.execute({
    sql: "UPDATE feedback_notes SET source_run_id = NULL WHERE source_run_id = ?",
    args: [runId],
  });
}

// Initialize schema on module load
initDB().then(() => migrateDB()).catch(console.error);

export interface Run {
  id: number;
  created_at: string;
  /** May be empty string when the user didn't supply a URL (description-only flow). */
  product_url: string;
  product_name: string;
  stage1_output: string | null;
  stage2_output: string | null;
  stage3_prompts: string | null;
  image_urls: string | null;
  feedback_stage1: string | null;
  feedback_stage2: string | null;
  feedback_stage3: string | null;
  notes: string | null;
  product_description: string | null;
  competitor_urls: string | null;
  scraper_data: string | null;
  step_research: string | null;
  step_chief_mid: string | null;
  step_research_revised: string | null;
  step_avatar: string | null;
  step_offer_brief: string | null;
  step_necessary_beliefs: string | null;
  step_chief_final: string | null;
  step_avatar_revised: string | null;
  step_offer_brief_revised: string | null;
  step_necessary_beliefs_revised: string | null;
  brand_name: string | null;
  status: string | null;
  revised_steps: string | null;
  image_prompts: string | null;
  generated_images: string | null;
  audit_results: string | null;
  prompt_edits_made: number | null;
  // User-edited versions (null = not yet edited, use original)
  stage1_research_edited: string | null;
  stage1_chief_mid_edited: string | null;
  stage1_avatar_edited: string | null;
  stage1_offer_brief_edited: string | null;
  stage1_necessary_beliefs_edited: string | null;
  stage1_chief_final_edited: string | null;
  stage1_avatar_revised_edited: string | null;
  stage1_offer_brief_revised_edited: string | null;
  stage1_necessary_beliefs_revised_edited: string | null;
  stage2_copy_edited: string | null;
  stage3_image_prompts_edited: string | null;
  stage1_edited_at: string | null;
  stage2_edited_at: string | null;
  stage3_edited_at: string | null;
  uploaded_image_count: number | null;
  scraped_image_urls: string | null;
  approved_image_urls: string | null;
  // Pipeline execution tracking
  current_step: string | null;
  started_at: string | null;
  last_updated_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  // Stage 1 one-pager — the only Stage 1 output the user sees
  stage1_one_pager: string | null;
  stage1_one_pager_edited: string | null;
  stage1_one_pager_edited_at: string | null;
  // JSON array of R2 URLs uploaded by the user at run-start time
  uploaded_source_images: string | null;
  // Free-text feedback notes — saved alongside the thumbs vote
  feedback_stage1_note: string | null;
  feedback_stage2_note: string | null;
  feedback_stage3_note: string | null;
  // Hero-first Stage 3 (two-phase)
  stage3_hero_prompt: string | null;
  stage3_hero_prompt_edited: string | null;
  stage3_hero_image_url: string | null;
  stage3_hero_approved: number | null;
  stage3_remaining_prompts: string | null;
  stage3_remaining_prompts_edited: string | null;
  stage3_remaining_images: string | null;
  stage3_reference_images: string | null;
  stage3_source_blacklist: string | null;
  stage3_ref_overrides: string | null;
  gdoc_appended_at: string | null;
  gdoc_append_error: string | null;
  shopify_push_state: string | null;
  stage3_placement: string | null;
  product_code: string | null;
  stage2_json: string | null;
  // Stage 3 prompt format-validation results (JSON Stage3Validation)
  stage3_hero_validation: string | null;
  stage3_remaining_validation: string | null;
  // JSON: { stage1?, stage2?, stage3_hero?, stage3_remaining? } — the exact
  // system prompt text each stage ran with (see migration comment).
  prompts_used: string | null;
  // Stage 1 · Product
  product_scrape: string | null;
  product_description_ai: string | null;
  product_description_edited: string | null;
  product_selected_images: string | null;
  product_approved_at: string | null;
  // Angles gate
  product_angles: string | null;
  product_angle_selected: string | null;
  stage3_prompt_history: string | null;
  shopify_product_url: string | null;
  product_pricing: string | null;
  variants_refresh_requested: string | null;
}
