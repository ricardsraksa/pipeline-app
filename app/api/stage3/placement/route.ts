import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getRun, updateRun } from "@/lib/db";
import { getModel } from "@/lib/models";
import { recordUsage } from "@/lib/db";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 90_000 });

export const maxDuration = 120;

type RemImage = { index: number; category: string; image_url: string; status?: string };

const SYSTEM = `You are an art director laying out a DTC product landing page. The page always follows this fixed template:
- TOP (product gallery): the hero plus clean product shots — the product on its own, studio/contextless, or simple feature/spec callouts. This is the buy box area.
- 3 BODY SECTIONS: each is one headline + a short paragraph + ONE supporting image. Section 1's image is ALWAYS added manually by the operator (an animated GIF) — you do NOT choose it. You choose only Section 2 = the solution / main benefit / how it works (product in use delivering the benefit) and Section 3 = reassurance / comfort / everyday payoff.
- A separate REVIEWS section lower down handles social proof with its own customer photos.

So the 3 body-section images should be clean, PHOTOGRAPHIC, in-context lifestyle/benefit shots that show the product being used by real people — the kind that pair naturally with a headline. AVOID putting graphic-heavy assets in the body sections when a cleaner lifestyle/benefit photo exists: comparison tables/charts, before/after split graphics, and review-screenshot/testimonial graphics are NOT body-section images (charts belong up top with the product shots; testimonial graphics belong in the reviews section). Only fall back to a graphic asset for a body section if there genuinely is no suitable lifestyle/benefit photo.

You are given a numbered set of candidate images. LOOK AT THE IMAGES and choose the single best image for Section 2 and for Section 3 so the page reads solution -> reassurance. Judge purely by what each image shows. The two sections MUST get distinct images (never reuse one). Images you do not pick are the top-of-page product shots.

Return ONLY this JSON, no prose, no markdown:
{"section_2": <image index>, "section_3": <image index>, "reasons": {"2": "<short why>", "3": "<short why>"}}`;

export async function POST(req: NextRequest) {
  const { runId } = await req.json();
  if (!runId) return Response.json({ success: false, error: "runId required" }, { status: 400 });

  const run = await getRun(Number(runId));
  if (!run) return Response.json({ success: false, error: "Run not found" }, { status: 404 });

  let images: RemImage[] = [];
  try { images = JSON.parse(run.stage3_remaining_images || "[]"); } catch { images = []; }
  const usable = images.filter((g) => g?.image_url && g.status !== "failed");
  if (usable.length < 2) {
    return Response.json({ success: false, error: "Need at least 2 generated images to place into sections" }, { status: 400 });
  }

  // Build a vision message: each image block followed by its index label.
  const content: Anthropic.MessageParam["content"] = [];
  for (const im of usable) {
    content.push({ type: "image", source: { type: "url", url: im.image_url } });
    content.push({ type: "text", text: `Image index ${im.index} (template: ${im.category || "n/a"})` });
  }
  content.push({
    type: "text",
    text: `Choose the best image for body sections 2 and 3 from the indices shown above (Section 1 is handled manually by the operator — do not pick for it; valid indices: ${usable.map((u) => u.index).join(", ")}). Return the JSON only.`,
  });

  try {
    const model = await getModel("stage3Prompt");
    const message = await anthropic.messages.create({
      model,
      max_tokens: 1000,
      system: SYSTEM,
      messages: [{ role: "user", content }],
    });
    void recordUsage(Number(runId) || null, "stage3: placement", model, message.usage);
    const raw = message.content.find((b) => b.type === "text")?.text ?? "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return Response.json({ success: false, error: "No JSON in response", raw }, { status: 500 });

    const parsed = JSON.parse(jsonMatch[0]) as { section_2: number; section_3: number; reasons?: Record<string, string> };
    const valid = new Set(usable.map((u) => u.index));
    const picks = [parsed.section_2, parsed.section_3];
    // Validate: 2 distinct, in-range indices (section 1 is always the
    // operator's manual GIF — never auto-placed). Fall back to first-two.
    const allValid = picks.every((p) => valid.has(p)) && new Set(picks).size === 2;
    const placement = allValid
      ? { section_2: parsed.section_2, section_3: parsed.section_3, reasons: parsed.reasons ?? {} }
      : { section_2: usable[0].index, section_3: usable[1].index, reasons: parsed.reasons ?? {} };

    await updateRun(Number(runId), { stage3_placement: JSON.stringify(placement) });
    return Response.json({ success: true, placement });
  } catch (err) {
    return Response.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
