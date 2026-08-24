import Anthropic from "@anthropic-ai/sdk";
import { jsonrepair } from "jsonrepair";
import { getModel } from "@/lib/models";
import { recordUsage } from "@/lib/db";
// Stage2Json + stage2Warnings live in ./shape (server-free) so client
// components can import them without pulling this module's server-only deps
// (the Anthropic SDK and the DB-backed model resolver).
import type { Stage2Json } from "./shape";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 90_000 });

const STRUCTURE_SYSTEM = `You convert an already-written DTC copy kit into structured JSON. You are a parser, not a writer.

ABSOLUTE RULE: copy the text VERBATIM. Do not rewrite, shorten, improve, or fix anything. Extract exactly what is written, character for character. If a section is missing, use an empty string or empty array.

Return ONLY this JSON, no markdown fences, no commentary:
{
  "product_name": "<section 1 — the full 'BrandName Kategorie' line>",
  "badge": "<section 2 — the badge text>",
  "supporting_sentence": "<section 3 — the one-line tagline>",
  "benefits": ["<benefit 1>", "<benefit 2>", "<benefit 3>"],
  "sections": [
    { "headline": "<headline 1>", "paragraph": "<paragraph 1>" },
    { "headline": "<headline 2>", "paragraph": "<paragraph 2>" },
    { "headline": "<headline 3>", "paragraph": "<paragraph 3>" }
  ],
  "whats_included": "<section 6 — the one-sentence answer>",
  "faqs": [ { "q": "<question 1>", "a": "<answer 1>" }, { "q": "<question 2>", "a": "<answer 2>" } ],
  "facebook": { "headline": "<fb headline>", "primary": "<fb primary text>", "description": "<fb description>" },
  "one_liners": ["<1>", "<2>", "<3>", "<4>", "<5>"]
}`;

/**
 * Parse the free-text Stage 2 copy kit into structured fields. Best-effort:
 * returns null on any failure (the caller keeps the canonical text and the UI
 * falls back to the plain text view). Uses Haiku — this is mechanical extraction.
 */
export async function structureStage2Copy(text: string, runId?: number): Promise<Stage2Json | null> {
  if (!text || text.trim().length < 40) return null;
  try {
    const model = await getModel("mechanical");
    const msg = await anthropic.messages.create({
      model,
      max_tokens: 4000,
      // No cache_control: at ~290 tokens this prompt is far below Haiku's 4096-token
      // minimum cacheable prefix, so the marker was a silent no-op.
      system: STRUCTURE_SYSTEM,
      messages: [{ role: "user", content: `COPY KIT TO PARSE:\n\n${text}` }],
    });
    void recordUsage(runId ?? null, "stage2: structure copy", model, msg.usage);
    const raw = msg.content.find((b) => b.type === "text")?.text ?? "";
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    const slice = start !== -1 && end > start ? raw.slice(start, end + 1) : raw;
    let parsed: Stage2Json;
    try { parsed = JSON.parse(slice); } catch { parsed = JSON.parse(jsonrepair(slice)); }
    // Light normalization so the UI can trust the shape.
    return {
      product_name: String(parsed.product_name ?? ""),
      badge: String(parsed.badge ?? ""),
      supporting_sentence: String(parsed.supporting_sentence ?? ""),
      benefits: Array.isArray(parsed.benefits) ? parsed.benefits.map(String) : [],
      sections: Array.isArray(parsed.sections)
        ? parsed.sections.map((s) => ({ headline: String(s?.headline ?? ""), paragraph: String(s?.paragraph ?? "") }))
        : [],
      // Accept the legacy key so re-parsing older copy kits still populates it.
      whats_included: String(parsed.whats_included ?? parsed.was_enthalten ?? ""),
      faqs: Array.isArray(parsed.faqs) ? parsed.faqs.map((f) => ({ q: String(f?.q ?? ""), a: String(f?.a ?? "") })) : [],
      facebook: {
        headline: String(parsed.facebook?.headline ?? ""),
        primary: String(parsed.facebook?.primary ?? ""),
        description: String(parsed.facebook?.description ?? ""),
      },
      one_liners: Array.isArray(parsed.one_liners) ? parsed.one_liners.map(String) : [],
    };
  } catch (err) {
    console.error("structureStage2Copy failed:", err);
    return null;
  }
}
