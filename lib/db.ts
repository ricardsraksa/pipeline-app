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

// Initialize schema on module load
initDB().catch(console.error);

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
}
