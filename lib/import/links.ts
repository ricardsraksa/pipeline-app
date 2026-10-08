// One links box per product: Instagram links are references (never
// scraped), everything else is a competitor page. Pure.

export const MAX_COMPETITORS = 5;

const isInstagram = (url: string): boolean => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "instagram.com" || host.endsWith(".instagram.com");
  } catch {
    return false;
  }
};

export function splitLinks(raw: string | string[]): { references: string[]; competitors: string[]; invalid: string[] } {
  const parts = (Array.isArray(raw) ? raw : [raw]).flatMap((s) => s.split(/\s+/)).map((s) => s.trim()).filter(Boolean);
  const seen = new Set<string>();
  const references: string[] = [];
  const competitors: string[] = [];
  const invalid: string[] = [];
  for (const p of parts) {
    if (seen.has(p)) continue;
    seen.add(p);
    if (!/^https?:\/\/\S+$/i.test(p)) invalid.push(p);
    else if (isInstagram(p)) references.push(p);
    else if (competitors.length < MAX_COMPETITORS) competitors.push(p);
  }
  return { references, competitors, invalid };
}
