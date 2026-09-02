import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getModel } from "@/lib/models";
import { recordUsage } from "@/lib/db";
import { assertPublicUrl } from "@/lib/ssrf";

import { requireSession } from "@/lib/auth";
// POST { prompt, instructions, category? }  →  { success, prompt }
//
// Takes one Stage-3 image prompt + a short natural-language instruction
// and returns a rewritten prompt. The model is told to keep the structural
// elements (product description, source-image references, on-image text) and
// only adjust the parts the user actually mentioned.

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 90_000 });

const SYSTEM = `You are a senior product photographer and prompt engineer specializing in DTC marketing imagery. You will be given ONE existing image-generation prompt that didn't quite land, plus a short natural-language note from the operator about what to change.

Your job is to rewrite the prompt incorporating the operator's note. Hard rules:

- Preserve every concrete product fact, material, color, and dimension from the original prompt. The product itself must NOT change.
- Preserve references to source images, on-image text, and any explicit "do not" instructions, unless the operator's note explicitly contradicts them.
- Apply the operator's note thoroughly — if they say "warmer lighting," every lighting cue should reflect that. If they say "remove the second person," every reference to a second person must be gone.
- Keep the prompt in the same overall style and length as the original. Don't append commentary or explanations.
- If reference images are attached, treat them as the desired SCENE / setting / lighting / style to move toward — never as the product. Describe what you actually see in them (a setting, a background, a mood, a prop) and fold it into the rewrite where the operator's note calls for it. The product still comes from the existing product references; do not describe an attached reference as the product.
- Output ONLY the new prompt text. No preamble, no markdown headers, no quotes around it.`;

export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const body = (await req.json()) as {
    prompt?: string;
    instructions?: string;
    category?: string;
    reference_images?: string[];
    run_id?: number;
  };
  const prompt = body.prompt?.trim();
  const instructions = body.instructions?.trim();
  const category = body.category?.trim();
  const referenceImages = Array.isArray(body.reference_images)
    ? body.reference_images.filter((u): u is string => typeof u === "string" && u.startsWith("http")).slice(0, 5)
    : [];
  try {
    await Promise.all(referenceImages.map((u) => assertPublicUrl(u)));
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "blocked reference URL" }, { status: 400 });
  }

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
    referenceImages.length
      ? `\n${referenceImages.length} reference image(s) are attached below — use them as the desired scene/setting/style and reflect them in the rewrite where the note calls for it. They are NOT the product.`
      : null,
    "",
    "Return the rewritten prompt as plain text.",
  ]
    .filter((line) => line !== null)
    .join("\n");

  try {
    // Rewrites/edits run on the cheaper stage3Edit role (Sonnet by default) —
    // this is the most-clicked Stage 3 call (single rewrites + bulk fix).
    const model = await getModel("stage3Edit");
    const msg = await client.messages.create({
      model,
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{
        role: "user",
        content: [
          { type: "text" as const, text: userMsg },
          ...referenceImages.map((url) => ({ type: "image" as const, source: { type: "url" as const, url } })),
        ],
      }],
    });
    void recordUsage(typeof body.run_id === "number" ? body.run_id : null, "stage3: prompt rewrite", model, msg.usage);
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
