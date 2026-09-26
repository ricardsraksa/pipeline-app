// One product name per run.
//
// The copy kit's first line names the product ("BrandName Category"), and the
// run carries it as brand_name — what the header, Home, the image and ad
// writers, Shopify, Drive and the Doc all read. The name can change from
// either side, and the latest change wins: a copy edit that renames the
// product renames the run, and renaming the run rewrites the name in the copy.
import type { Run } from "@/lib/db";
import type { Stage2Json } from "@/lib/stage2/shape";

function kitName(raw: string | null | undefined): string {
  try { return String((JSON.parse(raw ?? "null") as Stage2Json | null)?.product_name ?? "").trim(); } catch { return ""; }
}

/** After the copy is re-read: the run update that carries a renamed product
 *  onto the run (empty when the copy didn't rename it). */
export function nameFromCopy(prevJson: string | null | undefined, structured: Pick<Stage2Json, "product_name"> | null): Partial<Run> {
  const next = String(structured?.product_name ?? "").trim();
  if (!next || next === kitName(prevJson)) return {};
  return { brand_name: next.slice(0, 200) };
}

/** Renaming the run: the copy and its structure that say the new name, or
 *  null when the run has no copy yet (or it already says this). */
export function renameInCopy(run: Pick<Run, "stage2_json" | "stage2_copy_edited" | "stage2_output">, newName: string): { copy: string | null; json: string } | null {
  const old = kitName(run.stage2_json);
  const name = newName.trim();
  if (!run.stage2_json || !name || old === name) return null;
  let json: Stage2Json;
  try { json = JSON.parse(run.stage2_json) as Stage2Json; } catch { return null; }
  const text = run.stage2_copy_edited ?? run.stage2_output ?? "";
  // The copy is the source the structure is re-read from, so it must say the
  // new name too — or the next copy edit would bring the old one back. It also
  // uses the brand word alone ("Tethra keeps it tied down"): swap that too when
  // both names start with a real brand word.
  const [ob, nb] = [brandWord(old), brandWord(name)];
  const brandRe = ob && nb && ob !== nb ? new RegExp(`\\b${ob.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g") : null;
  const rename = (s: string) => {
    let out = old ? s.split(old).join(name) : s;
    if (brandRe && nb) out = out.replace(brandRe, nb);
    return out;
  };
  const copy = rename(text);
  // The fields (sections, FAQs, ad text) say the name as well.
  let fields: Stage2Json = json;
  try { fields = JSON.parse(rename(run.stage2_json)) as Stage2Json; } catch { /* a name with quotes: keep the fields, set the title */ }
  return { copy: copy !== text ? copy : null, json: JSON.stringify({ ...fields, product_name: name }) };
}

const ARTICLES = new Set(["the", "a", "an"]);
const NOT_BRANDS = new Set(["our", "your", "my", "new", "original", "premium", "classic"]);
/** "Tethra Anchored Safe Box" → "Tethra", "The Pouchbook Pill Organizer" →
 *  "Pouchbook"; null when there's no clear brand word (it must be capitalised
 *  and appear once in the name, so "The Board Co Cutting Board" has none). */
function brandWord(name: string): string | null {
  const words = name.trim().split(/\s+/);
  const w = (ARTICLES.has((words[0] ?? "").toLowerCase()) ? words[1] : words[0]) ?? "";
  if (!/^[A-Z][A-Za-z0-9+'-]{2,}$/.test(w) || NOT_BRANDS.has(w.toLowerCase())) return null;
  return words.filter((x) => x.toLowerCase() === w.toLowerCase()).length === 1 ? w : null;
}
