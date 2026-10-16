// Write a run's copy into its product tab (insert-only: empty cells are
// filled, filled cells are left alone). Used by "Send to Google Doc", Push to
// all, and the Import sync when a run gets its tab after its copy was written.
import { getRun, updateRun } from "@/lib/db";
import { fillProductTab } from "@/lib/google/docs";
import type { Stage2Json } from "@/lib/stage2/shape";

export type SendResult =
  | { ok: true; appendedAt: string; tab?: string; rows?: unknown; dryRun: boolean }
  | { ok: false; status: number; error: string; alreadySentAt?: string; availableTabs?: string[] };

export async function sendRunToDoc(runId: number, opts: { force?: boolean; dryRun?: boolean } = {}): Promise<SendResult> {
  const run = await getRun(runId);
  if (!run) return { ok: false, status: 404, error: "Run not found" };
  if (run.gdoc_appended_at && !opts.force) {
    return { ok: false, status: 409, alreadySentAt: run.gdoc_appended_at, error: `Already sent ${run.gdoc_appended_at.slice(0, 10)} — send again?` };
  }
  let json: Stage2Json | null = null;
  try { json = run.stage2_json ? (JSON.parse(run.stage2_json) as Stage2Json) : null; } catch { /* fall through */ }
  if (!json) return { ok: false, status: 400, error: "No structured Stage 3 copy on this run yet" };

  let competitorUrl: string | undefined;
  try { competitorUrl = (JSON.parse(run.competitor_urls ?? "[]") as string[])[0]; } catch { /* none */ }
  const result = await fillProductTab({
    productCode: run.product_code ?? "",
    tabId: run.doc_tab_id,
    json,
    overview: {
      productName: run.brand_name ?? json.product_name ?? undefined,
      productUrl: run.product_url ?? undefined,
      competitorUrl,
    },
    dryRun: opts.dryRun === true,
  });
  const ts = new Date().toISOString();
  if (!result.ok) {
    await updateRun(runId, { gdoc_append_error: result.error ?? "unknown", last_updated_at: ts }).catch(() => {});
    return { ok: false, status: 502, error: result.error ?? "unknown", availableTabs: result.availableTabs };
  }
  if (!result.dryRun) await updateRun(runId, { gdoc_appended_at: ts, gdoc_append_error: null, last_updated_at: ts }).catch(() => {});
  return { ok: true, appendedAt: ts, tab: result.tabTitle, rows: result.rows, dryRun: result.dryRun ?? false };
}
