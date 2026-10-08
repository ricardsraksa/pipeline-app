// The Import doc sync bound to the real master doc.
import { createProductTab, googleDocConfigured, listTabsWithOverview, renameTab } from "@/lib/google/docs";
import { createDocSync } from "@/lib/import/doc-sync";
import { importStore } from "@/lib/import/db-store";

export const docSync = createDocSync({
  store: importStore,
  configured: googleDocConfigured,
  ops: { createTab: createProductTab, renameTab, listTabs: listTabsWithOverview },
});

/** Highest product number already used by a run or a doc tab no Import item owns. */
export async function currentBase(): Promise<number> {
  const [runs, doc] = await Promise.all([importStore.runBase(), docSync.docNumbers()]);
  return Math.max(runs, ...doc, 0);
}
