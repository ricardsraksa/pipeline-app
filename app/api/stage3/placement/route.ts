import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getRun, updateRun, recordUsage } from "@/lib/db";
import { getModel } from "@/lib/models";
import { requireSession } from "@/lib/auth";
import { parseSelectedAngles } from "@/lib/angles";
import type { Stage2Json } from "@/lib/stage2/shape";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 90_000 });

export const maxDuration = 120;

type RemImage = { index: number; category: string; image_url: string; status?: string; verdict?: "pass" | "fail"; user_override?: "pass" | "fail" | null };
type RemPrompt = { index: number; prompt?: string; overlay_text?: string; intended_section?: number | null };

/** What gets stored in runs.stage3_placement. `placed_urls` is what lets the
 *  UI and the Shopify fill notice that a placed image was regenerated since. */
export interface StoredPlacement {
  section_2: number;
  section_3: number;
  reasons: Record<string, string>;
  placed_urls: Record<string, string>;
  at: string;
  source: "auto" | "manual";
  fallback?: boolean;
}

const SYSTEM = `You are an art director laying out a DTC product page. The page has a fixed template: a product gallery at the top (hero + product shots), then three body sections — each ONE headline, ONE short paragraph and ONE supporting image. Section 1's image is the operator's own GIF; you never choose it. You choose the image for Section 2 and for Section 3.

Your one job: for each of Section 2 and Section 3, pick the candidate image that best ILLUSTRATES THAT SECTION'S HEADLINE AND PARAGRAPH — a reader should take the image and the headline in as one thought. The section text is given verbatim. Judge by what the image actually shows, not by its template name.

Rules:
- Prefer photographic, in-context lifestyle/benefit shots (product in use, real people) over graphics. Comparison tables, before/after splits, feature-callout diagrams and review/testimonial graphics are NOT section images unless no photographic candidate fits the section at all.
- Prefer an image whose overlay text does not repeat the headline word for word.
- The two sections get two DIFFERENT images. Never the hero. Every image you do not pick stays in the gallery.
- A candidate marked as the prompt writer's intended image for a section is the default for that section: keep it unless it clearly fails to show that section's headline or has a visible defect.

Return ONLY this JSON, no prose, no markdown:
{"section_2": <image index>, "section_3": <image index>, "reasons": {"2": "<one sentence: how this image shows the section 2 headline>", "3": "<same for section 3>"}}`;

