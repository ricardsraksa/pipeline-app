import { listRuns, type RunSummary } from "@/lib/db";
import HomeV2 from "../HomeV2";
import NewRunList from "@/components/import/NewRunList";

// Live data — never statically cache it.
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

export default async function RunsPage() {
  const runs = await getRuns();
  return <HomeV2 runs={runs ?? []} loadFailed={runs === null} top={<NewRunList />} />;
}
