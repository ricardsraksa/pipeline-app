import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getRun, updateRun } from "@/lib/db";
import { ONE_PAGER_PROMPT } from "@/lib/prompts/one_pager";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const CLAUDE_MODEL = "claude-sonnet-4-5-20250929";

export async function POST(req: NextRequest) {
  const { runId } = (await req.json()) as { runId?: number };
  if (!runId) return NextResponse.json({ error: "runId required" }, { status: 400 });

  const run = await getRun(runId);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  // Use revised versions if present (these are the "final" Stage 1 docs)
  const research = run.step_research_revised ?? run.step_research;
  const avatar = run.step_avatar_revised ?? run.step_avatar;
  const offer = run.step_offer_brief_revised ?? run.step_offer_brief;
  const beliefs = run.step_necessary_beliefs_revised ?? run.step_necessary_beliefs;

  if (!research || !avatar || !offer || !beliefs) {
    return NextResponse.json(
      { error: "Stage 1 research, avatar, offer brief, and beliefs must all be present" },
      { status: 400 }
    );
  }

  try {
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2000,
      system: ONE_PAGER_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            "Here are the research documents for this product. Synthesize them into the one-pager.",
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
        },
      ],
    });

    const onePager =
      response.content[0]?.type === "text" ? response.content[0].text : "";
    if (!onePager) {
      return NextResponse.json({ error: "Empty response from model" }, { status: 502 });
    }

    await updateRun(runId, {
      stage1_one_pager: onePager,
      last_updated_at: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, onePager });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("One-pager generation failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
