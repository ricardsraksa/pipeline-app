// Client-safe shape + validation for the Stage 2 copy kit.
//
// Kept separate from format.ts (which pulls in the Anthropic SDK and the DB via
// the model resolver) so client components can import the type and the warnings
// helper WITHOUT dragging server-only modules into the browser bundle.

// Structured shape of the Stage 2 German copy kit. Derived from the canonical
// free-text output (which stays untouched so the carefully-tuned copy and the
// 11pt-Arial Google-Docs paste are never disturbed). This JSON drives only the
// per-field copy UI and structure validation.
export interface Stage2Json {
  product_name: string;
  badge: string;
  supporting_sentence: string;
  benefits: string[];
  sections: { headline: string; paragraph: string }[];
  was_enthalten: string;
  faqs: { q: string; a: string }[];
  facebook: { headline: string; primary: string; description: string };
  one_liners: string[];
}

/** Quick structure warnings for the UI (informational — the text is canonical). */
export function stage2Warnings(j: Stage2Json): string[] {
  const w: string[] = [];
  if (j.benefits.length !== 3) w.push(`${j.benefits.length} Hauptvorteile (expected 3)`);
  if (j.sections.length !== 3) w.push(`${j.sections.length} headline sections (expected 3)`);
  if (j.faqs.length !== 2) w.push(`${j.faqs.length} FAQs (expected 2)`);
  if (j.one_liners.length !== 5) w.push(`${j.one_liners.length} one-liners (expected 5)`);
  return w;
}
