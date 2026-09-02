import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { PRODUCT_PROMPT, STAGE1_PROMPT, ANGLES_PROMPT, STAGE2_PROMPT, STAGE3_PROMPT, getPrompt } from "@/lib/prompts";
import {
  loadPromptsFile,
  writePromptsFile,
  getHistory,
  pushHistory,
  getCurrentOverride,
  type PromptStage,
} from "@/lib/prompts-store";

const STAGES: PromptStage[] = ["product", "stage1", "angles", "stage2", "stage3"];

export async function GET(req: Request) {
  const denied = requireSession(req); if (denied) return denied;
  const data = await loadPromptsFile();
  const [product, stage1, angles, stage2, stage3] = await Promise.all([
    getPrompt("product"),
    getPrompt("stage1"),
    getPrompt("angles"),
    getPrompt("stage2"),
    getPrompt("stage3"),
  ]);
  return Response.json({
    product,
    stage1,
    angles,
    stage2,
    stage3,
    defaults: {
      product: PRODUCT_PROMPT,
      stage1: STAGE1_PROMPT,
      angles: ANGLES_PROMPT,
      stage2: STAGE2_PROMPT,
      stage3: STAGE3_PROMPT,
    },
    saved_at: {
      product: getCurrentOverride(data, "product")?.saved_at ?? null,
      stage1: getCurrentOverride(data, "stage1")?.saved_at ?? null,
      angles: getCurrentOverride(data, "angles")?.saved_at ?? null,
      stage2: getCurrentOverride(data, "stage2")?.saved_at ?? null,
      stage3: getCurrentOverride(data, "stage3")?.saved_at ?? null,
    },
    history: {
      product: getHistory(data, "product"),
      stage1: getHistory(data, "stage1"),
      angles: getHistory(data, "angles"),
      stage2: getHistory(data, "stage2"),
      stage3: getHistory(data, "stage3"),
    },
  });
}

export async function PUT(req: NextRequest) {
  const denied = requireSession(req); if (denied) return denied;
  const { stage, prompt } = (await req.json()) as { stage: string; prompt: string };

  if (!STAGES.includes(stage as PromptStage)) {
    return Response.json({ success: false, error: "Invalid stage" }, { status: 400 });
  }
  if (typeof prompt !== "string" || !prompt.trim()) {
    return Response.json({ success: false, error: "Prompt required" }, { status: 400 });
  }

  const data = await loadPromptsFile();
  const previous = getCurrentOverride(data, stage as PromptStage);

  // Stash the previous current onto history (only if it differs from the new value).
  if (previous && previous.prompt !== prompt) {
    pushHistory(data, stage as PromptStage, {
      prompt: previous.prompt,
      saved_at: previous.saved_at,
    });
  }

  const saved_at = new Date().toISOString();
  data[stage] = prompt;
  data[`${stage}_saved_at`] = saved_at;

  await writePromptsFile(data);

  return Response.json({ success: true, saved_at });
}

export async function DELETE(req: NextRequest) {
  const denied = requireSession(req); if (denied) return denied;
  const { stage } = (await req.json()) as { stage: string };

  if (!STAGES.includes(stage as PromptStage)) {
    return Response.json({ success: false, error: "Invalid stage" }, { status: 400 });
  }

  const data = await loadPromptsFile();
  const current = getCurrentOverride(data, stage as PromptStage);

  // Reset means "stop using my override," but we never lose what was there:
  // push the current onto history before unsetting.
  if (current) {
    pushHistory(data, stage as PromptStage, current);
  }

  delete data[stage];
  delete data[`${stage}_saved_at`];

  await writePromptsFile(data);

  return Response.json({ success: true });
}
