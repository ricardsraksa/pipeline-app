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

  // One call, with a single corrective retry. Failure modes seen in practice:
  // the tool input arrives as a stringified array (repair + parse it), the
  // output is cut off at max_tokens (retry asking for tighter angles), or the
  // input is empty (retry). The error names the reason so it can be acted on.
  const callOnce = async (text: string): Promise<{ raw: unknown[] | null; why: string }> => {
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
    let angles = (block.input as { angles?: unknown }).angles;
    if (typeof angles === "string") {
      try { angles = JSON.parse(jsonrepair(angles)); } catch { angles = undefined; }
    }
    if (!Array.isArray(angles) || !angles.length) {
      return { raw: null, why: msg.stop_reason === "max_tokens" ? "output cut off at the token limit" : `empty angles (stop: ${msg.stop_reason})` };
    }
    return { raw: angles, why: "" };
  };

  let { raw, why } = await callOnce(user);
  if (!raw) {
    const retry = await callOnce(
      user + "\n\nYour previous answer was unusable (" + why + "). Call submit_angles with 4 to 6 angles as a JSON array of objects. Keep every field concise (problem, consequence and mechanism under 60 words each).",
    );
    raw = retry.raw;
    if (!raw) throw new Error(`The strategist returned no angles — ${why}; retry: ${retry.why}`);
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
