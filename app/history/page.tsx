import { listRuns, type RunSummary } from "@/lib/db";
import { HistoryRefresher } from "./HistoryRefresher";
import HistoryList from "./HistoryList";

// History is live data — must never be statically cached. Force dynamic
// rendering so every navigation / router.refresh() hits the DB.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const ACTIVE_STATUSES = new Set(["pending", "scraping", "stage1", "stage2", "generating_hero", "generating_remaining"]);

// Server components run in the same process as the API. Read from the DB
// directly — faster, no HTTP roundtrip.
async function getRuns(): Promise<RunSummary[]> {
  try {
    return await listRuns();
  } catch (err) {
    console.error("Failed to load runs:", err);
    return [];
  }
}

export default async function HistoryPage() {
  const runs = await getRuns();
  const hasActiveRuns = runs.some((r) => ACTIVE_STATUSES.has(r.status ?? ""));

  return (
    <main>
      <HistoryRefresher hasActiveRuns={hasActiveRuns} />
      <HistoryList runs={runs} />
    </main>
  );
}
