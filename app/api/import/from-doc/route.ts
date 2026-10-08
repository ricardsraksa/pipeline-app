import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { googleDocConfigured, listTabsWithOverview } from "@/lib/google/docs";
import { importStore } from "@/lib/import/db-store";
import { currentBase, docSync } from "@/lib/import/doc-ops";
import { orderItems } from "@/lib/import/numbering";
import { codeNumber, isPriorityTitle } from "@/lib/import/codes";
import { readTabOverview } from "@/lib/import/tab-overview";

export const maxDuration = 120;

type Candidate = { tabId: string; title: string; name: string; links: string[]; priority: boolean; suggested: boolean };

async function candidates(): Promise<Candidate[]> {
  const [tabs, owned, runCodes] = await Promise.all([
    listTabsWithOverview(),
    importStore.ownedTabIds(),
    db.execute("SELECT product_code FROM runs WHERE product_code IS NOT NULL"),
  ]);
  const used = new Set((runCodes.rows as unknown as { product_code: string }[]).map((r) => codeNumber(r.product_code)).filter((n): n is number => n !== null));
  return tabs
    .filter((t) => t.code !== null && !used.has(t.code) && !owned.has(t.tabId))
    .map((t) => {
      const o = readTabOverview(t.paragraphs);
      const name = o.productName ?? t.title.replace(/^[^\p{L}\p{N}]*P\s*\d+\s*[-–—_:]?\s*/iu, "").trim();
      return { tabId: t.tabId, title: t.title, name: name || t.title, links: o.links, priority: isPriorityTitle(t.title), suggested: !o.alibabaLink };
    });
}

// One-off "Bring in from the doc": GET lists tabs with no run yet; POST
// adopts the chosen ones as Import items that keep their tab.
export async function GET(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;
  if (!googleDocConfigured()) return Response.json({ success: false, error: "The master doc isn't connected on this server." }, { status: 503 });
  try {
    return Response.json({ success: true, tabs: await candidates() });
  } catch (err) {
    return Response.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { tabIds } = (await req.json().catch(() => ({}))) as { tabIds?: unknown };
  const wanted = new Set(Array.isArray(tabIds) ? tabIds.filter((x): x is string => typeof x === "string") : []);
  if (!wanted.size) return Response.json({ success: false, error: "Tick at least one tab" }, { status: 400 });
  const chosen = (await candidates()).filter((c) => wanted.has(c.tabId));
  const added = await importStore.adopt(
    chosen.map((c) => ({ name: c.name, urls: c.links, priority: c.priority, docTabId: c.tabId, docTitle: c.title })),
    await currentBase(),
  );
  void importStore.listOpen().then((open) => docSync.syncItems(orderItems(open)));
  return Response.json({ success: true, added: added.length });
}
