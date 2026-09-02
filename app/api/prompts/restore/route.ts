import { NextRequest } from "next/server";
import {
  loadPromptsFile,
  writePromptsFile,
  getHistory,
  pushHistory,
  getCurrentOverride,
  type PromptStage,
} from "@/lib/prompts-store";
import { requireSession } from "@/lib/auth";

const STAGES: PromptStage[] = ["product", "stage1", "angles", "stage2", "stage3"];

// Restore a history entry as the current prompt.
// Body: { stage, index } — index into the history list (0 = newest).
// The current override (if any) is pushed onto history first so nothing is lost.
export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { stage, index } = (await req.json()) as { stage: string; index: number };

  if (!STAGES.includes(stage as PromptStage)) {
    return Response.json({ success: false, error: "Invalid stage" }, { status: 400 });
  }
  if (typeof index !== "number" || index < 0) {
    return Response.json({ success: false, error: "Invalid index" }, { status: 400 });
  }

  const data = await loadPromptsFile();
  const history = getHistory(data, stage as PromptStage);
  const entry = history[index];
  if (!entry) {
    return Response.json({ success: false, error: "History entry not found" }, { status: 404 });
  }

  const current = getCurrentOverride(data, stage as PromptStage);
  if (current && current.prompt !== entry.prompt) {
    pushHistory(data, stage as PromptStage, current);
  }

  // Remove the restored entry from history (re-fetch after potential push).
  const updatedHistory = getHistory(data, stage as PromptStage).slice();
  // Find the entry by (prompt, saved_at) match — index may have shifted by 1 if we pushed.
  const removeAt = updatedHistory.findIndex(
    (h) => h.prompt === entry.prompt && h.saved_at === entry.saved_at,
  );
  if (removeAt >= 0) {
    updatedHistory.splice(removeAt, 1);
    data[`${stage}_history`] = updatedHistory;
  }

  const saved_at = new Date().toISOString();
  data[stage] = entry.prompt;
  data[`${stage}_saved_at`] = saved_at;

  await writePromptsFile(data);

  return Response.json({ success: true, saved_at });
}
