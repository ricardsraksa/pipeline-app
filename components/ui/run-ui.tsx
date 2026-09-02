"use client";

// Shared run-list/run-page UI atoms + helpers (v2 design).
// Single source of truth — previously duplicated across HistoryList and the
// run page.

import type { RunSummary } from "@/lib/db";

export const ACTIVE_STATUSES = new Set(["pending", "product", "scraping", "stage1", "stage2", "generating_hero", "generating_remaining"]);
export const WAITING_STATUSES = new Set(["awaiting_product_approval", "awaiting_stage2_approval", "awaiting_user", "awaiting_qc", "awaiting_hero_qc"]);

// Display numbering: Product = 1, Research = 2, Copy = 3, Images = 4. The
// internal status/column names predate the product stage and stay as they are.
export const STATUS_LABEL: Record<string, string> = {
  pending: "Starting…", product: "Stage 1 · Product", awaiting_product_approval: "Review product",
  scraping: "Stage 2 · Research", stage1: "Stage 2 · Research",
  awaiting_stage2_approval: "Pick an angle", stage2: "Stage 3 · Copy",
  awaiting_user: "Ready for images", awaiting_qc: "Review prompts",
  generating_hero: "Stage 4 · Hero", awaiting_hero_qc: "Review hero",
  generating_remaining: "Stage 4 · Prompts", completed: "Complete", failed: "Failed", cancelled: "Cancelled",
};
export const statusLabel = (s: string | null | undefined) => (s ? STATUS_LABEL[s] ?? s : "");

export const MESH: [string, string][] = [
  ["#5b86b8", "#2a3a52"], ["#43c98a", "#16402c"], ["#d6a84f", "#3a2e12"],
  ["#df8079", "#3a1c19"], ["#8a8f9b", "#23262e"], ["#7ba2d4", "#1a2535"],
  ["#56a674", "#142a1e"], ["#cda052", "#2a2310"], ["#b07ad4", "#251a35"],
];

export function relativeTime(iso?: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60); if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60); if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24); if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export function elapsedTime(startedAt?: string | null, finishedAt?: string | null): string | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const sec = Math.max(0, Math.round((end - start) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

export function truncateUrl(url?: string | null, max = 52): string {
  if (!url) return "Description-only run";
  try { const u = new URL(url); const d = u.hostname.replace(/^www\./, "") + u.pathname; return d.length > max ? d.slice(0, max) + "…" : d; }
  catch { return url.slice(0, max); }
}

// Thumbnail source: the generated Stage 4 hero if there is one, else the first
// uploaded source photo, else null (→ gradient mesh placeholder).
export function thumbUrl(r: Pick<RunSummary, "stage3_hero_image_url" | "uploaded_source_images">): string | null {
  if (r.stage3_hero_image_url) return r.stage3_hero_image_url;
  try {
    const arr = r.uploaded_source_images ? JSON.parse(r.uploaded_source_images) : null;
    if (Array.isArray(arr) && typeof arr[0] === "string") return arr[0];
  } catch { /* ignore */ }
  return null;
}

export function MeshThumb({ id, className }: { id: number; className?: string }) {
  const [m1, m2] = MESH[id % MESH.length];
  return <div className={`imgmesh ${className ?? ""}`} style={{ "--m1": m1, "--m2": m2 } as React.CSSProperties} />;
}

/** Run thumbnail: real hero/source image when available, mesh placeholder otherwise. */
export function RunThumb({ run, className }: { run: Pick<RunSummary, "id" | "stage3_hero_image_url" | "uploaded_source_images">; className?: string }) {
  const url = thumbUrl(run);
  return (
    <div className={`rounded-[var(--radius-sm)] overflow-hidden shrink-0 border border-[var(--color-border)] bg-[var(--color-surface-3)] ${className ?? ""}`}>
      {url
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
        : <MeshThumb id={run.id} className="w-full h-full" />}
    </div>
  );
}

export function StatusBadge({ status, stuck }: { status: string | null; stuck?: boolean }) {
  if (!status) return null;
  let tone = "accent", label = statusLabel(status), pulse = false;
  if (stuck) { tone = "amber"; label = "Stuck"; }
  else if (status === "completed") { tone = "green"; label = "Complete"; }
  else if (status === "failed") tone = "red";
  else if (status === "cancelled") tone = "gray";
  else if (WAITING_STATUSES.has(status)) tone = "amber";
  else pulse = true;
  const map: Record<string, [string, string]> = {
    accent: ["var(--color-accent-weak)", "var(--color-accent)"],
    green: ["var(--color-green-bg)", "var(--color-green)"],
    amber: ["var(--color-amber-bg)", "var(--color-amber)"],
    red: ["var(--color-red-bg)", "var(--color-red)"],
    gray: ["var(--color-gray-bg)", "var(--color-gray)"],
  };
  const [bg, fg] = map[tone];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-[620] px-2.5 py-1 rounded-full whitespace-nowrap" style={{ background: bg, color: fg }}>
      <span className={`w-1.5 h-1.5 rounded-full bg-current shrink-0 ${pulse ? "pulse-dot" : ""}`} />
      {label}
    </span>
  );
}
