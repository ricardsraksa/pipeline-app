// Product codes (P58, P59, …) name the Google Doc tab and the Drive folder.
// Since the Import list (v2.106) the doc is the record again: the next code
// follows the highest number in the runs AND in doc tabs that no open Import
// item owns (those carry provisional numbers). Tab titles are read with any
// leading emoji ignored ("💦 P90 - Lamp" → 90). The code stays editable on
// Home and in the rail.

import { db } from "@/lib/db";
import { fetchDocTabs, googleDocConfigured } from "@/lib/google/docs";
import { codeNumber } from "@/lib/import/codes";
import { codeForStart } from "@/lib/import/numbering";
import { currentBase } from "@/lib/import/doc-ops";

// Emoji-tolerant ("💦 P90 - Lamp" → 90); lives in lib/import/codes.
export { codeNumber };

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

/** The next code in the sequence, e.g. "P92": after the highest number in
 *  the runs and in doc tabs no Import item owns. Never throws. */
export async function nextProductCode(): Promise<string> {
  try {
    return codeForStart(await currentBase());
  } catch {
    return codeForStart(await highestInRuns());
  }
}
