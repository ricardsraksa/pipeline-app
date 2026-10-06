// Shared by Stage 4 (Stage3HeroFlow) and Stage 5 (AdsFlow): a server step
// whose last_updated_at has not moved in this long is treated as stalled.
// Pure, client-safe — no server imports.
export const STALL_MS = 15 * 60 * 1000;

export function isStalled(lastUpdatedAt: string | null | undefined, now: number): boolean {
  if (!lastUpdatedAt) return false;
  const t = new Date(lastUpdatedAt).getTime();
  return Number.isFinite(t) && now - t > STALL_MS;
}

/** "3m 12s" / "45s" / "1h 4m". */
export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
