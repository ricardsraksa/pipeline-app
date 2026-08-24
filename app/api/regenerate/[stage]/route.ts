import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getRun, updateRun, type Run, recordUsage } from "@/lib/db";
import { structureStage2Copy } from "@/lib/stage2/format";
import { getModel, type ModelRole } from "@/lib/models";

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
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<unknown> }
) {
  const { stage } = (await context.params) as { stage: string };

  const body = (await req.json()) as { runId?: number; instructions?: string };
  const { runId, instructions } = body;

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
      try {
        const structured = await structureStage2Copy(result.output, runId);
        if (structured) await updateRun(runId, { stage2_json: JSON.stringify(structured) });
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

async function ask(args: { system: string; user: string; maxTokens: number; role: ModelRole; runId?: number; label?: string }): Promise<string> {
  const model = await getModel(args.role);
  const response = await client.messages.create({
    model,
    max_tokens: args.maxTokens,
    system: args.system,
    messages: [{ role: "user", content: args.user }],
  });
  void recordUsage(args.runId ?? null, args.label ?? `regenerate ${args.role}`, model, response.usage);
  const block = response.content[0];
  return block && block.type === "text" ? block.text : "";
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

  const system = `You are regenerating a Stage 1 product research one-pager based on user feedback.

You have access to all the underlying research documents, so you can pull in more detail, change focus, adjust tone, etc.

CURRENT ONE-PAGER:
${currentOnePager}

USER'S EDIT INSTRUCTIONS:
${instructions}

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

Return ONLY the regenerated markdown one-pager. No preamble, no explanation, no code fences.`;

  const user = [
    "Here is the full research context. Use it to regenerate the one-pager per the instructions.",
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
  ].join("\n");

  const output = await ask({ system, user, maxTokens: 2000, role: "stage1", runId: run.id, label: "stage1: edit with AI" });
  return { field: "stage1_one_pager", stageTimestamp: "stage1_edited_at", output };
}

// ── Stage 2: regenerate the copy ──────────────────────────────────────────────
async function regenerateStage2(run: Run, instructions: string): Promise<RegenResult> {
  const currentCopy = run.stage2_copy_edited ?? run.stage2_output ?? "";
  if (!currentCopy) throw new Error("No Stage 2 copy to regenerate yet");

  const onePager = run.stage1_one_pager_edited ?? run.stage1_one_pager ?? "";
  const research = pickRevised(run, "step_research");
  const avatar = pickRevised(run, "step_avatar");

  const system = `You are regenerating DTC product page copy based on user feedback.

CURRENT COPY:
${currentCopy}

USER'S EDIT INSTRUCTIONS:
${instructions}

YOUR TASK:
Regenerate the copy following the user's instructions. Keep the same section structure that was already in the current copy. Apply the requested changes consistently.

If they ask for "more technical" add specifications. If they ask for "shorter" condense. If they ask to "emphasise X" make that the focus. If they ask for "warmer tone" adjust language accordingly.

Return ONLY the regenerated copy. No preamble, no explanation, no code fences.`;

  const user = [
    "Here is the Stage 1 research context:",
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
    "",
    "Now regenerate the copy following the user's instructions.",
  ].join("\n");

  const output = await ask({ system, user, maxTokens: 8000, role: "stage2", runId: run.id, label: "stage2: edit with AI" });
  return { field: "stage2_copy", stageTimestamp: "stage2_edited_at", output };
}



