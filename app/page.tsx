import { listRuns, type RunSummary } from "@/lib/db";
import { HistoryRefresher } from "./history/HistoryRefresher";
import HomeV2 from "./HomeV2";

// Home is live data — never statically cache it.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const ACTIVE_STATUSES = new Set(["pending", "scraping", "stage1", "stage2", "generating_hero", "generating_remaining"]);

async function getRuns(): Promise<RunSummary[]> {
  try {
    return await listRuns();
  } catch (err) {
    console.error("Failed to load runs:", err);
    return [];
  }
}

export default async function HomePage() {
  const runs = await getRuns();
  const hasActiveRuns = runs.some((r) => ACTIVE_STATUSES.has(r.status ?? ""));

  return (
    <>
      <HistoryRefresher hasActiveRuns={hasActiveRuns} />
      <HomeV2 runs={runs} />
    </>
  );
}
