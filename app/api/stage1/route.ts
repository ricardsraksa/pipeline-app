import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getPrompt } from "@/lib/prompts";
import { db } from "@/lib/db";
import type { Run } from "@/lib/db";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function buildFeedbackBlock(): Promise<string> {
  try {
    const result = await db.execute(
      `SELECT stage1_output FROM runs WHERE feedback_stage1 = 'up' AND stage1_output IS NOT NULL ORDER BY created_at DESC LIMIT 5`
    );
    const rows = result.rows as unknown as Pick<Run, "stage1_output">[];

    if (!rows.length) return "";

    const summaries = rows.map((r) => (r.stage1_output as string).slice(0, 300));
    return "\n\n--- PREVIOUS OUTPUTS THAT WORKED WELL ---\n" + summaries.join("\n\n") + "\n---";
  } catch {
    return "";
  }
}

export async function POST(req: NextRequest) {
  const { url, scraped_text, competitor_urls, competitor_scraped } = await req.json();

  const systemPrompt = getPrompt("stage1") + await buildFeedbackBlock();

  const competitorBlock = (() => {
    if (!competitor_urls?.length) return "";
    const lines: string[] = ["\nCOMPETITOR ANALYSIS:"];
    for (let i = 0; i < competitor_urls.length; i++) {
      lines.push(`\nCompetitor ${i + 1}: ${competitor_urls[i]}`);
      const scraped = competitor_scraped?.find((c: { url: string; text: string }) => c.url === competitor_urls[i]);
      if (scraped?.text) {
        lines.push(`Scraped content:\n${scraped.text.slice(0, 1500)}`);
      } else {
        lines.push("(content not available)");
      }
    }
    return lines.join("\n");
  })();

  const userMessage = [
    `PRODUCT URL: ${url}`,
    scraped_text ? `\nSCRAPED PRODUCT TEXT:\n${scraped_text}` : "\nSCRAPED PRODUCT TEXT: (not available)",
    competitorBlock,
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
