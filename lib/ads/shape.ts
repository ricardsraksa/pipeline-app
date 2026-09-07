// Stage 5 · Image ads — client-safe types and helpers. Five fixed concepts,
// one ad each. The writer fills the operator's templates; the operator reviews
// premise + prompt before anything generates (same gate idea as Stage 4).

export type AdConcept = "before_after" | "features" | "handwritten" | "testimonial" | "problem_solution";

export const AD_CONCEPTS: Array<{ key: AdConcept; index: number; label: string; what: string }> = [
  { key: "before_after", index: 1, label: "Before / After", what: "Split screen, problem state vs. result with the product in the after side." },
  { key: "features", index: 2, label: "Features & Benefits", what: "Studio product shot with leader-line callouts, spec-sheet feel." },
  { key: "handwritten", index: 3, label: "Handwritten Note", what: "UGC phone photo, product next to a handwritten hook on a note." },
  { key: "testimonial", index: 4, label: "Testimonial", what: "Editorial shot with a real customer quote, stars and a Shop Now." },
  { key: "problem_solution", index: 5, label: "Problem / Solution", what: "Split layout: pain-point list vs. product in use with The Fix." },
];

export interface AdPrompt {
  index: number;
  concept: AdConcept;
  concept_label: string;
  /** What the ad shows and why it should work — the thing the operator approves. */
  premise: string;
  /** The main on-image line (headline / hook / quote). */
  headline: string;
  /** Where any quote or stat came from, or "none" when the ad carries neither. */
  proof: string;
  prompt: string;
  model: string;
  aspect_ratio: string;
  source_image_references: string[];
}

export interface AdImage {
  index: number;
  concept: AdConcept;
  image_url: string;
  status: "done" | "failed";
  error?: string;
  verdict?: "pass" | "fail";
  issues?: string[];
  user_override?: "pass" | "fail" | null;
  history?: Array<{ image_url: string; prompt?: string }>;
}

export type AdsStep = "writing" | "review" | "generating" | "done";

export function parseAdPrompts(raw: string | null | undefined): AdPrompt[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as AdPrompt[]).filter((p) => p && typeof p.index === "number") : [];
  } catch { return []; }
}

export function parseAdImages(raw: string | null | undefined): AdImage[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as AdImage[]).filter((p) => p && typeof p.index === "number") : [];
  } catch { return []; }
}

export function conceptLabel(key: string): string {
  return AD_CONCEPTS.find((c) => c.key === key)?.label ?? key.replace(/_/g, " ");
}
