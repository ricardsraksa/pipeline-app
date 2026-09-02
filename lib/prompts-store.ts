// Durable store for user-edited system prompts.
//
// Backed by the Turso `app_kv` table under key "prompts_store" so overrides
// survive Render redeploys (filesystem there is ephemeral). On first read we
// transparently migrate any legacy `data/prompts.json` written by the old
// fs-based store.
//
// Shape (single JSON blob under KV):
//   {
//     "stage1":              "<current override, or absent if reset>",
//     "stage1_saved_at":     "<ISO timestamp>",
//     "stage1_history":      [ { prompt, saved_at }, ... newest first ],
//     ... same for stage2, stage3
//   }
//
// Save → push the previous current (if any, and different) onto history,
//        then store the new prompt as current.
// Reset → push the current onto history, then unset the current. Nothing is
//         lost: it can be brought back from the history list via /restore.

import fs from "fs";
import path from "path";
import { getKV, setKV } from "./db";

const KV_KEY = "prompts_store";
const LEGACY_PATH = path.join(process.cwd(), "data", "prompts.json");
const HISTORY_LIMIT = 20;

export type PromptStage = "product" | "stage1" | "angles" | "stage2" | "stage3";

export interface PromptHistoryEntry {
  prompt: string;
  saved_at: string;
}

export type PromptsFile = Record<string, unknown>;

let migrated = false;

async function migrateLegacy(): Promise<void> {
  if (migrated) return;
  migrated = true;
  // If KV already has data, never overwrite it from disk.
  try {
    const existing = await getKV(KV_KEY);
    if (existing) return;
    if (!fs.existsSync(LEGACY_PATH)) return;
    const raw = fs.readFileSync(LEGACY_PATH, "utf-8");
    JSON.parse(raw); // validate
    await setKV(KV_KEY, raw);
  } catch {
    // Migration is best-effort.
  }
}

export async function loadPromptsFile(): Promise<PromptsFile> {
  await migrateLegacy();
  try {
    const raw = await getKV(KV_KEY);
    if (raw) return JSON.parse(raw) as PromptsFile;
  } catch {
    /* fall through to empty */
  }
  return {};
}

export async function writePromptsFile(data: PromptsFile): Promise<void> {
  await setKV(KV_KEY, JSON.stringify(data));
}

export function getHistory(data: PromptsFile, stage: PromptStage): PromptHistoryEntry[] {
  const v = data[`${stage}_history`];
  return Array.isArray(v) ? (v as PromptHistoryEntry[]) : [];
}

export function pushHistory(
  data: PromptsFile,
  stage: PromptStage,
  entry: PromptHistoryEntry,
): void {
  const existing = getHistory(data, stage);
  data[`${stage}_history`] = [entry, ...existing].slice(0, HISTORY_LIMIT);
}

export function getCurrentOverride(
  data: PromptsFile,
  stage: PromptStage,
): { prompt: string; saved_at: string } | null {
  const prompt = data[stage];
  if (typeof prompt !== "string") return null;
  const saved_at = data[`${stage}_saved_at`];
  return {
    prompt,
    saved_at: typeof saved_at === "string" ? saved_at : new Date().toISOString(),
  };
}
