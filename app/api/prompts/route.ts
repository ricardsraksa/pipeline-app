import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { STAGE1_PROMPT, STAGE2_PROMPT, STAGE3_PROMPT, getPrompt } from "@/lib/prompts";

const DATA_DIR = path.join(process.cwd(), "data");
const PROMPTS_PATH = path.join(DATA_DIR, "prompts.json");

export async function GET() {
  return Response.json({
    stage1: getPrompt("stage1"),
    stage2: getPrompt("stage2"),
    stage3: getPrompt("stage3"),
    defaults: {
      stage1: STAGE1_PROMPT,
      stage2: STAGE2_PROMPT,
      stage3: STAGE3_PROMPT,
    },
  });
}

export async function PUT(req: NextRequest) {
  const { stage, prompt } = await req.json() as { stage: string; prompt: string };

  if (!["stage1", "stage2", "stage3"].includes(stage)) {
    return Response.json({ success: false, error: "Invalid stage" }, { status: 400 });
  }
  if (typeof prompt !== "string" || !prompt.trim()) {
    return Response.json({ success: false, error: "Prompt required" }, { status: 400 });
  }

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  let current: Record<string, string> = {};
  try {
    if (fs.existsSync(PROMPTS_PATH)) {
      current = JSON.parse(fs.readFileSync(PROMPTS_PATH, "utf-8"));
    }
  } catch {
    current = {};
  }

  current[stage] = prompt;
  current[`${stage}_saved_at`] = new Date().toISOString();

  fs.writeFileSync(PROMPTS_PATH, JSON.stringify(current, null, 2), "utf-8");

  return Response.json({ success: true, saved_at: current[`${stage}_saved_at`] });
}

export async function DELETE(req: NextRequest) {
  const { stage } = await req.json() as { stage: string };

  if (!["stage1", "stage2", "stage3"].includes(stage)) {
    return Response.json({ success: false, error: "Invalid stage" }, { status: 400 });
  }

  try {
    if (fs.existsSync(PROMPTS_PATH)) {
      const current = JSON.parse(fs.readFileSync(PROMPTS_PATH, "utf-8")) as Record<string, string>;
      delete current[stage];
      delete current[`${stage}_saved_at`];
      fs.writeFileSync(PROMPTS_PATH, JSON.stringify(current, null, 2), "utf-8");
    }
  } catch {
    // ignore
  }

  return Response.json({ success: true });
}
