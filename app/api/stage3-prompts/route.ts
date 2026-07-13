import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getPrompt } from "@/lib/prompts";
import { db } from "@/lib/db";
import type { Run } from "@/lib/db";
import { getModel } from "@/lib/models";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface ImagePrompt {
  index: number;
  category: "INFOGRAPHIC" | "CONTEXTUAL";
  prompt: string;
  overlay_text: string;
  reference_image: string;
}

async function buildFeedbackBlock(): Promise<string> {
  try {
    const result = await db.execute(
      `SELECT stage3_prompts FROM runs WHERE feedback_stage3 = 'up' AND stage3_prompts IS NOT NULL ORDER BY created_at DESC LIMIT 5`
    );
    const rows = result.rows as unknown as Pick<Run, "stage3_prompts">[];

    if (!rows.length) return "";

    const summaries = rows.map((r) => (r.stage3_prompts as string).slice(0, 300));
    return "\n\n--- PREVIOUS OUTPUTS THAT WORKED WELL ---\n" + summaries.join("\n\n") + "\n---";
  } catch {
    return "";
  }
}

export async function POST(req: NextRequest) {
  const { stage2_output, product_url, images } = await req.json();

  if (!stage2_output) {
    return Response.json({ success: false, error: "stage2_output required" }, { status: 400 });
  }

  const systemPrompt = (await getPrompt("stage3")) + (await buildFeedbackBlock());

  const imageContext =
    images?.length
      ? `REFERENCE IMAGES AVAILABLE: ${images.length} image(s) provided (image_1 through image_${images.length})`
      : "REFERENCE IMAGES: None available. Embed full product description in every prompt.";

  const userMessage = `PRODUCT URL: ${product_url || "(not provided)"}

${imageContext}

COPY (Stage 2 output):
${stage2_output}

Generate the 7 image prompts as a JSON array now.`;

  try {
    const message = await anthropic.messages.create({
      model: await getModel("stage3Prompt"),
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const raw = message.content.find((b) => b.type === "text")?.text ?? "";

    let prompts: ImagePrompt[];
    try {
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error("No JSON array found in response");
      prompts = JSON.parse(jsonMatch[0]);
    } catch {
      return Response.json(
        { success: false, error: "Failed to parse prompts JSON", raw },
        { status: 500 }
      );
    }

    if (!Array.isArray(prompts) || prompts.length !== 7) {
      return Response.json(
        { success: false, error: `Expected 7 prompts, got ${prompts?.length ?? 0}`, raw },
        { status: 500 }
      );
    }

    return Response.json({ success: true, prompts });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
