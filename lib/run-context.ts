// One shared context for a run.
//
// Every stage is built from what came before it, and the operator can edit any
// of it at any time. Two things have to follow from an edit: the stages built
// later must RECEIVE it (the edited text, plus what the operator asked for),
// and the stages built earlier must SAY they are now out of date. This module
// owns both, so a new edit point only has to record itself here.
import type { Run } from "@/lib/db";
import { onePagerForDownstream, researchWasEdited } from "@/lib/research-edits";
import { parseSelectedAngles } from "@/lib/angles";
import { parseStoredAudience } from "@/lib/audience";

/** The parts of a run's context that anything downstream can depend on. */
export type ContextPart = "product" | "audience" | "research" | "angles" | "copy" | "images";

/** Stages that are generated from that context. */
export type BuiltStage = "angles" | "stage2" | "stage3" | "ads";

/** What each stage is built from. Editing any of these makes it out of date. */
export const DEPENDS: Record<BuiltStage, ContextPart[]> = {
  angles: ["product", "audience", "research"],
  stage2: ["product", "audience", "research", "angles"],
  stage3: ["product", "audience", "research", "angles", "copy"],
  ads: ["product", "audience", "research", "angles", "copy", "images"],
};

export const PART_LABEL: Record<ContextPart, string> = {
  product: "the product description",
  audience: "who it's for",
  research: "the research",
  angles: "the angle",
  copy: "the copy",
  images: "the images",
};

const BUILT_ON_COLUMN: Record<BuiltStage, "angles_built_on" | "stage2_built_on" | "stage3_built_on" | "ads_built_on"> = {
  angles: "angles_built_on",
  stage2: "stage2_built_on",
  stage3: "stage3_built_on",
  ads: "ads_built_on",
};

// ── The edit log ────────────────────────────────────────────────────────────

export type EditKind = ContextPart | "image_prompts" | "ads_briefs";
export interface RunEdit {
  at: string;
  kind: EditKind;
  /** "hand" = typed over it, "ai" = asked for a rewrite (note holds the ask). */
  how: "hand" | "ai";
  note?: string;
}

const EDIT_LABEL: Record<EditKind, string> = {
  product: "Product description",
  audience: "Who it's for (buyer and user)",
  research: "Research one-pager",
  angles: "Positioning angle",
  copy: "Copy kit",
  images: "Images",
  image_prompts: "Image prompts",
  ads_briefs: "Ad briefs",
};

export function parseEdits(raw: string | null | undefined): RunEdit[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((e): e is RunEdit => !!e && typeof e.at === "string" && typeof e.kind === "string") : [];
  } catch { return []; }
}

/** Append one edit (newest last, capped). Returns the JSON to store. */
export function appendEdit(raw: string | null | undefined, edit: { kind: EditKind; how: "hand" | "ai"; note?: string }): string {
  const note = edit.note?.trim().slice(0, 500);
  const next: RunEdit = { at: new Date().toISOString(), kind: edit.kind, how: edit.how, ...(note ? { note } : {}) };
  const all = parseEdits(raw);
  // Collapse a burst of identical hand-edits (typing, saving, saving again)
  // into the latest one — the log is for the models, not an audit trail.
  const last = all[all.length - 1];
  const collapse = last && last.kind === next.kind && last.how === "hand" && next.how === "hand";
  return JSON.stringify([...(collapse ? all.slice(0, -1) : all), next].slice(-40));
}

/**
 * What the operator changed by hand, as a prompt block — limited to the parts
 * the stage being written actually depends on. Without this a model gets the
 * corrected text but no idea which parts were deliberate corrections.
 */
export function editsBlock(run: Pick<Run, "run_edits">, parts: readonly EditKind[]): string {
  const wanted = new Set<EditKind>(parts);
  const edits = parseEdits(run.run_edits).filter((e) => wanted.has(e.kind));
  if (!edits.length) return "";
  const lines = edits.map((e) => {
    const what = EDIT_LABEL[e.kind] ?? e.kind;
    return e.note ? `- ${what} — the operator asked for: "${e.note}"` : `- ${what} — edited by hand`;
  });
  return [
    "WHAT THE OPERATOR CHANGED (most recent last). These are deliberate corrections to the material below: follow them, and do not reintroduce what they removed.",
    ...lines,
  ].join("\n");
}

// ── Effective values ────────────────────────────────────────────────────────

/** The product description as it now stands: the operator's edit wins. */
export function effectiveDescription(run: Partial<Pick<Run, "product_description_edited" | "product_description_ai" | "product_description" | "product_name">>): string {
  return (run.product_description_edited ?? run.product_description_ai ?? run.product_description ?? run.product_name ?? "").trim();
}

/** The copy kit as it now stands: the operator's edit wins. */
export function effectiveCopy(run: Partial<Pick<Run, "stage2_copy_edited" | "stage2_output">>): string {
  return (run.stage2_copy_edited ?? run.stage2_output ?? "").trim();
}

// ── Fingerprints ────────────────────────────────────────────────────────────

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
const keyOf = (s: string): string | null => (s.trim() ? hash(s.trim()) : null);

export type ContextKeys = Partial<Record<ContextPart, string | null>>;

