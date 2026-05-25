// Disk-backed store for user-edited system prompts.
//
// Shape on disk (data/prompts.json):
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

const DATA_DIR = path.join(process.cwd(), "data");
const PROMPTS_PATH = path.join(DATA_DIR, "prompts.json");
const HISTORY_LIMIT = 20;

export type PromptStage = "stage1" | "stage2" | "stage3";

export interface PromptHistoryEntry {
  prompt: string;
  saved_at: string;
}

export type PromptsFile = Record<string, unknown>;

export function loadPromptsFile(): PromptsFile {
  try {
    if (fs.existsSync(PROMPTS_PATH)) {
      return JSON.parse(fs.readFileSync(PROMPTS_PATH, "utf-8")) as PromptsFile;
    }
  } catch { /* fall through */ }
  return {};
}

export function writePromptsFile(data: PromptsFile): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PROMPTS_PATH, JSON.stringify(data, null, 2), "utf-8");
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
