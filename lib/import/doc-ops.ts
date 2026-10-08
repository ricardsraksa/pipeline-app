// The Import doc sync bound to the real master doc and database.
import { db } from "@/lib/db";
import { addTab, googleDocConfigured, listTabTitles, renameTab, writeOverview } from "@/lib/google/docs";
import { createDocSync } from "@/lib/import/doc-sync";
import { importStore } from "@/lib/import/db-store";
import type { DocNumbers } from "@/lib/import/store";

export const docSync = createDocSync({
  store: importStore,
  configured: googleDocConfigured,
  ops: { addTab, writeOverview, renameTab, listTabTitles },
  // Copy for this run is written to this exact tab, whatever its title says.
  linkRun: async (runId, tabId) => {
    await db.execute({ sql: "UPDATE runs SET doc_tab_id = ? WHERE id = ? AND (doc_tab_id IS NULL OR doc_tab_id <> ?)", args: [tabId, runId, tabId] });
  },
});

/** For the store's numbering steps. */
export const docNumbers: DocNumbers = (owned) => docSync.docNumbers(owned);

/** Highest product number used by a run or a doc tab no Import item owns. */
export async function currentBase(): Promise<number> {
  const [runs, owned] = await Promise.all([importStore.runBase(), importStore.ownedTabIds()]);
  return Math.max(runs, ...(await docNumbers(owned)), 0);
}