/** Fingerprint of every part of the context as it stands right now. */
export function contextKeys(run: Run): ContextKeys {
  const angles = parseSelectedAngles(run.product_angle_selected);
  let images: string | null = null;
  try {
    const arr = JSON.parse(run.stage3_remaining_images ?? "[]") as Array<{ index?: number; image_url?: string; status?: string }>;
    const done = Array.isArray(arr) ? arr.filter((im) => im?.image_url && im.status === "done").map((im) => `${im.index}:${im.image_url}`).sort() : [];
    images = done.length ? hash([run.stage3_hero_image_url ?? "", ...done].join("|")) : null;
  } catch { images = null; }
  return {
    product: keyOf(effectiveDescription(run)),
    audience: (() => {
      const a = parseStoredAudience(run.audience);
      return a ? hash(JSON.stringify([a.buyer, a.same, a.same ? "" : a.user, a.same ? "" : a.relation ?? ""])) : null;
    })(),
    research: keyOf(run.stage1_one_pager_edited ?? run.stage1_one_pager ?? ""),
    angles: angles.length ? hash(JSON.stringify(angles.map((a) => [a.id, a.title, a.problem, a.mechanism, a.hook]))) : null,
    copy: keyOf(effectiveCopy(run)),
    images,
  };
}

/** The fingerprints to store with a stage: only the parts it depends on. */
export function builtOnFor(run: Run, stage: BuiltStage): string {
  const keys = contextKeys(run);
  const out: ContextKeys = {};
  for (const part of DEPENDS[stage]) out[part] = keys[part] ?? null;
  return JSON.stringify(out);
}

/** A stage the operator accepted as it stands carries a full fingerprint, so
 *  the log fallback no longer applies to it. */
function storedBuiltOn(run: Run, stage: BuiltStage): ContextKeys | null {
  const raw = run[BUILT_ON_COLUMN[stage]];
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as ContextKeys) : null;
  } catch { return null; }
}

/** Does this stage exist yet? Nothing that was never built can be out of date. */
function stageExists(run: Run, stage: BuiltStage): boolean {
  switch (stage) {
    case "angles": return Boolean(run.product_angles);
    case "stage2": return Boolean(run.stage2_output);
    case "stage3": return Boolean(run.stage3_remaining_prompts || run.stage3_hero_image_url);
    case "ads": return Boolean(run.ads_prompts);
  }
}

/** Which context part an edit is about ("image_prompts" is an edit to the images). */
function partOfKind(kind: EditKind): ContextPart {
  return kind === "image_prompts" ? "images" : kind === "ads_briefs" ? "images" : kind;
}

/**
 * Which parts of the context have changed since this stage was built.
 * Runs built before fingerprints existed fall back to the keys of the day, and
 * then to the edit log: the log starts with this feature, so anything in it
 * happened after an un-fingerprinted stage was built and that stage is out of
 * date. Older still — an edited one-pager with no log — counts as a research
 * change, because those stages were written without ever reading it.
 */
export function changedSince(run: Run, stage: BuiltStage): ContextPart[] {
  if (!stageExists(run, stage)) return [];
  const now = contextKeys(run);
  const built = storedBuiltOn(run, stage);
  const legacy: ContextKeys = built ? {} : {
    research: stage === "angles" ? run.angles_research_key
      : stage === "stage2" ? run.stage2_research_key
      : stage === "stage3" ? run.stage3_research_key
      : run.ads_research_key,
    angles: stage === "stage2" ? run.stage2_angle_key
      : stage === "stage3" ? run.stage3_angle_key
      : stage === "ads" ? run.ads_angle_key
      : null,
  };
  const edits = parseEdits(run.run_edits);
  const out: ContextPart[] = [];
  for (const part of DEPENDS[stage]) {
    const current = now[part] ?? null;
    if (!current) continue;                       // nothing there to be out of date against
    const was = built ? built[part] ?? null : legacy[part] ?? null;
    if (was) { if (was !== current) out.push(part); continue; }
    // No fingerprint for this part: fall back to the edit log, then to the
    // one-pager's own edited flag.
    if (edits.some((e) => partOfKind(e.kind) === part)) out.push(part);
    else if (part === "research" && researchWasEdited(run)) out.push(part);
  }
  return out;
}

/** The whole picture for the UI: what changed since each stage was built. */
export function contextStatus(run: Run): Record<BuiltStage, ContextPart[]> {
  return {
    angles: changedSince(run, "angles"),
    stage2: changedSince(run, "stage2"),
    stage3: changedSince(run, "stage3"),
    ads: changedSince(run, "ads"),
  };
}

/** "the research and the copy" — for the one-line notice. */
export function partsSentence(parts: ContextPart[]): string {
  const labels = parts.map((p) => PART_LABEL[p]);
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/**
 * The context block every downstream writer receives: what the operator
 * changed, limited to the parts this stage is built from.
 */
export function contextBlock(run: Run, stage: BuiltStage): string {
  const parts: EditKind[] = [...DEPENDS[stage]];
  // A prompt or brief edit is an instruction about the images/ads themselves.
  if (stage === "stage3") parts.push("image_prompts");
  if (stage === "ads") parts.push("image_prompts", "ads_briefs");
  const block = editsBlock(run, parts);
  return block ? `\n\n${block}` : "";
}

export { onePagerForDownstream };
