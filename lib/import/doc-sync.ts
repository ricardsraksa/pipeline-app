// Keeps each Import item's tab in the master doc in step with the item:
// creates the tab when it has none, renames it when its number or priority
// changed. Google calls are passed in (lib/import/doc-ops.ts binds the real
// ones), so this runs under node --test with fakes.
//
// Never throws: a failure is stored on the item (doc_error) and the next
// sync of that item tries again.

import type { ImportStore, ImportItem } from "./store.ts";
import { tabTitle } from "./codes.ts";

export interface DocOps {
  createTab(title: string, overview: { productName: string; links: string[] }): Promise<{ tabId: string }>;
  renameTab(tabId: string, title: string): Promise<void>;
  listTabs(): Promise<Array<{ tabId: string; title: string; code: number | null }>>;
}

export function createDocSync(deps: { store: ImportStore; ops: DocOps; configured: () => boolean }) {
  const { store, ops, configured } = deps;

  async function syncOne(item: ImportItem): Promise<void> {
    const title = tabTitle(item.productCode, item.name, item.priority);
    try {
      if (!item.docTabId) {
        const { tabId } = await ops.createTab(title, { productName: item.name, links: item.urls });
        await store.setDocState(item.id, { docTabId: tabId, docTitle: title, docError: null });
      } else if (item.docTitle !== title) {
        await ops.renameTab(item.docTabId, title);
        await store.setDocState(item.id, { docTitle: title, docError: null });
      } else if (item.docError) {
        await store.setDocState(item.id, { docError: null });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await store.setDocState(item.id, { docError: msg.slice(0, 300) }).catch(() => {});
    }
  }

  return {
    /** One after another — the Docs API rate-limits writes. */
    async syncItems(items: ImportItem[]): Promise<void> {
      if (!configured()) return;
      for (const it of items) await syncOne(it);
    },

    /** Product numbers used by doc tabs that no Import item owns ([] when unavailable). */
    async docNumbers(): Promise<number[]> {
      if (!configured()) return [];
      try {
        const owned = await store.ownedTabIds();
        return (await ops.listTabs())
          .filter((t) => t.code !== null && !owned.has(t.tabId))
          .map((t) => t.code as number);
      } catch {
        return [];
      }
    },
  };
}

export type DocSync = ReturnType<typeof createDocSync>;
