// The overview lines at the top of a product tab ("Product name:",
// "Competitor/example link:", "Alibaba link:"). Pure; same labels as
// planOverviewFills in lib/google/docs.ts.

export type TabOverview = { productName: string | null; links: string[]; alibabaLink: string | null };

const NAME_RE = /^product name\s*:\s*(.*)$/i;
const COMP_RE = /^competitor\s*\/?\s*example link\s*:\s*(.*)$/i;
const ALI_RE = /^alibaba link\s*:\s*(.*)$/i;

export function readTabOverview(paragraphs: string[]): TabOverview {
  const out: TabOverview = { productName: null, links: [], alibabaLink: null };
  for (const raw of paragraphs) {
    const line = raw.replace(/\n/g, "").trim();
    let m: RegExpMatchArray | null;
    if ((m = line.match(NAME_RE))) out.productName = m[1].trim() || null;
    else if ((m = line.match(COMP_RE))) out.links = m[1].split(/\s+/).filter((s) => /^https?:\/\//i.test(s));
    else if ((m = line.match(ALI_RE))) out.alibabaLink = m[1].trim() || null;
  }
  return out;
}
