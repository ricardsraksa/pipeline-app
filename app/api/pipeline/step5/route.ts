import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { CHIEF_FINAL_PROMPT } from "@/lib/prompts/chief_final";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const { research_revised, avatar, offer_brief, necessary_beliefs } = await req.json();

  const userMessage = [
    `RESEARCH.txt (revised):\n\n${research_revised}`,
    `\n\n---\n\nAVATAR.txt:\n\n${avatar}`,
    `\n\n---\n\nOFFER_BRIEF.txt:\n\n${offer_brief}`,
    `\n\n---\n\nNECESSARY_BELIEFS.txt:\n\n${necessary_beliefs}`,
  ].join("");

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4000,
      system: CHIEF_FINAL_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const output = message.content.find((b) => b.type === "text")?.text ?? "";
    return Response.json({ success: true, output });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ success: false, error: msg }, { status: 500 });
  }
}
