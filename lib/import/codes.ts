// Product codes in titles ("P58 - Wall Lamp", "💦 P90 - Lamp"). Pure: no
// imports, so `node --test` can load it directly.

// Anything that isn't a letter or digit may precede the code — the 💦
// priority mark, other emoji, spaces, punctuation.
const CODE_RE = /^[^\p{L}\p{N}]*P\s*0*(\d{1,6})\b/iu;

/** The priority mark the operator uses in the master doc. */
export const PRIORITY_MARK = "💦";

/** The number in a code or tab title ("💦 P58 - Wall Lamp" → 58), else null. */
export function codeNumber(text: string | null | undefined): number | null {
  const m = typeof text === "string" ? text.match(CODE_RE) : null;
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** Only 💦 marks priority; other water emoji do not. */
export function isPriorityTitle(title: string): boolean {
  return title.includes(PRIORITY_MARK);
}

/** "💦 P92 - Mug" / "P92 - Mug". */
export function tabTitle(code: string, name: string, priority: boolean): string {
  return `${priority ? `${PRIORITY_MARK} ` : ""}${code} - ${name.trim()}`;
}

/** A tab title (or code) and a run code name the same product number. */
export function sameCode(title: string, code: string): boolean {
  const a = codeNumber(title);
  return a !== null && a === codeNumber(code);
}
