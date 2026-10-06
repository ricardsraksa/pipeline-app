"use client";

// Shared run-list/run-page UI atoms + helpers (v2 design).
// Single source of truth — previously duplicated across HistoryList and the
// run page.

import { useEffect, useRef, useState } from "react";
import type { RunSummary } from "@/lib/db";

// Dates are formatted by hand: the server's Node has no en-GB locale data, so
// toLocaleDateString renders differently there and breaks hydration.
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
  generating_remaining: "Stage 4 · Images", completed: "Complete", failed: "Failed", cancelled: "Cancelled",
};
export const statusLabel = (s: string | null | undefined) => (s ? STATUS_LABEL[s] ?? "Working…" : "");

/** "2026-10-06T…" → "6 Oct". */
export function shortDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Live "1m 5s" since an ISO time, ticking every second. */
export function Elapsed({ since }: { since?: string | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const e = elapsedTime(since);
  return e ? <span className="ff-mono text-[11px] text-[var(--color-text-3)] tabular-nums">{e}</span> : null;
}

/** "⋯" button with a small popover. Closes on outside click and Escape. */
export function OverflowMenu({ children, label = "More", up = false, align = "right", width = "w-[min(440px,calc(100vw-32px))]" }: {
  children: React.ReactNode;
  label?: string;
  /** Open above the button (bottom of the rail). */
  up?: boolean;
  align?: "left" | "right";
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-label={label} aria-haspopup="true" aria-expanded={open} title={label}
        className={`cursor-pointer inline-flex items-center justify-center w-8 h-8 rounded-[6px] border text-[var(--color-text-2)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors duration-150 ${open ? "border-[var(--color-border-strong)] bg-[var(--color-surface-2)]" : "border-[var(--color-border)]"}`}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
      </button>
      {open && (
        <div role="menu"
          className={`absolute z-50 ${up ? "bottom-full mb-1.5" : "top-full mt-1.5"} ${align === "right" ? "right-0" : "left-0"} ${width} max-h-[70vh] overflow-auto rounded-[9px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-pop)] p-2.5 flex flex-col gap-2.5 items-stretch fade-in`}>
          {children}
        </div>
      )}
    </div>
  );
}

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
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]}`;
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
