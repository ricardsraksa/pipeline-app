// Keeps each Import item's tab in the master doc in step with the item.
//
// One worker per process: requestSync() marks the list dirty and returns
// when a pass that started after the request has finished. A pass looks at
// every item (open and started), re-reads each one right before acting, and:
//   - no tab yet      → add it, save its id at once, then write the overview
//   - overview missing → write it (the tab already exists — never re-add)
//   - title differs   → rename
//   - an earlier error → clear it once the item is in step
// Failures are stored on the item and retried on the next pass. Started
// items get their tab id copied onto the run (linkRun), so copy is later
// written to that exact tab.
//
// Google calls are passed in (lib/import/doc-ops.ts binds the real ones), so
// this runs under node --test with fakes. Never throws from a pass.

import type { ImportStore, ImportItem } from "./store.ts";
import { tabTitle } from "./codes.ts";

export interface DocOps {
  addTab(title: string): Promise<string>;
  writeOverview(tabId: string, overview: { productName: string; links: string[] }): Promise<void>;
  renameTab(tabId: string, title: string): Promise<void>;
  listTabTitles(): Promise<Array<{ tabId: string; title: string; code: number | null }>>;
}

const expectedTitle = (it: ImportItem) => tabTitle(it.productCode, it.name, it.priority);
const needsWork = (it: ImportItem) =>
  !it.docTabId || !it.docOverview || it.docTitle !== expectedTitle(it) || Boolean(it.docError);

export function createDocSync(deps: {
  store: ImportStore;
  ops: DocOps;
  configured: () => boolean;
  linkRun?: (runId: number, tabId: string) => Promise<void>;
}) {
  const { store, ops, configured, linkRun } = deps;
  let running: Promise<void> | null = null;
  let dirty = false;
  let lastKnown: Array<{ tabId: string; code: number | null }> | null = null;

  async function syncOne(id: number): Promise<void> {
    const it = await store.get(id);
    if (!it || !needsWork(it)) return;
    const title = expectedTitle(it);
    try {
      let tabId = it.docTabId;
      if (!tabId) {
        tabId = await ops.addTab(title);
        await store.setDocState(it.id, { docTabId: tabId, docTitle: title, docError: null, docOverview: false });
      } else if (it.docTitle !== title) {
        await ops.renameTab(tabId, title);
        await store.setDocState(it.id, { docTitle: title, docError: null });
      }
      if (!it.docOverview) {
        await ops.writeOverview(tabId, { productName: it.name, links: it.urls });
        await store.setDocState(it.id, { docError: null, docOverview: true });
      }
      if (it.docError) await store.setDocState(it.id, { docError: null });
      if (it.runId && it.runId > 0 && linkRun) await linkRun(it.runId, tabId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await store.setDocState(it.id, { docError: msg.slice(0, 300) }).catch(() => {});
    }
  }

  async function pass(): Promise<void> {
    // Oldest first, one at a time — the Docs API rate-limits writes.
    const items = (await store.listAll()).filter(needsWork).sort((a, b) => a.id - b.id);
    for (const it of items) await syncOne(it.id);
  }

  async function loop(): Promise<void> {
    try {
      while (dirty) {
        dirty = false;
        try { await pass(); } catch (err) { console.error("[import-sync]", err instanceof Error ? err.message : err); }
      }
    } finally {
      running = null;
    }
  }

  return {
    /** Bring every item's tab in step. Overlapping calls share one worker. */
    requestSync(): Promise<void> {
      if (!configured()) return Promise.resolve();
      dirty = true;
      if (!running) running = loop();
      return running;
    },

    /**
     * Product numbers used by doc tabs not in `owned` ([] when the doc isn't
     * connected). If the doc can't be read, the last numbers read are used;
     * if it was never read, this throws — numbering without the doc could
     * clash with tabs made by hand.
     */
    async docNumbers(owned: Set<string>): Promise<number[]> {
      if (!configured()) return [];
      let tabs: Array<{ tabId: string; code: number | null }>;
      try {
        tabs = await ops.listTabTitles();
        lastKnown = tabs;
      } catch (err) {
        if (!lastKnown) throw err;
        tabs = lastKnown;
      }
      return tabs.filter((t) => t.code !== null && !owned.has(t.tabId)).map((t) => t.code as number);
    },
  };
}

export type DocSync = ReturnType<typeof createDocSync>;
