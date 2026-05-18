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
      product_url TEXT NOT NULL,
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
  ];
  for (const col of newColumns) {
    try {
      await db.execute(`ALTER TABLE runs ADD COLUMN ${col}`);
    } catch { /* column already exists — safe to ignore */ }
  }
}

// Initialize schema on module load
initDB().then(() => migrateDB()).catch(console.error);

export interface Run {
  id: number;
  created_at: string;
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
}
