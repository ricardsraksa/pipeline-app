// Single source of truth for the Shopify metafield hand-off: the store's exact
// visible field names (including its real "Section 1 Heading" vs
// "Section 2/3 Headline" inconsistency) mapped to the Stage 2 copy kit.
// The Copy tab renders from this list and the pusher writes from it — one
// list, so they can't drift.

import type { Stage2Json } from "@/lib/stage2/shape";
import { whatsIncluded } from "@/lib/stage2/shape";

export interface ShopifyField {
  /** The metafield definition's visible name in the Shopify admin. */
  label: string;
  get(j: Stage2Json): string;
}

const sec = (j: Stage2Json, i: number) => j.sections[i] ?? { headline: "", paragraph: "" };
const faq = (j: Stage2Json, i: number) => j.faqs[i] ?? { q: "", a: "" };

// Product Title is NOT here — it's the product's own title, not a metafield.
export const SHOPIFY_FIELDS: ShopifyField[] = [
  { label: "PDP Badge Text", get: (j) => j.badge ?? "" },
  { label: "PDP Title Support Text", get: (j) => j.supporting_sentence ?? "" },
  { label: "PDP Benefit 1", get: (j) => j.benefits[0] ?? "" },
  { label: "PDP Benefit 2", get: (j) => j.benefits[1] ?? "" },
  { label: "PDP Benefit 3", get: (j) => j.benefits[2] ?? "" },
  { label: "What's Included (Answer)", get: (j) => whatsIncluded(j) },
  { label: "Product Specific Question 1", get: (j) => faq(j, 0).q },
  { label: "Product Specific Answer 1", get: (j) => faq(j, 0).a },
  { label: "Product Specific Question 2", get: (j) => faq(j, 1).q },
  { label: "Product Specific Answer 2", get: (j) => faq(j, 1).a },
  { label: "Section 1 Heading", get: (j) => sec(j, 0).headline },
  { label: "Section 1 Text", get: (j) => sec(j, 0).paragraph },
  { label: "Section 2 Headline", get: (j) => sec(j, 1).headline },
  { label: "Section 2 Text", get: (j) => sec(j, 1).paragraph },
  { label: "Section 3 Headline", get: (j) => sec(j, 2).headline },
  { label: "Section 3 Text", get: (j) => sec(j, 2).paragraph },
];

/** Normalized form used to match our labels against store definition names. */
export function normalizeLabel(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
