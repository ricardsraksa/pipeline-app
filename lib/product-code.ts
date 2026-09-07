// Product codes (P58, P59, …) name the Google Doc tab and the Drive folder, so
// they must continue the operator's own sequence rather than restart it. The
// next code is the highest number already in use plus one — counting both the
// app's runs and the master doc's tabs, since either can be ahead of the other.

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

/** Highest product number among the master doc's tabs (0 when unavailable). */
async function highestInDoc(): Promise<number> {
  if (!googleDocConfigured()) return 0;
  try {
    let max = 0;
    for (const t of await fetchDocTabs()) {
      const n = codeNumber(t.tabProperties?.title);
      if (n && n > max) max = n;
    }
    return max;
  } catch {
    return 0;
  }
}

/** The next code in the sequence, e.g. "P68". Never throws. */
export async function nextProductCode(): Promise<string> {
  const [runs, doc] = await Promise.all([highestInRuns(), highestInDoc()]);
  return `P${Math.max(runs, doc) + 1}`;
}
