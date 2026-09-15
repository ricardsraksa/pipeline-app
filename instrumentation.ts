// Runs once when the server boots. Loading the pipeline runner starts the
// stuck-run watchdog immediately, so a deploy or crash mid-run is picked up
// within minutes without anyone opening a page first.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { watchdogSweep } = await import("./lib/pipeline-runner");
    // First look 30s after boot: earlier than the interval, later than the
    // database client needs to be ready.
    setTimeout(() => { void watchdogSweep(); }, 30_000);
  }
}
