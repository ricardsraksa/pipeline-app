// Positioning angles — the gate between Research (Stage 2) and Copy (Stage 3).
//
// After research, the strategist model proposes several PROBLEM-FIRST angles:
// each names a specific painful problem, the consequence of leaving it, why
// this product's mechanism fixes it, and who exactly feels it. The operator
// picks one (and may edit it); Copy and Images are then built around that one
// angle instead of a generic "best X / only Y" pitch.
//
// Pure types + helpers only (safe for client components). The generator lives
// in lib/angles-generate.ts.

export interface Angle {
  id: string;
  /** Short name, e.g. "Still water → kidney disease". */
  title: string;
  /** The specific problem, in the customer's world. */
  problem: string;
  /** What happens if it stays unsolved (the stakes). */
  consequence: string;
  /** Why THIS product's mechanism solves it (not features — cause and effect). */
  mechanism: string;
  /** Who exactly feels this problem most. */
  who: string;
  /** One-line hook a page or ad could open with. */
  hook: string;
  /** Why this beats "best X" / "only Y" framing for this product. */
  why_this_angle: string;
}

export function parseAngles(json: string | null | undefined): Angle[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((a) => a && typeof a === "object" && typeof a.title === "string") : [];
  } catch {
    return [];
  }
}

export function parseAngle(json: string | null | undefined): Angle | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" && typeof v.title === "string" ? (v as Angle) : null;
  } catch {
    return null;
  }
}

/** The angle as a text block for the Copy and Image prompt writers. */
export function angleBlock(angle: Angle | null): string {
  if (!angle) return "";
  return [
    `ANGLE: ${angle.title}`,
    `PROBLEM: ${angle.problem}`,
    `CONSEQUENCE IF UNSOLVED: ${angle.consequence}`,
    `WHY THIS PRODUCT SOLVES IT (MECHANISM): ${angle.mechanism}`,
    `WHO FEELS IT MOST: ${angle.who}`,
    `OPENING HOOK: ${angle.hook}`,
  ].join("\n");
}
