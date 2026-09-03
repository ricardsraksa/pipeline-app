// Server side of the angles gate: one strategist call over the finished
// research documents, returning 4–6 problem-first angles via a forced tool
// call (structured output, no JSON-in-prose parsing).

import Anthropic from "@anthropic-ai/sdk";
import { jsonrepair } from "jsonrepair";
import { getRun, updateRun, recordUsage, recordPromptUsed } from "./db";
import { getModel } from "./models";
import { getPrompt } from "./prompts";
import { parseProductScrape } from "./product";
import type { Angle } from "./angles";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 180_000 });

const ANGLES_TOOL: Anthropic.Tool = {
  name: "submit_angles",
  description: "Submit the ranked list of problem-first positioning angles.",
  input_schema: {
    type: "object",
    properties: {
      angles: {
        type: "array",
        description: "4 to 6 angles, strongest first.",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short name for the angle, under 8 words." },
            problem: { type: "string", description: "The specific problem, in the customer's own world. 1–2 sentences." },
            consequence: { type: "string", description: "What happens if it stays unsolved — the real stakes. 1–2 sentences." },
            mechanism: { type: "string", description: "Why this product's mechanism solves that problem — cause and effect, not a feature list. 1–3 sentences." },
            who: { type: "string", description: "Who exactly feels this most. One sentence." },
            hook: { type: "string", description: "One line a page or ad could open with. No em dashes." },
            why_this_angle: { type: "string", description: "Why this beats generic 'best X / only Y' framing for this product. One sentence." },
            competitor_angle: { type: "string", description: "What the competitors in the research currently lead with on this same ground. Say 'not visible in the research' if it isn't there. One or two sentences." },
            gap: { type: "string", description: "The gap being taken: why this angle is unclaimed, under-served or said badly by them. One or two sentences." },
            crowding: { type: "string", enum: ["open", "partly-claimed", "crowded"], description: "How contested this ground is among the competitors in the research." },
          },
          required: ["title", "problem", "consequence", "mechanism", "who", "hook", "why_this_angle", "competitor_angle", "gap", "crowding"],
        },
      },
    },
    required: ["angles"],
  },
};

const DOC_CAP = 18_000;

/** What each scraped competitor page is actually selling on — the hero line,
 *  offers, proof and claims the scraper pulled. First-hand evidence of their
 *  positioning, which the research documents only summarise. */
