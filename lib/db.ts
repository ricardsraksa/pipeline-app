import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "runs.db");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.exec(`
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
        notes TEXT
      );
    `);

    // Migration: add new columns if they don't exist
    const existingColumns = (_db.prepare("PRAGMA table_info(runs)").all() as { name: string }[]).map(
      (c) => c.name
    );

    const newColumns: [string, string][] = [
      ["product_description", "TEXT"],
      ["competitor_urls", "TEXT"],
      ["scraper_data", "TEXT"],
      ["step_research", "TEXT"],
      ["step_chief_mid", "TEXT"],
      ["step_research_revised", "TEXT"],
      ["step_avatar", "TEXT"],
      ["step_offer_brief", "TEXT"],
      ["step_necessary_beliefs", "TEXT"],
      ["step_chief_final", "TEXT"],
      ["step_avatar_revised", "TEXT"],
      ["step_offer_brief_revised", "TEXT"],
      ["step_necessary_beliefs_revised", "TEXT"],
      ["brand_name", "TEXT"],
      ["status", "TEXT"],
      ["revised_steps", "TEXT"],
      ["image_prompts", "TEXT"],
    ];

    for (const [colName, colType] of newColumns) {
      if (!existingColumns.includes(colName)) {
        _db.exec(`ALTER TABLE runs ADD COLUMN ${colName} ${colType}`);
      }
    }
  }
  return _db;
}

export default getDb;

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
  // New fields
  product_description: string | null;
  competitor_urls: string | null;       // JSON array of URL strings
  scraper_data: string | null;          // JSON: { scraped_text: string, images: string[] }
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
  revised_steps: string | null;         // JSON array of step numbers
  image_prompts: string | null;         // JSON, future-ready
}
