import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getPrompt } from "@/lib/prompts";
import { db } from "@/lib/db";
import type { Run } from "@/lib/db";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function buildFeedbackBlock(): Promise<string> {
  try {
    const result = await db.execute(
      `SELECT stage2_output FROM runs WHERE feedback_stage2 = 'up' AND stage2_output IS NOT NULL ORDER BY created_at DESC LIMIT 5`
    );
    const rows = result.rows as unknown as Pick<Run, "stage2_output">[];

    if (!rows.length) return "";

    const summaries = rows.map((r) => (r.stage2_output as string).slice(0, 300));
    return "\n\n--- PREVIOUS OUTPUTS THAT WORKED WELL ---\n" + summaries.join("\n\n") + "\n---";
  } catch {
    return "";
  }
}

export async function POST(req: NextRequest) {
  const { stage1_output, product_name } = await req.json();

  if (!stage1_output) {
    return Response.json({ success: false, error: "stage1_output required" }, { status: 400 });
  }

  const systemPrompt = getPrompt("stage2") + await buildFeedbackBlock();

  const userMessage = `PRODUCT NAME: ${product_name || "(not provided — choose the best name from the research)"}

RESEARCH BRIEF (Stage 1 output):
${stage1_output}

Produce the complete German copy kit now.`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const output = message.content.find((b) => b.type === "text")?.text ?? "";
    return Response.json({ success: true, output });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