function competitorPositioning(scrapeJson: string | null): string {
  const scrape = parseProductScrape(scrapeJson);
  const pages = (scrape?.pages ?? []).filter((p) => p.role === "competitor" && p.ok);
  if (!pages.length) return "(no competitor pages were scraped for this run)";
  return pages
    .map((p) => {
      const pos = p.positioning ?? {};
      const line = (k: string, label: string) => {
        const v = pos[k];
        if (!v || (Array.isArray(v) && !v.length)) return null;
        return `  ${label}: ${Array.isArray(v) ? v.slice(0, 5).join(" | ") : v}`;
      };
      return [
        p.title || p.url,
        line("hero", "Hero line"),
        line("claims", "Claims"),
        line("offers", "Offers"),
        line("social_proof", "Proof"),
        line("testimonials", "Testimonials"),
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n")
    .slice(0, 12_000);
}

export async function generateAngles(runId: number, note?: string): Promise<Angle[]> {
  const run = await getRun(runId);
  if (!run) throw new Error("Run not found");
  const research = run.step_research_revised ?? run.step_research ?? "";
  const onePager = run.stage1_one_pager_edited ?? run.stage1_one_pager ?? "";
  if (!research && !onePager) throw new Error("No research on this run yet");

  const system = await getPrompt("angles");
  await recordPromptUsed(runId, "angles", system);
  const model = await getModel("stage1");

  const user = [
    "Here are the finished research documents for this product. Propose the angles now.",
    "",
    "PRODUCT DESCRIPTION:",
    run.product_description ?? "(none)",
    "",
    "ONE-PAGER:",
    onePager || "(none)",
    "",
    "RESEARCH (identification, market, competitive, product analysis):",
    research.slice(0, DOC_CAP),
    "",
    "WHAT THE SCRAPED COMPETITOR PAGES ACTUALLY SAY (their own hero lines, claims, offers and proof — first-hand evidence of the positioning they lead with):",
    competitorPositioning(run.product_scrape),
    "",
    "CUSTOMER AVATAR:",
    (run.step_avatar_revised ?? run.step_avatar ?? "(none)").slice(0, DOC_CAP),
    "",
    "OFFER BRIEF:",
    (run.step_offer_brief_revised ?? run.step_offer_brief ?? "(none)").slice(0, DOC_CAP),
    "",
    "NECESSARY BELIEFS:",
    (run.step_necessary_beliefs_revised ?? run.step_necessary_beliefs ?? "(none)").slice(0, DOC_CAP),
    ...(note?.trim() ? ["", `OPERATOR NOTE (highest priority): ${note.trim().slice(0, 2000)}`] : []),
  ].join("\n");

  // Pull the angle list out of whatever shape the tool input arrived in: the
  // expected { angles: [...] }, a stringified array, an object keyed by index,
  // the array as the whole input, or a single angle object.
  const looksLikeAngle = (x: unknown) => !!x && typeof x === "object" && "title" in (x as object) && "problem" in (x as object);
  const asList = (v: unknown): unknown[] | null => {
    if (Array.isArray(v)) return v.length ? v : null;
    if (typeof v === "string") { try { return asList(JSON.parse(jsonrepair(v))); } catch { return null; } }
    if (v && typeof v === "object") {
      if (looksLikeAngle(v)) return [v];
      const vals = Object.values(v as Record<string, unknown>);
      if (vals.length && vals.every(looksLikeAngle)) return vals;
    }
    return null;
  };
  const extractAngles = (input: unknown): unknown[] | null => {
    const direct = asList(input);
    if (direct?.some(looksLikeAngle)) return direct;
    if (input && typeof input === "object" && !Array.isArray(input)) {
      for (const v of Object.values(input as Record<string, unknown>)) {
        const list = asList(v);
        if (list?.some(looksLikeAngle)) return list;
      }
    }
    return null;
  };
  const shapeOf = (input: unknown) => { try { return JSON.stringify(input).slice(0, 240); } catch { return String(input); } };

  // Forced tool call, one corrective retry, then a plain-JSON fallback (no
  // tool) — each failure names its reason so the error is actionable.
  const callTool = async (text: string): Promise<{ raw: unknown[] | null; why: string }> => {
    const msg = await anthropic.messages.create({
      model,
      max_tokens: 8000,
      system,
      tools: [ANGLES_TOOL],
      tool_choice: { type: "tool", name: "submit_angles" },
      messages: [{ role: "user", content: text }],
    });
    void recordUsage(runId, "positioning angles", model, msg.usage);
    const block = msg.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") return { raw: null, why: `no tool call (stop: ${msg.stop_reason})` };
    const angles = extractAngles(block.input);
    if (!angles) {
      console.error(`[angles] run ${runId}: unusable tool input (stop=${msg.stop_reason}): ${shapeOf(block.input)}`);
      return { raw: null, why: msg.stop_reason === "max_tokens" ? "output cut off at the token limit" : `tool input had no angles (stop: ${msg.stop_reason}, input: ${shapeOf(block.input)})` };
    }
    return { raw: angles, why: "" };
  };
  const callJson = async (text: string): Promise<{ raw: unknown[] | null; why: string }> => {
    const msg = await anthropic.messages.create({
      model,
      max_tokens: 8000,
      system,
      messages: [{ role: "user", content: text + "\n\nReturn ONLY a JSON array of 4 to 6 angle objects with the keys title, problem, consequence, mechanism, who, hook, why_this_angle, competitor_angle, gap, crowding (open | partly-claimed | crowded). No prose, no markdown fences." }],
    });
    void recordUsage(runId, "positioning angles (json)", model, msg.usage);
    const textOut = msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
    const m = textOut.match(/\[[\s\S]*\]/);
    if (!m) return { raw: null, why: `no JSON array in text (stop: ${msg.stop_reason})` };
    const angles = extractAngles(m[0]);
    return angles ? { raw: angles, why: "" } : { raw: null, why: "JSON did not contain angle objects" };
  };

  let { raw, why } = await callTool(user);
  if (!raw) {
    const retry = await callTool(user + "\n\nYour previous answer was unusable (" + why + "). Call submit_angles with input {\"angles\": [ ...4 to 6 angle objects... ]}. Keep every field concise (problem, consequence and mechanism under 60 words each).");
    raw = retry.raw;
    if (!raw) {
      const json = await callJson(user);
      raw = json.raw;
      if (!raw) throw new Error(`The strategist returned no angles — ${why}; retry: ${retry.why}; json fallback: ${json.why}`);
    }
  }

  const str = (v: unknown, max = 1200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const angles: Angle[] = raw.slice(0, 6).map((a, i) => {
    const o = (a ?? {}) as Record<string, unknown>;
    return {
      id: `a${i + 1}`,
      title: str(o.title, 120) || `Angle ${i + 1}`,
      problem: str(o.problem),
      consequence: str(o.consequence),
      mechanism: str(o.mechanism),
      who: str(o.who, 400),
      hook: str(o.hook, 300),
      why_this_angle: str(o.why_this_angle, 600),
      competitor_angle: str(o.competitor_angle, 800),
      gap: str(o.gap, 800),
      crowding: o.crowding === "crowded" || o.crowding === "partly-claimed" ? o.crowding : "open",
    };
  });

  await updateRun(runId, {
    product_angles: JSON.stringify(angles),
    // A fresh set invalidates the previous pick.
    product_angle_selected: null,
    last_updated_at: new Date().toISOString(),
  });
  return angles;
}
