// Schwartz's two market coordinates (Breakthrough Advertising, ch. 2 and 3):
// how much the buyer already knows about this kind of product (awareness), and
// how many similar products she has already been sold (sophistication).
//
// Stage 2 research diagnoses both; the operator can correct them at the angles
// gate. Everything downstream — angles, copy, ads — is handed the rules for
// the diagnosed pair only, never the whole theory.

export type AwarenessStage = "unaware" | "problem" | "solution" | "product" | "most";
export type SophisticationStage = 1 | 2 | 3 | 4 | 5;

export interface MarketPosition {
  awareness: AwarenessStage;
  sophistication: SophisticationStage;
  /** "research" = parsed from the Stage 2 analysis; "manual" = the operator set it. */
  source: "research" | "manual";
  at: string;
}

export const AWARENESS_STAGES: AwarenessStage[] = ["unaware", "problem", "solution", "product", "most"];
export const SOPHISTICATION_STAGES: SophisticationStage[] = [1, 2, 3, 4, 5];

export const AWARENESS_LABEL: Record<AwarenessStage, string> = {
  unaware: "Unaware",
  problem: "Problem aware",
  solution: "Solution aware",
  product: "Product aware",
  most: "Most aware",
};

export const SOPHISTICATION_LABEL: Record<SophisticationStage, string> = {
  1: "1 · First of its kind",
  2: "2 · Claims being outbid",
  3: "3 · Claims worn out",
  4: "4 · Mechanisms copied",
  5: "5 · Nothing believed",
};

// What each state demands of the opening. One paragraph per stage, in the
// operator's own market terms — not a lecture on the book.
const AWARENESS_RULE: Record<AwarenessStage, string> = {
  most:
    "She knows this product and already wants it; she simply has not bought yet. Say the product name and what makes buying now worth it. Keep the opening short — anything you add past that is in the way.",
  product:
    "She knows products like this exist and is comparing them. Lead with what makes THIS one better: a sharper claim, new proof, or a mechanism the others do not have. The product belongs in the headline.",
  solution:
    "She knows the outcome she wants but does not know a product like this delivers it. Lead with the outcome, prove it can actually be had, then show the mechanism inside this product that delivers it. Do not open on the product name.",
  problem:
    "She feels the problem but has not gone looking for a category of solution. Open on the problem — or the problem and its answer together — make her feel what it costs her, then present the product as the inevitable answer. Never open on the product name or on price.",
  unaware:
    "She does not yet frame this as a problem. The product name, the price and the promise all mean nothing to her, so none of them can open the copy. Open by describing her situation so exactly that she recognises herself, then move her from that recognition to the problem, to the fact that it can be solved, and only then to the product.",
};

const SOPHISTICATION_RULE: Record<SophisticationStage, string> = {
  1: "She has never been sold anything like this. Be plain and direct: state the claim once, dramatise it, prove the product delivers it. No cleverness — none is needed.",
  2: "The claim has been made before and still works. Take it further than anyone else does — bigger, faster, more complete — and stop at the edge of what she will still believe.",
  3: "Every version of the claim has been made and she has stopped believing them. Lead with the MECHANISM, not the claim: the opening says how it works, and the claim follows underneath as the result of that mechanism. A bigger claim cannot win here — only a new reason to believe the old one.",
  4: "The mechanisms have been copied too. Take the mechanism further — easier, quicker, more complete, fewer limits — or bring one that is genuinely different. Do not restate the bare claim.",
  5: "She no longer believes claims or mechanisms in this category. Stop arguing. Open on who she is and what her situation actually feels like, so she recognises herself before she is sold anything; the product earns its place afterwards, through proof rather than promise.",
};

/** The block handed to angles, copy and ads: only the diagnosed pair's rules. */
export function marketBlock(mp: MarketPosition | null): string {
  if (!mp) return "";
  return [
    "MARKET POSITION (where this buyer stands before she reads a word — obey both lines; they decide how the copy opens):",
    `Awareness — ${AWARENESS_LABEL[mp.awareness]}. ${AWARENESS_RULE[mp.awareness]}`,
    `Sophistication — Stage ${mp.sophistication}, ${SOPHISTICATION_LABEL[mp.sophistication].split("· ")[1]}. ${SOPHISTICATION_RULE[mp.sophistication]}`,
  ].join("\n");
}

const AWARENESS_WORDS: Array<[RegExp, AwarenessStage]> = [
  [/most[\s-]*aware/i, "most"],
  [/product[\s-]*aware/i, "product"],
  [/solution[\s-]*aware/i, "solution"],
  [/problem[\s-]*aware/i, "problem"],
  [/unaware|completely unaware/i, "unaware"],
];

/** Read the two machine lines the research analysis ends with. */
export function parseMarketPosition(research: string | null | undefined): { awareness: AwarenessStage; sophistication: SophisticationStage } | null {
  if (!research) return null;
  const aLine = research.match(/^\s*AWARENESS:\s*(.+)$/im)?.[1] ?? "";
  const sLine = research.match(/^\s*SOPHISTICATION:\s*(.+)$/im)?.[1] ?? "";
  let awareness: AwarenessStage | null = null;
  for (const [re, stage] of AWARENESS_WORDS) { if (re.test(aLine)) { awareness = stage; break; } }
  const sNum = Number(sLine.match(/[1-5]/)?.[0]);
  const sophistication = SOPHISTICATION_STAGES.includes(sNum as SophisticationStage) ? (sNum as SophisticationStage) : null;
  if (!awareness || !sophistication) return null;
  return { awareness, sophistication };
}

export function validateMarketPosition(x: unknown): string | null {
  const mp = x as Partial<MarketPosition> | null;
  if (!mp || typeof mp !== "object") return "market_position object required";
  if (!AWARENESS_STAGES.includes(mp.awareness as AwarenessStage)) return "awareness must be unaware, problem, solution, product or most";
  if (!SOPHISTICATION_STAGES.includes(mp.sophistication as SophisticationStage)) return "sophistication must be 1–5";
  if (mp.source !== "research" && mp.source !== "manual") return "source must be research or manual";
  return null;
}

export function parseStoredMarketPosition(json: string | null | undefined): MarketPosition | null {
  if (!json) return null;
  try {
    const mp = JSON.parse(json) as MarketPosition;
    return validateMarketPosition(mp) ? null : mp;
  } catch { return null; }
}
