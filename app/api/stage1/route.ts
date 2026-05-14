import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getPrompt } from "@/lib/prompts";
import getDb from "@/lib/db";
import type { Run } from "@/lib/db";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildFeedbackBlock(): string {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT stage1_output FROM runs WHERE feedback_stage1 = 'up' AND stage1_output IS NOT NULL ORDER BY created_at DESC LIMIT 5`
      )
      .all() as Pick<Run, "stage1_output">[];

    if (!rows.length) return "";

    const summaries = rows.map((r) => (r.stage1_output as string).slice(0, 300));
    return "\n\n--- PREVIOUS OUTPUTS THAT WORKED WELL ---\n" + summaries.join("\n\n") + "\n---";
  } catch {
    return "";
  }
}

export async function POST(req: NextRequest) {
  const { url, scraped_text, competitor_urls } = await req.json();

  const systemPrompt = getPrompt("stage1") + buildFeedbackBlock();

  const userMessage = [
    `PRODUCT URL: ${url}`,
    scraped_text ? `\nSCRAPED PRODUCT TEXT:\n${scraped_text}` : "\nSCRAPED PRODUCT TEXT: (not available)",
    competitor_urls?.length
      ? `\nCOMPETITOR URLS PROVIDED:\n${competitor_urls.join("\n")}`
      : "",
    "\n\nProduce the full research brief now.",
  ]
    .filter(Boolean)
    .join("");

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
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
