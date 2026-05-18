import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { REVISE_DOC_PROMPT } from "@/lib/prompts/revise_doc";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface DocRevision {
  docName: string;
  changes: string;
}

function parseRevisions(chiefFinal: string): DocRevision[] {
  const revisions: DocRevision[] = [];
  // Find the "Revisions Required" section
  const revisionsMatch = chiefFinal.match(/Revisions Required[\s\S]*/i);
  if (!revisionsMatch) return revisions;

  const revisionsSection = revisionsMatch[0];

  // Parse each DOCUMENT: ... CHANGES: ... block
  const docPattern = /DOCUMENT:\s*(\S+\.txt)\s*\nCHANGES:\s*([\s\S]*?)(?=\nDOCUMENT:|\n?$)/gi;
  let match;
  while ((match = docPattern.exec(revisionsSection)) !== null) {
    const docName = match[1].trim();
    const changes = match[2].trim();
    if (changes) {
      revisions.push({ docName, changes });
    }
  }

  return revisions;
}

async function reviseDoc(original: string, docType: string, changes: string): Promise<string> {
  const userMessage = `Document type: ${docType}\n\nOriginal document:\n\n${original}\n\n---\n\nRequired changes:\n\n${changes}`;

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 4000,
    system: REVISE_DOC_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  return message.content.find((b) => b.type === "text")?.text ?? original;
}

export async function POST(req: NextRequest) {
  const { chief_final, avatar, offer_brief, necessary_beliefs } = await req.json();

  if (chief_final.includes("NO REVISIONS REQUIRED")) {
    return Response.json({
      success: true,
      avatar_revised: avatar,
      offer_brief_revised: offer_brief,
      necessary_beliefs_revised: necessary_beliefs,
      skipped: true,
    });
  }

  const revisions = parseRevisions(chief_final);

  let avatar_revised = avatar;
  let offer_brief_revised = offer_brief;
  let necessary_beliefs_revised = necessary_beliefs;

  try {
    for (const revision of revisions) {
      if (revision.docName === "AVATAR.txt") {
        avatar_revised = await reviseDoc(avatar, "AVATAR.txt", revision.changes);
      } else if (revision.docName === "OFFER_BRIEF.txt") {
        offer_brief_revised = await reviseDoc(offer_brief, "OFFER_BRIEF.txt", revision.changes);
      } else if (revision.docName === "NECESSARY_BELIEFS.txt") {
        necessary_beliefs_revised = await reviseDoc(necessary_beliefs, "NECESSARY_BELIEFS.txt", revision.changes);
      }
    }

    return Response.json({
      success: true,
      avatar_revised,
      offer_brief_revised,
      necessary_beliefs_revised,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ success: false, error: msg }, { status: 500 });
  }
}
