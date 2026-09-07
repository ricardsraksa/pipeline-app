// Stage 5 · Image ads — the writer. Fills the five ad templates (prompt key
// "ads") from the run's description, angle, copy kit, research and the real
// review text the scraper read, with the hero + source photos attached so the
// fidelity rules describe the actual product. Output goes through a forced
// tool call and lands in runs.ads_prompts; the operator reviews before any
// image is generated.
import Anthropic from "@anthropic-ai/sdk";
import { jsonrepair } from "jsonrepair";
import { getRun, updateRun, recordUsage, recordPromptUsed } from "@/lib/db";
import { getModel } from "@/lib/models";
import { getPrompt } from "@/lib/prompts";
import { anglesBlock, parseSelectedAngles } from "@/lib/angles";
import { parseProductScrape } from "@/lib/product";
import { stage3ActiveSourceImages } from "@/lib/stage3/sources";
import { AD_CONCEPTS, type AdConcept, type AdPrompt } from "@/lib/ads/shape";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 180_000 });
const CAP = 14_000;

const TOOL: Anthropic.Tool = {
  name: "submit_ad_prompts",
  description: "Submit the five image-ad briefs, one per concept, in concept order.",
  input_schema: {
    type: "object",
    properties: {
      ads: {
        type: "array",
        description: "Exactly 5 objects, concepts 1–5 in order.",
        items: {
          type: "object",
          properties: {
            index: { type: "integer", description: "1–5" },
            concept: { type: "string", enum: AD_CONCEPTS.map((c) => c.key) },
            premise: { type: "string" },
            headline: { type: "string" },
            proof: { type: "string" },
            prompt: { type: "string", description: "The filled template, ending with the filled PRODUCT FIDELITY RULES block." },
          },
          required: ["index", "concept", "premise", "headline", "proof", "prompt"],
        },
      },
    },
    required: ["ads"],
  },
};

function extractAds(input: unknown): unknown[] | null {
  const looks = (x: unknown) => !!x && typeof x === "object" && "prompt" in (x as object) && "concept" in (x as object);
  const asList = (v: unknown): unknown[] | null => {
    if (Array.isArray(v)) return v.length ? v : null;
    if (typeof v === "string") { try { return asList(JSON.parse(jsonrepair(v))); } catch { return null; } }
    if (v && typeof v === "object") {
      if (looks(v)) return [v];
      const vals = Object.values(v as Record<string, unknown>);
      if (vals.length && vals.every(looks)) return vals;
    }
    return null;
  };
  const direct = asList(input);
  if (direct?.some(looks)) return direct;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const v of Object.values(input as Record<string, unknown>)) {
      const list = asList(v);
      if (list?.some(looks)) return list;
    }
  }
  return null;
}

