// In-process registry for the server-side image jobs (Stage 4 hero, Stage 4
// batch, Stage 5 batch). One live job per kind per run; the watchdog and the
// routes both go through startJob so a run is never driven twice in one
// process. After a process restart the registry is empty, which is exactly
// when the watchdog is allowed to resume a run from what the database holds.
//
// A job cannot be killed mid-image (the Higgsfield wait is not cancellable),
// so superseding is done by epoch: restarting a stage, killing the run or
// regenerating the hero bumps the run's epoch, and a job checks `alive()`
// before every write. A superseded job finishes its wait and then writes
// nothing — it used to carry on from memory and "complete" a run whose stage
// had just been cleared (run 141, Sep 17 2026).

export type JobKind = "hero" | "remaining" | "ads";
export type Alive = () => boolean;

const EPOCH = new Map<number, number>();
const RUNNING = new Set<string>();
const STOP = new Set<string>();

const epochOf = (runId: number) => EPOCH.get(runId) ?? 0;
const liveKey = (kind: JobKind, runId: number) => `${kind}:${runId}@${epochOf(runId)}`;

/** A job of this kind, from the current epoch, is running in this process. */
export function jobRunning(kind: JobKind, runId: number): boolean {
  return RUNNING.has(liveKey(kind, runId));
}

/** Fire-and-forget. Returns false when a live job of this kind is already running here. */
export function startJob(kind: JobKind, runId: number, fn: (alive: Alive) => Promise<void>): boolean {
  const key = liveKey(kind, runId);
  if (RUNNING.has(key)) return false;
  const epoch = epochOf(runId);
  RUNNING.add(key);
  STOP.delete(key);
  const alive: Alive = () => epochOf(runId) === epoch;
  void fn(alive)
    .catch((err) => console.error(`[job ${key}] failed:`, err instanceof Error ? err.message : String(err)))
    .finally(() => { RUNNING.delete(key); STOP.delete(key); });
  return true;
}

/** Supersede every job of this run: they stop starting work and may no longer write. */
export function invalidateRun(runId: number): void {
  EPOCH.set(runId, epochOf(runId) + 1);
}

/** "Stop after current": in-flight images finish and are saved; no new ones start. */
export function requestStop(kind: JobKind, runId: number): boolean {
  const key = liveKey(kind, runId);
  if (!RUNNING.has(key)) return false;
  STOP.add(key);
  return true;
}

export function stopRequested(kind: JobKind, runId: number): boolean {
  return STOP.has(liveKey(kind, runId));
}
