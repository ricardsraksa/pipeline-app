// Server side of the angles gate: one strategist call over the finished
// research documents, returning 4–6 problem-first angles via a forced tool
// call (structured output, no JSON-in-prose parsing).

import Anthropic from "@anthropic-ai/sdk";
import { getRun, updateRun, recordUsage, recordPromptUsed } from "./db";
import { getModel } from "./models";
import { getPrompt } from "./prompts";
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
          },
          required: ["title", "problem", "consequence", "mechanism", "who", "hook", "why_this_angle"],
        },
      },
    },
    required: ["angles"],
  },
};

const DOC_CAP = 18_000;

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

  const msg = await anthropic.messages.create({
    model,
    max_tokens: 4000,
    system,
    tools: [ANGLES_TOOL],
    tool_choice: { type: "tool", name: "submit_angles" },
    messages: [{ role: "user", content: user }],
  });
  void recordUsage(runId, "positioning angles", model, msg.usage);

  const block = msg.content.find((b) => b.type === "tool_use");
  const raw = block && block.type === "tool_use" ? (block.input as { angles?: unknown[] }).angles : undefined;
  if (!Array.isArray(raw) || !raw.length) throw new Error("The strategist returned no angles");

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