export async function generateAdPrompts(runId: number): Promise<AdPrompt[]> {
  const run = await getRun(runId);
  if (!run) throw new Error("Run not found");
  const hero = run.stage3_hero_image_url ?? null;
  const sources = stage3ActiveSourceImages(run, 4);
  const refs = [...(hero ? [hero] : []), ...sources].filter((u, i, a) => a.indexOf(u) === i);
  if (!refs.length) throw new Error("No hero or source photos on this run — the ads need a product reference");

  const system = await getPrompt("ads");
  await recordPromptUsed(runId, "ads", system);
  const model = await getModel("stage3Prompt");

  const productName = (run.brand_name ?? run.product_name ?? "").trim() || "the product";
  const scrape = parseProductScrape(run.product_scrape);
  const listing = scrape?.pages.find((p) => p.role === "product" && p.ok);
  const listingText = [listing?.scraped_text ?? "", listing?.image_text ? `\nCOPY FROM LISTING IMAGES\n${listing.image_text}` : ""].join("").slice(0, 8000);

  const user = [
    `PRODUCT NAME: ${productName}`,
    "",
    "PRODUCT DESCRIPTION (what it physically is):",
    run.product_description ?? "(none)",
    "",
    "POSITIONING ANGLE (chosen by the operator — Concepts 1, 3 and 5 open on THIS problem):",
    anglesBlock(parseSelectedAngles(run.product_angle_selected)) || "(none chosen)",
    "",
    "STAGE 3 COPY KIT (reuse lines verbatim where they fit):",
    (run.stage2_copy_edited ?? run.stage2_output ?? "(none)").slice(0, CAP),
    "",
    "RESEARCH ONE-PAGER (the only source for statistics):",
    (run.stage1_one_pager_edited ?? run.stage1_one_pager ?? "(none)").slice(0, CAP),
    "",
    "CUSTOMER AVATAR:",
    (run.step_avatar_revised ?? run.step_avatar ?? "(none)").slice(0, 6000),
    "",
    "SUPPLIER LISTING TEXT (the only source for customer quotes and ratings — if it holds no review text, there is no usable quote):",
    listingText || "(none)",
    "",
    `REFERENCE IMAGES attached below, in this order: ${hero ? "the approved hero first, then " : ""}${sources.length} source photo(s). Describe the product in the fidelity rules from these. Use these URLs, in this order, as the references: ${refs.join(", ")}`,
    "",
    "Write the five ads now and submit them with submit_ad_prompts.",
  ].join("\n");

  const content: Anthropic.MessageParam["content"] = [
    { type: "text", text: user },
    ...refs.slice(0, 5).map((u) => ({ type: "image" as const, source: { type: "url" as const, url: u } })),
  ];

  const call = async (extra?: string) => {
    const msg = await anthropic.messages.create({
      model,
      max_tokens: 12000,
      system,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "submit_ad_prompts" },
      messages: [{ role: "user", content: extra ? [...content, { type: "text" as const, text: extra }] : content }],
    });
    void recordUsage(runId, "stage5: ad prompts", model, msg.usage);
    const block = msg.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") return { ads: null as unknown[] | null, why: `no tool call (stop: ${msg.stop_reason})` };
    const ads = extractAds(block.input);
    if (!ads) return { ads: null, why: msg.stop_reason === "max_tokens" ? "output cut off at the token limit" : `tool input had no ads (stop: ${msg.stop_reason})` };
    return { ads, why: "" };
  };

  let { ads, why } = await call();
  if (!ads) {
    const retry = await call(`Your previous answer was unusable (${why}). Call submit_ad_prompts with input {"ads": [ ...5 objects... ]}. Keep each prompt under 350 words.`);
    ads = retry.ads;
    if (!ads) throw new Error(`The ad writer returned nothing — ${why}; retry: ${retry.why}`);
  }

  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const byConcept = new Map<AdConcept, Record<string, unknown>>();
  for (const a of ads) {
    const o = (a ?? {}) as Record<string, unknown>;
    const c = AD_CONCEPTS.find((x) => x.key === o.concept)?.key;
    if (c && !byConcept.has(c)) byConcept.set(c, o);
  }
  const prompts: AdPrompt[] = AD_CONCEPTS.map((c) => {
    const o = byConcept.get(c.key) ?? {};
    return {
      index: c.index,
      concept: c.key,
      concept_label: c.label,
      premise: str(o.premise, 1500),
      headline: str(o.headline, 200),
      proof: str(o.proof, 600) || "none",
      prompt: str(o.prompt, 6000),
      model: "gpt_image_2",
      aspect_ratio: "1:1",
      source_image_references: refs.slice(0, 4),
    };
  });
  const missing = prompts.filter((p) => !p.prompt);
  if (missing.length) throw new Error(`The ad writer skipped ${missing.map((m) => m.concept_label).join(", ")}`);

  await updateRun(runId, {
    ads_prompts: JSON.stringify(prompts),
    ads_prompts_edited: null,
    ads_step: "review",
    ads_error: null,
    last_updated_at: new Date().toISOString(),
  });
  return prompts;
}
