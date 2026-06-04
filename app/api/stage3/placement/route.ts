import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getRun, updateRun } from "@/lib/db";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const maxDuration = 120;

type RemImage = { index: number; category: string; image_url: string; status?: string };

const SYSTEM = `You are an art director laying out a German DTC product landing page.

The page has this structure:
- TOP: a set of clean product shots (the gallery at the top of the page).
- BODY: exactly 3 content sections that tell a story in order — Section 1 (hook / problem), Section 2 (solution / how it works / main benefit), Section 3 (proof / lifestyle / reassurance).

You are given a numbered set of candidate images. LOOK AT THE IMAGES and choose the single best image to anchor each of the 3 body sections, so the three together read as a problem -> solution -> proof flow. You do NOT need the images to match any copy — judge purely by what each image shows and how well it fits that section's role. Every section MUST get a distinct image (never reuse one image for two sections). Images you do not pick are the top-of-page product shots.

Return ONLY this JSON, no prose, no markdown:
{"section_1": <image index>, "section_2": <image index>, "section_3": <image index>, "reasons": {"1": "<short why>", "2": "<short why>", "3": "<short why>"}}`;

export async function POST(req: NextRequest) {
  const { runId } = await req.json();
  if (!runId) return Response.json({ success: false, error: "runId required" }, { status: 400 });

  const run = await getRun(Number(runId));
  if (!run) return Response.json({ success: false, error: "Run not found" }, { status: 404 });

  let images: RemImage[] = [];
  try { images = JSON.parse(run.stage3_remaining_images || "[]"); } catch { images = []; }
  const usable = images.filter((g) => g?.image_url && g.status !== "failed");
  if (usable.length < 3) {
    return Response.json({ success: false, error: "Need at least 3 generated images to place into sections" }, { status: 400 });
  }

  // Build a vision message: each image block followed by its index label.
  const content: Anthropic.MessageParam["content"] = [];
  for (const im of usable) {
    content.push({ type: "image", source: { type: "url", url: im.image_url } });
    content.push({ type: "text", text: `Image index ${im.index} (template: ${im.category || "n/a"})` });
  }
  content.push({
    type: "text",
    text: `Choose the best image for each of the 3 body sections from the indices shown above (valid indices: ${usable.map((u) => u.index).join(", ")}). Return the JSON only.`,
  });

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1000,
      system: SYSTEM,
      messages: [{ role: "user", content }],
    });
    const raw = message.content.find((b) => b.type === "text")?.text ?? "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return Response.json({ success: false, error: "No JSON in response", raw }, { status: 500 });

    const parsed = JSON.parse(jsonMatch[0]) as { section_1: number; section_2: number; section_3: number; reasons?: Record<string, string> };
    const valid = new Set(usable.map((u) => u.index));
    const picks = [parsed.section_1, parsed.section_2, parsed.section_3];
    // Validate: 3 distinct, in-range indices. Fall back to first-three on any issue.
    const allValid = picks.every((p) => valid.has(p)) && new Set(picks).size === 3;
    const placement = allValid
      ? parsed
      : { section_1: usable[0].index, section_2: usable[1].index, section_3: usable[2].index, reasons: parsed.reasons ?? {} };

    await updateRun(Number(runId), { stage3_placement: JSON.stringify(placement) });
    return Response.json({ success: true, placement });
  } catch (err) {
    return Response.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
