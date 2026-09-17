// The one-pager is the only research the operator sees and edits, but the
// documents under it (research, avatar, offer brief, beliefs) are what the
// later stages were reading — so correcting the one-pager changed nothing
// downstream. This module makes the operator's version authoritative: every
// later stage receives it, labelled as overriding the documents it summarises,
// together with the instructions the operator gave when revising it.
import type { Run } from "@/lib/db";

export interface ResearchEditNote { at: string; note: string }

type Fields = Pick<Run, "stage1_one_pager" | "stage1_one_pager_edited" | "research_edit_notes">;

export function parseResearchNotes(raw: string | null | undefined): ResearchEditNote[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((n): n is ResearchEditNote => !!n && typeof n.note === "string" && typeof n.at === "string") : [];
  } catch { return []; }
}

/** Append one revision instruction (newest last, capped). Returns the JSON to store. */
export function appendResearchNote(raw: string | null | undefined, note: string): string {
  const next = [...parseResearchNotes(raw), { at: new Date().toISOString(), note: note.trim().slice(0, 1000) }].slice(-10);
  return JSON.stringify(next);
}

export function researchWasEdited(run: Fields): boolean {
  const edited = run.stage1_one_pager_edited?.trim();
  return Boolean(edited && edited !== (run.stage1_one_pager ?? "").trim());
}

/**
 * The one-pager as later stages should read it. Unedited: the text as is.
 * Edited: the operator's text under a header saying it wins over the research
 * documents, followed by the revision instructions in their own words.
 */
export function onePagerForDownstream(run: Fields): string {
  const text = (run.stage1_one_pager_edited ?? run.stage1_one_pager ?? "").trim();
  if (!text) return "";
  if (!researchWasEdited(run)) return text;
  const notes = parseResearchNotes(run.research_edit_notes);
  return [
    "OPERATOR-REVISED — AUTHORITATIVE. The operator corrected this one-pager after the research documents were written. Wherever it disagrees with the research, avatar, offer brief or necessary beliefs, THIS is right and they are out of date: follow it, and do not carry the contradicted detail through.",
    ...(notes.length ? ["", "What the operator asked for when revising it:", ...notes.map((n) => `- ${n.note}`)] : []),
    "",
    text,
  ].join("\n");
}

/** Fingerprint of the research as the operator currently has it. Null when there is none. */
export function researchKey(run: Fields): string | null {
  const s = (run.stage1_one_pager_edited ?? run.stage1_one_pager ?? "").trim();
  if (!s) return null;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
