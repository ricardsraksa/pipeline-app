// Product codes (P58, P59, …) name the Google Doc tab and the Drive folder.
// The sequence is the app's runs and nothing else: the next code is the
// highest run code plus one. The master doc is NOT consulted — it carries tabs
// for products that never went through the app (Sep 18 2026: tabs up to P91
// against runs up to P77, which pushed every new run to P92). A number the doc
// already uses is therefore possible; /api/runs/next-code reports it, and the
// code stays editable on Home and in the rail.

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

/** Where the next number comes from — for the new-run form and for diagnosis. */
export async function productCodeDiagnostics(): Promise<{ highestInRuns: number; docConfigured: boolean; docNumbers: number[]; docHasNext: boolean }> {
  const [runs, taken] = await Promise.all([highestInRuns(), numbersInDoc()]);
  return {
    highestInRuns: runs,
    docConfigured: googleDocConfigured(),
    docNumbers: [...taken].sort((a, b) => a - b).slice(-40),
    // The doc already has a tab with this number: sending the run to Docs
    // would append into that tab, so it is worth knowing.
    docHasNext: taken.has(runs + 1),
  };
}

/** The next code in the sequence, e.g. "P78". Never throws. */
export async function nextProductCode(): Promise<string> {
  return `P${(await highestInRuns()) + 1}`;
}
