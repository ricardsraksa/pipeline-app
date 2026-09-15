// In-process registry for the server-side image jobs (Stage 4 hero, Stage 4
// batch, Stage 5 batch). One job per key at a time; the watchdog and the
// routes both go through startJob so a run is never driven twice in one
// process. After a restart the set is empty, which is exactly when the
// watchdog is allowed to resume a run from what the database holds.

const RUNNING = new Set<string>();
const STOP = new Set<string>();

export const jobKey = {
  hero: (runId: number) => `hero:${runId}`,
  remaining: (runId: number) => `remaining:${runId}`,
  ads: (runId: number) => `ads:${runId}`,
};

export function jobRunning(key: string): boolean {
  return RUNNING.has(key);
}

/** Fire-and-forget. Returns false when the same job is already running here. */
export function startJob(key: string, fn: () => Promise<void>): boolean {
  if (RUNNING.has(key)) return false;
  RUNNING.add(key);
  STOP.delete(key);
  void fn()
    .catch((err) => console.error(`[job ${key}] failed:`, err instanceof Error ? err.message : String(err)))
    .finally(() => { RUNNING.delete(key); STOP.delete(key); });
  return true;
}

/** Ask a running batch to finish its in-flight images and start no more. */
export function requestStop(key: string): boolean {
  if (!RUNNING.has(key)) return false;
  STOP.add(key);
  return true;
}

export function stopRequested(key: string): boolean {
  return STOP.has(key);
}
