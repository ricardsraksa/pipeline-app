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
    // The copy was written before the run had a tab (the doc was full, or the
    // tab came later): send it now that there is one. Only ever once — a run
    // already sent is left alone.
    const r = await db.execute({ sql: "SELECT 1 FROM runs WHERE id = ? AND stage2_json IS NOT NULL AND gdoc_appended_at IS NULL", args: [runId] });
    if (r.rows.length) {
      const { sendRunToDoc } = await import("@/lib/google/send-run");
      const out = await sendRunToDoc(runId);
      if (!out.ok) console.error(`[google-doc] run ${runId} copy after linking its tab:`, out.error);
    }
  },
});

/** For the store's numbering steps. */
export const docNumbers: DocNumbers = (owned) => docSync.docNumbers(owned);

/** Highest product number used by a run or a doc tab no Import item owns. */
export async function currentBase(): Promise<number> {
  const [runs, owned] = await Promise.all([importStore.runBase(), importStore.ownedTabIds()]);
  return Math.max(runs, ...(await docNumbers(owned)), 0);
}
