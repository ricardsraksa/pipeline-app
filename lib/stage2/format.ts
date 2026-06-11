import Anthropic from "@anthropic-ai/sdk";
import { jsonrepair } from "jsonrepair";

// Structured shape of the Stage 2 German copy kit. Derived from the canonical
// free-text output (which stays untouched so the carefully-tuned copy and the
// 11pt-Arial Google-Docs paste are never disturbed). This JSON drives only the
// per-field copy UI and structure validation.
export interface Stage2Json {
  product_name: string;
  badge: string;
  supporting_sentence: string;
  benefits: string[];
  sections: { headline: string; paragraph: string }[];
  was_enthalten: string;
  faqs: { q: string; a: string }[];
  facebook: { headline: string; primary: string; description: string };
  one_liners: string[];
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 90_000 });

const STRUCTURE_SYSTEM = `You convert an already-written German DTC copy kit into structured JSON. You are a parser, not a writer.

ABSOLUTE RULE: copy the German text VERBATIM. Do not rewrite, translate, shorten, improve, or fix anything. Extract exactly what is written, character for character. If a section is missing, use an empty string or empty array.

Return ONLY this JSON, no markdown fences, no commentary:
{
  "product_name": "<section 1 — the full 'BrandName Kategorie' line>",
  "badge": "<section 2 — the badge text>",
  "supporting_sentence": "<section 3 — the one-line tagline>",
  "benefits": ["<benefit 1>", "<benefit 2>", "<benefit 3>"],
  "sections": [
    { "headline": "<headline 1>", "paragraph": "<absatz 1>" },
    { "headline": "<headline 2>", "paragraph": "<absatz 2>" },
    { "headline": "<headline 3>", "paragraph": "<absatz 3>" }
  ],
  "was_enthalten": "<section 6 — the one-sentence answer>",
  "faqs": [ { "q": "<frage 1>", "a": "<antwort 1>" }, { "q": "<frage 2>", "a": "<antwort 2>" } ],
  "facebook": { "headline": "<fb headline>", "primary": "<fb primary text>", "description": "<fb description>" },
  "one_liners": ["<1>", "<2>", "<3>", "<4>", "<5>"]
}`;

/**
 * Parse the free-text Stage 2 copy kit into structured fields. Best-effort:
 * returns null on any failure (the caller keeps the canonical text and the UI
 * falls back to the plain text view). Uses Haiku — this is mechanical extraction.
 */
export async function structureStage2Copy(text: string): Promise<Stage2Json | null> {
  if (!text || text.trim().length < 40) return null;
  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4000,
      system: [{ type: "text", text: STRUCTURE_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `COPY KIT TO PARSE:\n\n${text}` }],
    });
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
      was_enthalten: String(parsed.was_enthalten ?? ""),
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

/** Quick structure warnings for the UI (informational — the text is canonical). */
export function stage2Warnings(j: Stage2Json): string[] {
  const w: string[] = [];
  if (j.benefits.length !== 3) w.push(`${j.benefits.length} Hauptvorteile (expected 3)`);
  if (j.sections.length !== 3) w.push(`${j.sections.length} headline sections (expected 3)`);
  if (j.faqs.length !== 2) w.push(`${j.faqs.length} FAQs (expected 2)`);
  if (j.one_liners.length !== 5) w.push(`${j.one_liners.length} one-liners (expected 5)`);
  return w;
}
