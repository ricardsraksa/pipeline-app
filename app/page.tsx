import { listRuns, type RunSummary } from "@/lib/db";
import HomeV2 from "./HomeV2";

// Home is live data — never statically cache it.
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function getRuns(): Promise<RunSummary[] | null> {
  try {
    return await listRuns();
  } catch (err) {
    console.error("Failed to load runs:", err);
    return null;
  }
}

// The refresher (fast polling while anything is active) lives in HomeV2, which
// can read ACTIVE_STATUSES from the client-side run-ui module.
export default async function HomePage() {
  const runs = await getRuns();
  return <HomeV2 runs={runs ?? []} loadFailed={runs === null} />;
}
