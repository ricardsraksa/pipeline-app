import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getRun, updateRun, type Run, recordUsage } from "@/lib/db";
import { structureStage2Copy } from "@/lib/stage2/format";
import { getModel, type ModelRole } from "@/lib/models";
import { anglesBlock, parseSelectedAngles, angleKey } from "@/lib/angles";
import { getPrompt } from "@/lib/prompts";
import { buildStage1FeedbackBlock, buildStage2FeedbackBlock } from "@/lib/feedback";
import { recordPromptUsed } from "@/lib/db";

// The cheap path when the operator changes the angle after the copy exists:
// one revision pass that rewrites around the new angle instead of a full
// Stage 3 re-run, keeping the structure and the operator's edits.
const REBUILD_ON_ANGLE =
  "The positioning angle for this product has changed to the one given under POSITIONING ANGLE. Rebuild the copy around it: the headlines, the benefits, the three sections, the FAQ questions and the Facebook copy must open on THIS problem and mechanism, not the previous one. Keep the section structure, the product name, What's Included and every fact that is not tied to the old angle. Do not mention that the angle changed.";

import { requireSession } from "@/lib/auth";
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Stage 2 regeneration now awaits two model calls in sequence (the Opus-tier
// rewrite plus the mechanical re-structuring for the Copy tab) — give it room.
export const maxDuration = 300;

type Stage = "stage1" | "stage2" | "stage3-prompts";

interface RegenResult {
  /** logical field name — maps to {field}_edited DB column */
  field: "stage1_one_pager" | "stage2_copy" | "stage3_image_prompts";
  /** which {stage}_edited_at column to bump */
  stageTimestamp: "stage1_edited_at" | "stage2_edited_at" | "stage3_edited_at";
  output: string;
  /** The system prompt this rewrite ran with, for the audit trail. */
  systemUsed: string;
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<unknown> }
) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { stage } = (await context.params) as { stage: string };

  const body = (await req.json()) as { runId?: number; instructions?: string; mode?: string };
  const { runId } = body;
  const instructions = body.mode === "angle" ? REBUILD_ON_ANGLE : body.instructions;

  if (!runId || typeof runId !== "number") {
    return NextResponse.json({ error: "runId required" }, { status: 400 });
  }
  if (!instructions || instructions.trim().length < 5) {
    return NextResponse.json(
      { error: "Instructions must be at least 5 characters" },
      { status: 400 }
    );
  }

  const run = await getRun(runId);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  try {
    let result: RegenResult;
    if (stage === "stage1") {
      result = await regenerateStage1(run, instructions.trim());
    } else if (stage === "stage2") {
      result = await regenerateStage2(run, instructions.trim());
    } else {
      return NextResponse.json({ error: "Invalid stage" }, { status: 400 });
    }

    if (!result.output.trim()) {
      return NextResponse.json({ error: "Model returned an empty response" }, { status: 502 });
    }

    const ts = new Date().toISOString();
    // Audit trail: every other model call records the prompt it ran with.
    void recordPromptUsed(runId, stage === "stage1" ? "stage1" : "stage2", result.systemUsed).catch(() => {});
    await updateRun(runId, {
      [`${result.field}_edited`]: result.output,
      [result.stageTimestamp]: ts,
      last_updated_at: ts,
    } as Partial<Run>);

    // Regenerated Stage 2 copy → refresh the structured per-field JSON so the
    // Copy tab matches the new text. This must be AWAITED: the client reloads
    // the page as soon as this response returns, so a fire-and-forget refresh
    // loses the race and the Copy tab keeps showing the old structure. Still
    // best-effort — a structuring failure never fails the regeneration itself.
    if (stage === "stage2") {
      // Only a rebuild ON the angle clears the stale flag. A plain "make it
      // warmer" edit used to clear it too, hiding that the copy still predates
      // the angle change.
      if (body.mode === "angle") {
        await updateRun(runId, { stage2_angle_key: angleKey(run.product_angle_selected) }).catch(() => {});
      }
      try {
        const structured = await structureStage2Copy(result.output, runId);
        if (structured) await updateRun(runId, { stage2_json: JSON.stringify(structured), stage2_json_at: new Date().toISOString(), gdoc_appended_at: null });
      } catch (e) {
        console.error("[stage2 structure] regen:", e);
      }
    }

    return NextResponse.json({ success: true, output: result.output });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Regeneration failed for ${stage}:`, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function ask(args: { system: string | Anthropic.TextBlockParam[]; user: string; maxTokens: number; role: ModelRole; runId?: number; label?: string }): Promise<string> {
  const model = await getModel(args.role);
  const response = await client.messages.create({
    model,
    max_tokens: args.maxTokens,
    system: args.system,
    messages: [{ role: "user", content: args.user }],
  });
  void recordUsage(args.runId ?? null, args.label ?? `regenerate ${args.role}`, model, response.usage);
  // Opus 5 thinks by default, so content[0] can be a thinking block — find the
  // text block instead of assuming it comes first.
  return response.content.find((b) => b.type === "text")?.text ?? "";
}

/** Return revised version if present, else original. */
function pickRevised(run: Run, base: "step_research" | "step_avatar" | "step_offer_brief" | "step_necessary_beliefs"): string {
  if (base === "step_research") return run.step_research_revised ?? run.step_research ?? "";
  if (base === "step_avatar") return run.step_avatar_revised ?? run.step_avatar ?? "";
  if (base === "step_offer_brief") return run.step_offer_brief_revised ?? run.step_offer_brief ?? "";
  return run.step_necessary_beliefs_revised ?? run.step_necessary_beliefs ?? "";
}

// ── Stage 1: regenerate the one-pager ─────────────────────────────────────────
async function regenerateStage1(run: Run, instructions: string): Promise<RegenResult> {
  const currentOnePager = run.stage1_one_pager_edited ?? run.stage1_one_pager ?? "";
  if (!currentOnePager) throw new Error("No Stage 1 one-pager to regenerate yet");

  const research = pickRevised(run, "step_research");
  const avatar = pickRevised(run, "step_avatar");
  const offer = pickRevised(run, "step_offer_brief");
  const beliefs = pickRevised(run, "step_necessary_beliefs");
  // Same reasoning as the copy path: a revision must honour the rules the
  // document was written under (Settings override included).
  const onePagerRules = await getPrompt("stage1");
  // The generator's system carries past thumbs feedback; a rewrite that drops
  // it quietly loses the steer the operator already gave.
  const onePagerFeedback = await buildStage1FeedbackBlock().catch(() => "");

  // Cache layout: the task rules + the big research context are byte-stable
  // across edit clicks, so they form the cached prefix. The things that change
  // per click (the current one-pager, the instructions) live in the user
  // message, after the breakpoint. Repeat clicks re-bill only those.
  const system: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: `${onePagerRules}${onePagerFeedback}

════════════════════════════════════════════════════════════════════
YOU ARE REVISING A ONE-PAGER THAT ALREADY EXISTS
════════════════════════════════════════════════════════════════════

Everything above is the standard it is held to and applies in full to your rewrite.

You are regenerating a Stage 1 product research one-pager based on user feedback.

You have access to all the underlying research documents, so you can pull in more detail, change focus, adjust tone, etc.

YOUR TASK:
Regenerate the one-pager following the user's instructions. Maintain the same markdown structure:

# [Product Name]

## Benefits
1-10 numbered bullets — concrete outcomes, not features

## Use Cases
1-5 numbered bullets — concrete scenarios, not categories

## USPs
1-3 dash bullets — genuine differentiators vs competitors named in research

Apply the user's requested changes while keeping the format consistent. If they ask for "more technical detail" pull from the research docs. If they ask for "warmer tone" adjust the language. If they ask to "focus on X" prioritise that aspect.

Return ONLY the regenerated markdown one-pager. No preamble, no explanation, no code fences.`,
    },
    {
      type: "text",
      text: [
        "FULL RESEARCH CONTEXT:",
        "",
        "PRODUCT RESEARCH (identification, market, competitive, product analysis, visual):",
        research,
        "",
        "---",
        "",
        "CUSTOMER AVATAR:",
        avatar,
        "",
        "---",
        "",
        "OFFER BRIEF:",
        offer,
        "",
        "---",
        "",
        "NECESSARY BELIEFS:",
        beliefs,
      ].join("\n"),
      cache_control: { type: "ephemeral" },
    },
  ];

  const user = [
    "CURRENT ONE-PAGER:",
    currentOnePager,
    "",
    "USER'S EDIT INSTRUCTIONS:",
    instructions,
    "",
    "Regenerate the one-pager now.",
  ].join("\n");

  const output = await ask({ system, user, maxTokens: 32_000, role: "stage1", runId: run.id, label: "stage1: edit with AI" });
  return { field: "stage1_one_pager", stageTimestamp: "stage1_edited_at", output, systemUsed: system.map((b) => b.text).join("\n\n") };
}

// ── Stage 2: regenerate the copy ──────────────────────────────────────────────
async function regenerateStage2(run: Run, instructions: string): Promise<RegenResult> {
  const currentCopy = run.stage2_copy_edited ?? run.stage2_output ?? "";
  if (!currentCopy) throw new Error("No Stage 2 copy to regenerate yet");

  const onePager = run.stage1_one_pager_edited ?? run.stage1_one_pager ?? "";
  const research = pickRevised(run, "step_research");
  const avatar = pickRevised(run, "step_avatar");

  // Same cache layout as stage 1: stable rules + research context cached,
  // the per-click parts (current copy, instructions) after the breakpoint.
  // Observed cost of NOT doing this: 5 edit clicks on one run = 125k Opus
  // input tokens billed in full ($0.85).
  // The rules the copy was WRITTEN under have to apply to every rewrite too —
  // banned phrases, no em dashes, claim safety, the FAQ format, pricing out of
  // scope. Without them an edit quietly drops the house style. getPrompt honours
  // the live Settings override, so a rewrite follows the same text as Stage 3.
  const copyRules = await getPrompt("stage2");
  const copyFeedback = await buildStage2FeedbackBlock().catch(() => "");
  const system: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: `${copyRules}${copyFeedback}

════════════════════════════════════════════════════════════════════
YOU ARE REVISING COPY THAT ALREADY EXISTS
════════════════════════════════════════════════════════════════════

Everything above is the standard this copy is held to. It applies in full to your rewrite: every rule about banned phrases, punctuation (no em dashes), claim safety, structure, tone and what is out of scope.

YOUR TASK:
Regenerate the copy following the user's instructions. Keep the same section structure that was already in the current copy. Apply the requested changes consistently.

If they ask for "more technical" add specifications. If they ask for "shorter" condense. If they ask to "emphasise X" make that the focus. If they ask for "warmer tone" adjust language accordingly.

Where the instructions and the rules above genuinely conflict, follow the instructions for what to say and the rules for how to say it.

Return ONLY the regenerated copy. No preamble, no explanation, no code fences.`,
    },
    {
      type: "text",
      text: [
        "STAGE 1 RESEARCH CONTEXT:",
        "",
        "ONE-PAGER (English summary):",
        onePager,
        "",
        "---",
        "",
        "FULL PRODUCT RESEARCH:",
        research,
        "",
        "---",
        "",
        "AVATAR:",
        avatar,
      ].join("\n"),
      cache_control: { type: "ephemeral" },
    },
  ];

  const angle = anglesBlock(parseSelectedAngles(run.product_angle_selected));
  const user = [
    ...(angle ? ["POSITIONING ANGLE (the copy is built around this):", angle, ""] : []),
    "CURRENT COPY:",
    currentCopy,
    "",
    "USER'S EDIT INSTRUCTIONS:",
    instructions,
    "",
    "Now regenerate the copy following the user's instructions.",
  ].join("\n");

  const output = await ask({ system, user, maxTokens: 32_000, role: "stage2", runId: run.id, label: "stage2: edit with AI" });
  return { field: "stage2_copy", stageTimestamp: "stage2_edited_at", output, systemUsed: system.map((b) => b.text).join("\n\n") };
}



