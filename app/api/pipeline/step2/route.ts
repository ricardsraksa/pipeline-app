import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { CHIEF_MID_PROMPT } from "@/lib/prompts/chief_mid";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const { research } = await req.json();

  const userMessage = `RESEARCH.txt to review:\n\n${research}`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4000,
      system: CHIEF_MID_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const output = message.content.find((b) => b.type === "text")?.text ?? "";
    return Response.json({ success: true, output });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ success: false, error: msg }, { status: 500 });
  }
}
