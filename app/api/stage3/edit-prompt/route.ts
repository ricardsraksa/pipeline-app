import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

// POST { prompt, instructions, category? }  →  { success, prompt }
//
// Takes one Stage-3 image prompt + a short natural-language instruction
// and returns a rewritten prompt. The model is told to keep the structural
// elements (product description, source-image references, German text) and
// only adjust the parts the user actually mentioned.

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 90_000 });
const MODEL = "claude-sonnet-4-5-20250929";

const SYSTEM = `You are a senior product photographer and prompt engineer specializing in DTC marketing imagery. You will be given ONE existing image-generation prompt that didn't quite land, plus a short natural-language note from the operator about what to change.

Your job is to rewrite the prompt incorporating the operator's note. Hard rules:

- Preserve every concrete product fact, material, color, and dimension from the original prompt. The product itself must NOT change.
- Preserve references to source images, German on-image text, and any explicit "do not" instructions, unless the operator's note explicitly contradicts them.
- Apply the operator's note thoroughly — if they say "warmer lighting," every lighting cue should reflect that. If they say "remove the second person," every reference to a second person must be gone.
- Keep the prompt in the same overall style and length as the original. Don't append commentary or explanations.
- Output ONLY the new prompt text. No preamble, no markdown headers, no quotes around it.`;

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    prompt?: string;
    instructions?: string;
    category?: string;
  };
  const prompt = body.prompt?.trim();
  const instructions = body.instructions?.trim();
  const category = body.category?.trim();

  if (!prompt || prompt.length < 10) {
    return NextResponse.json({ success: false, error: "prompt required" }, { status: 400 });
  }
  if (!instructions || instructions.length < 5) {
    return NextResponse.json(
      { success: false, error: "instructions must be at least 5 characters" },
      { status: 400 }
    );
  }

  const userMsg = [
    category ? `CATEGORY: ${category}` : null,
    "",
    "CURRENT PROMPT:",
    prompt,
    "",
    "OPERATOR NOTE — what to change:",
    instructions,
    "",
    "Return the rewritten prompt as plain text.",
  ]
    .filter((line) => line !== null)
    .join("\n");

  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{ role: "user", content: userMsg }],
    });
    const out = msg.content.find((b) => b.type === "text")?.text?.trim() ?? "";
    if (!out) {
      return NextResponse.json(
        { success: false, error: "Empty response from Claude" },
        { status: 502 }
      );
    }
    return NextResponse.json({ success: true, prompt: out });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error }, { status: 502 });
  }
}
