// Who a product is for, decided once per run and handed to every stage.
//
// The store's default buyer is a middle-aged mother, and every research prompt
// is anchored on her. For most products she is also the person who uses it.
// For some she is not — a standing aid for her elderly parent, a gift — and
// without an explicit decision each stage guessed on its own: the copy wrote
// about "her" without saying who that was, the images showed an older man, and
// the ads mixed the two. The buyer is who every word is written to; the user
// is who the product is for and who the pictures show.
import Anthropic from "@anthropic-ai/sdk";
import { getModel, streamToolCall } from "@/lib/models";
import { getRun, recordUsage, updateRun, type Run } from "@/lib/db";

export interface Audience {
  /** Who pays and reads every word ("you"). */
  buyer: string;
  /** Who uses the product. Equal to the buyer when `same`. */
  user: string;
  same: boolean;
  /** What the copy calls the user when they are someone else: "your mom or dad". */
  relation?: string;
  source: "research" | "derived" | "manual";
  at: string;
}

const clean = (s: unknown, n = 200) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, n) : "");

export function validateAudience(x: unknown): string | null {
  const a = x as Partial<Audience> | null;
  if (!a || typeof a !== "object") return "audience object required";
  if (!clean(a.buyer)) return "buyer is required";
  if (typeof a.same !== "boolean") return "same must be true or false";
  if (!a.same && !clean(a.user)) return "user is required when it is someone else";
  if (!a.same && !clean(a.relation, 80)) return "say what the copy calls the user (e.g. your mom or dad)";
  if (!["research", "derived", "manual"].includes(String(a.source))) return "source must be research, derived or manual";
  return null;
}

export function parseStoredAudience(raw: string | null | undefined): Audience | null {
  if (!raw) return null;
  try {
    const a = JSON.parse(raw) as Audience;
    return validateAudience(a) ? null : a;
  } catch { return null; }
}

/** Read the three machine lines the research analysis writes. */
export function parseAudienceLines(research: string | null | undefined): Omit<Audience, "source" | "at"> | null {
  if (!research) return null;
  const buyer = clean(research.match(/^\s*BUYER:\s*(.+)$/im)?.[1]);
  const user = clean(research.match(/^\s*USER:\s*(.+)$/im)?.[1]);
  const relation = clean(research.match(/^\s*CALL THE USER:\s*(.+)$/im)?.[1], 80);
  if (!buyer || !user) return null;
  const same = /^(same|the buyer|the buyer themselves|herself|themselves|self)\b/i.test(user) || /^(you|self)\b/i.test(relation) || relation.split(",").length > 2;
  return same ? { buyer, user: buyer, same: true } : { buyer, user, same: false, relation: relation || "the person you're buying for" };
}

/** The block every writer receives. Empty when nothing is decided yet. */
export function audienceBlock(a: Audience | null): string {
  if (!a) return "";
  if (a.same) {
    return [
      "WHO THIS IS FOR (decided for this product; every stage follows it):",
      `- The buyer, who also uses it: ${a.buyer}. Every word is written to her as "you".`,
      "- People shown in images and ads are this person using the product.",
    ].join("\n");
  }
  return [
    "WHO THIS IS FOR (decided for this product; every stage follows it):",
    `- The buyer, who reads every word: ${a.buyer}. Write to her as "you".`,
    `- The user, who the product is for: ${a.user}. In the copy the user is always "${a.relation}" — never "she", "her", "he" or "him", and never a second, unnamed person.`,
    "- Frame problems, stakes and benefits from the buyer's side: what she sees, worries about and gains when the user is looked after.",
    "- Images and ads show the user using the product; a scene about choosing, setting up or giving it shows the buyer. The words must never contradict the person the picture shows.",
  ].join("\n");
}

const TOOL: Anthropic.Tool = {
  name: "submit_audience",
  description: "Who buys this product and who uses it.",
  input_schema: {
    type: "object",
    properties: {
      buyer: { type: "string", description: "Who pays and reads the copy, one phrase with age and situation." },
      same: { type: "boolean", description: "True when the buyer is also the person who uses the product." },
      user: { type: "string", description: "Who uses it, one phrase with age and situation. Empty when same." },
      relation: { type: "string", description: "What copy written to the buyer calls the user, gender-neutral unless the product is gendered: 'your mom or dad', 'your child', 'whoever you're buying for'. Empty when same." },
    },
    required: ["buyer", "same"],
  },
};

/**
 * Work the audience out from research that predates the explicit decision.
 * One small call, stored with source "derived" so it is shown and editable.
 */
export async function deriveAudience(run: Run): Promise<Audience | null> {
  const onePager = (run.stage1_one_pager_edited ?? run.stage1_one_pager ?? "").slice(0, 6000);
  const avatar = (run.step_avatar_revised ?? run.step_avatar ?? "").slice(0, 6000);
  const description = (run.product_description_edited ?? run.product_description_ai ?? run.product_description ?? "").slice(0, 3000);
  if (!onePager && !avatar && !description) return null;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 90_000 });
  const model = await getModel("mechanical");
  const msg = await streamToolCall(client, {
    model,
    max_tokens: 4000,
    tools: [TOOL],
    system: `You decide who a DTC product is for. The store's default buyer is a middle-aged mother in the US.
Pick ONE answer, never a list:
- "Herself" is the default. It holds for anything she would use herself, including products she might also give as a gift.
- "Someone else" only when the product is mainly used by one other person and she is buying it for them: a mobility or care aid for an ageing parent, a product for a child, for a partner, for a pet.
When someone else uses it, give the ONE gender-neutral name copy written to her should use for that person: "your parent", "your mom or dad", "your child", "your partner". Never a list of options.`,
    messages: [{ role: "user", content: `PRODUCT:\n${description}\n\nONE-PAGER:\n${onePager}\n\nCUSTOMER AVATAR:\n${avatar}\n\nSubmit who buys it and who uses it.` }],
  }, "submit_audience", (u) => void recordUsage(run.id, "audience: derive", model, u));
  const input = msg.content.find((b) => b.type === "tool_use")?.input as { buyer?: unknown; same?: unknown; user?: unknown; relation?: unknown } | undefined;
  const buyer = clean(input?.buyer);
  if (!buyer) return null;
  // A hedge ("yourself, your partner, your parent…") means she buys it for herself.
  const rel = clean(input?.relation, 200);
  const same = input?.same === true || !rel || /^yourself\b/i.test(rel) || rel.split(",").length > 2;
  const a: Audience = same
    ? { buyer, user: buyer, same: true, source: "derived", at: new Date().toISOString() }
    : { buyer, user: clean(input?.user) || "the person the buyer is buying for", same: false, relation: clean(input?.relation, 80) || "the person you're buying for", source: "derived", at: new Date().toISOString() };
  return validateAudience(a) ? null : a;
}

/** The run's audience, working it out once (and storing it) when research predates it. */
export async function ensureAudience(run: Run): Promise<Audience | null> {
  const stored = parseStoredAudience(run.audience);
  if (stored) return stored;
  if (!run.stage1_one_pager && !run.step_research) return null;
  try {
    const derived = await deriveAudience(run);
    if (derived) {
      // Another writer may have derived it meanwhile; keep whichever landed first.
      const fresh = await getRun(run.id);
      const already = parseStoredAudience(fresh?.audience);
      if (already) return already;
      await updateRun(run.id, { audience: JSON.stringify(derived) });
      run.audience = JSON.stringify(derived);
    }
    return derived;
  } catch (e) {
    console.error(`[audience] could not derive for run ${run.id}:`, e instanceof Error ? e.message : e);
    return null;
  }
}
