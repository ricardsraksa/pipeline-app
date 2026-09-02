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
  /** What the competitors in the research currently lead with on this ground. */
  competitor_angle?: string;
  /** The gap: why this angle is unclaimed or under-served by them. */
  gap?: string;
  /** How contested this ground is — drives the badge on the card. */
  crowding?: "open" | "partly-claimed" | "crowded";
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

/** The operator's selection: one or more angles, first = primary. Accepts the
 *  older single-object form too. */
export function parseSelectedAngles(json: string | null | undefined): Angle[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    const list = Array.isArray(v) ? v : [v];
    return list.filter((a) => a && typeof a === "object" && typeof a.title === "string") as Angle[];
  } catch {
    return [];
  }
}

function oneAngle(angle: Angle): string {
  return [
    `ANGLE: ${angle.title}`,
    `PROBLEM: ${angle.problem}`,
    `CONSEQUENCE IF UNSOLVED: ${angle.consequence}`,
    `WHY THIS PRODUCT SOLVES IT (MECHANISM): ${angle.mechanism}`,
    `WHO FEELS IT MOST: ${angle.who}`,
    `OPENING HOOK: ${angle.hook}`,
    ...(angle.competitor_angle ? [`WHAT COMPETITORS LEAD WITH (do not echo this — it is what everyone already says): ${angle.competitor_angle}`] : []),
    ...(angle.gap ? [`THE GAP WE TAKE: ${angle.gap}`] : []),
  ].join("\n");
}

/** The chosen angle(s) as a text block for the Copy and Image prompt writers.
 *  The first is the PRIMARY angle everything leads with; any others are
 *  supporting angles to weave in without competing with the primary. */
export function anglesBlock(angles: Angle[]): string {
  if (!angles.length) return "";
  const [primary, ...rest] = angles;
  const parts = [`PRIMARY ANGLE (lead with this everywhere):\n${oneAngle(primary)}`];
  if (rest.length) {
    parts.push(
      `SUPPORTING ANGLE${rest.length > 1 ? "S" : ""} (secondary — woven into benefits, sections and objections; never the headline, never competing with the primary):\n` +
        rest.map(oneAngle).join("\n\n"),
    );
  }
  return parts.join("\n\n");
}

/** @deprecated single-angle form kept for older call sites. */
export function angleBlock(angle: Angle | null): string {
  return angle ? anglesBlock([angle]) : "";
}