// Pull one ALL-CAPS section out of a gold-standard prompt (same shape the
// prompt-review cards use) so the model gets a one-line "what this shows".
function promptSection(prompt: string, header: string): string {
  const lines = prompt.split("\n");
  const isHeader = (l: string) => /^[A-Z][A-Z /&_-]{2,}:\s*$/.test(l.trim()) || /^[A-Z][A-Z /&_-]{2,}:\s+\S/.test(l.trim());
  const start = lines.findIndex((l) => l.trim().toUpperCase().startsWith(header.toUpperCase() + ":"));
  if (start === -1) return "";
  const first = lines[start].slice(lines[start].indexOf(":") + 1).trim();
  const out: string[] = first ? [first] : [];
  for (let i = start + 1; i < lines.length; i++) {
    if (isHeader(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { runId } = await req.json();
  if (!runId) return Response.json({ success: false, error: "runId required" }, { status: 400 });

  const run = await getRun(Number(runId));
  if (!run) return Response.json({ success: false, error: "Run not found" }, { status: 404 });

  let images: RemImage[] = [];
  try { images = JSON.parse(run.stage3_remaining_images || "[]"); } catch { images = []; }
  // Same notion of "usable" as the Shopify fill — only finished images can be placed.
  const usable = images.filter((g) => g?.image_url && g.status === "done");
  if (usable.length < 2) {
    return Response.json({ success: false, error: "Need at least 2 finished images to place into sections" }, { status: 400 });
  }

  // The copy each section image will sit next to (Section n Photo ↔ sections[n-1]).
  let json: Stage2Json | null = null;
  try { json = run.stage2_json ? (JSON.parse(run.stage2_json) as Stage2Json) : null; } catch { json = null; }
  const secs = ([2, 3] as const).map((n) => ({
    n,
    headline: (json?.sections?.[n - 1]?.headline ?? "").trim(),
    paragraph: (json?.sections?.[n - 1]?.paragraph ?? "").trim(),
  }));

  let prompts: RemPrompt[] = [];
  try { prompts = JSON.parse(run.stage3_remaining_prompts_edited ?? run.stage3_remaining_prompts ?? "[]"); } catch { prompts = []; }
  const promptFor = (idx: number) => prompts.find((p) => p?.index === idx);

  const angle = parseSelectedAngles(run.product_angle_selected)[0];
  const productName = (run.brand_name ?? json?.product_name ?? run.product_name ?? "").trim();

  // Prompt-writer intent is the default pick — unless that image failed its audit.
  const passes = (im: RemImage) => (im.user_override ?? im.verdict ?? "pass") !== "fail";
  const intended: Partial<Record<2 | 3, number>> = {};
  for (const im of usable) {
    const n = promptFor(im.index)?.intended_section;
    if ((n === 2 || n === 3) && passes(im) && intended[n] === undefined) intended[n] = im.index;
  }
  if (intended[2] !== undefined && intended[2] === intended[3]) delete intended[3];

  const validIdx = usable.map((u) => u.index);
  const header = [
    productName ? `PRODUCT: ${productName}` : "",
    angle ? `POSITIONING ANGLE: ${angle.title} — ${angle.problem}` : "",
    "",
    ...secs.flatMap((s) => [
      `SECTION ${s.n} — HEADLINE: ${s.headline || "(none written)"}`,
      `SECTION ${s.n} — PARAGRAPH: ${s.paragraph || "(none written)"}`,
      "",
    ]),
    "CANDIDATE IMAGES follow. Each label comes BEFORE its image.",
  ].filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n");

  const content: Anthropic.MessageParam["content"] = [{ type: "text", text: header }];
  for (const im of usable) {
    const p = promptFor(im.index);
    const objective = p?.prompt ? promptSection(p.prompt, "OBJECTIVE") : "";
    const intendedFor = intended[2] === im.index ? 2 : intended[3] === im.index ? 3 : null;
    const label = [
      `CANDIDATE image index ${im.index} — ${im.category || "n/a"}`,
      p?.overlay_text?.trim() ? `overlay text: "${p.overlay_text.trim()}"` : "no overlay text",
      objective ? `shows: ${objective.slice(0, 300)}` : "",
      intendedFor ? `INTENDED BY THE PROMPT WRITER FOR SECTION ${intendedFor}` : "",
    ].filter(Boolean).join(" · ");
    content.push({ type: "text", text: label });
    content.push({ type: "image", source: { type: "url", url: im.image_url } });
  }
  content.push({
    type: "text",
    text: `Pick the image for Section 2 and for Section 3 from these indices only: ${validIdx.join(", ")} (two different indices; Section 1 is not yours to pick). Return the JSON only.`,
  });

  type Parsed = { section_2?: unknown; section_3?: unknown; reasons?: Record<string, string> };
  const valid = new Set(validIdx);
  const isValid = (p: Parsed | null): p is { section_2: number; section_3: number; reasons?: Record<string, string> } =>
    !!p && typeof p.section_2 === "number" && typeof p.section_3 === "number"
    && valid.has(p.section_2) && valid.has(p.section_3) && p.section_2 !== p.section_3;

  try {
    const model = await getModel("stage3Prompt");
    const call = async (feedback?: string): Promise<Parsed | null> => {
      const msgContent = feedback ? [...content, { type: "text" as const, text: feedback }] : content;
      const message = await anthropic.messages.create({
        model,
        max_tokens: 1000,
        system: SYSTEM,
        messages: [{ role: "user", content: msgContent }],
      });
      void recordUsage(Number(runId) || null, "stage3: placement", model, message.usage);
      const raw = message.content.find((b) => b.type === "text")?.text ?? "";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      try { return JSON.parse(jsonMatch[0]) as Parsed; } catch { return null; }
    };

    let parsed = await call();
    if (!isValid(parsed)) {
      // One corrective retry: tell the model exactly what was wrong.
      const got = parsed ? `section_2=${String(parsed.section_2)}, section_3=${String(parsed.section_3)}` : "no JSON";
      parsed = await call(`Your previous answer (${got}) was invalid: both values must be two DIFFERENT indices from ${validIdx.join(", ")}. Answer again with the JSON only.`);
    }

    let placement: StoredPlacement;
    const urlOf = (idx: number) => usable.find((u) => u.index === idx)?.image_url ?? "";
    if (isValid(parsed)) {
      placement = {
        section_2: parsed.section_2,
        section_3: parsed.section_3,
        reasons: { "2": String(parsed.reasons?.["2"] ?? ""), "3": String(parsed.reasons?.["3"] ?? "") },
        placed_urls: { "2": urlOf(parsed.section_2), "3": urlOf(parsed.section_3) },
        at: new Date().toISOString(),
        source: "auto",
      };
    } else {
      // Fallback: writer intent first, then lowest indices. Say so — the old
      // code kept the model's reasons for images it had not picked.
      const s2 = intended[2] ?? validIdx[0];
      const s3 = intended[3] !== undefined && intended[3] !== s2 ? intended[3] : validIdx.find((i) => i !== s2)!;
      const why = "fallback: model returned invalid indices";
      placement = {
        section_2: s2, section_3: s3,
        reasons: { "2": why, "3": why },
        placed_urls: { "2": urlOf(s2), "3": urlOf(s3) },
        at: new Date().toISOString(),
        source: "auto",
        fallback: true,
      };
    }

    await updateRun(Number(runId), { stage3_placement: JSON.stringify(placement) });
    return Response.json({ success: true, placement });
  } catch (err) {
    return Response.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
