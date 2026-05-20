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
  ];
  for (const col of newColumns) {
    try {
      await db.execute(`ALTER TABLE runs ADD COLUMN ${col}`);
    } catch { /* column already exists — safe to ignore */ }
  }
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
}

export async function listRuns(): Promise<RunSummary[]> {
  // Pull just the fields the list view needs. doc_count is computed from
  // CASE-WHEN-NOT-NULL across the step fields so we don't ship MBs of text.
  const result = await db.execute(`
    SELECT
      id, created_at, product_url, product_name, brand_name, status,
      current_step, last_updated_at,
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
            competitor_urls, uploaded_source_images, status,
            started_at, last_updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      new Date().toISOString(),
      url,
      data.product_name ?? fallbackName,
      data.product_description ?? null,
      data.competitor_urls && data.competitor_urls.length ? JSON.stringify(data.competitor_urls) : null,
      data.uploaded_source_images && data.uploaded_source_images.length ? JSON.stringify(data.uploaded_source_images) : null,
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
}
