// Product codes (P58, P59, …) name the Google Doc tab and the Drive folder, so
// they must continue the operator's own sequence rather than restart it. The
// sequence is the app's runs: the next code is the highest run code plus one.
// The master doc is consulted only to step over a collision — a tab that
// already carries that exact number (a product made outside the app) — never
// to set the number, because one stray tab titled "P92" would otherwise drag
// every new run up to P93.

import { db } from "@/lib/db";
import { fetchDocTabs, googleDocConfigured } from "@/lib/google/docs";

const CODE_RE = /^\s*P\s*0*(\d{1,6})\b/i;

/** The number in a code or tab title ("P58 - Wall Lamp" → 58), else null. */
export function codeNumber(text: string | null | undefined): number | null {
  const m = typeof text === "string" ? text.match(CODE_RE) : null;
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** Highest product number the app knows about (0 when there is none). */
async function highestInRuns(): Promise<number> {
  try {
    const r = await db.execute("SELECT product_code FROM runs WHERE product_code IS NOT NULL");
    let max = 0;
    for (const row of r.rows as unknown as { product_code: string | null }[]) {
      const n = codeNumber(row.product_code);
      if (n && n > max) max = n;
    }
    return max;
  } catch {
    return 0;
  }
}

/** Product numbers already used as tab titles in the master doc (empty when unavailable). */
async function numbersInDoc(): Promise<Set<number>> {
  const out = new Set<number>();
  if (!googleDocConfigured()) return out;
  try {
    for (const t of await fetchDocTabs()) {
      const n = codeNumber(t.tabProperties?.title);
      if (n) out.add(n);
    }
  } catch {
    // The doc is a collision check, not the source of the sequence.
  }
  return out;
}

/** The next code in the sequence, e.g. "P75". Never throws. */
export async function nextProductCode(): Promise<string> {
  const [runs, taken] = await Promise.all([highestInRuns(), numbersInDoc()]);
  let n = runs + 1;
  while (taken.has(n)) n += 1;
  return `P${n}`;
}
