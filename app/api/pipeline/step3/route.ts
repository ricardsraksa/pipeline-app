import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { REVISE_RESEARCH_PROMPT } from "@/lib/prompts/revise_research";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const { research, chief_mid } = await req.json();

  if (chief_mid.includes("NO REVISIONS REQUIRED")) {
    return Response.json({ success: true, output: research, skipped: true });
  }

  const userMessage = `RESEARCH.txt (original):\n\n${research}\n\n---\n\nCHIEF_MID.txt (review):\n\n${chief_mid}`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 8000,
      system: REVISE_RESEARCH_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const output = message.content.find((b) => b.type === "text")?.text ?? "";
    return Response.json({ success: true, output });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ success: false, error: msg }, { status: 500 });
  }
}
