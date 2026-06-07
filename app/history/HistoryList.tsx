"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RunSummary } from "@/lib/db";
import { Icon } from "@/components/ui/Icon";

const ACTIVE = new Set(["pending", "scraping", "stage1", "stage2", "generating_hero", "generating_remaining"]);
const WAITING = new Set(["awaiting_stage2_approval", "awaiting_user", "awaiting_qc", "awaiting_hero_qc"]);

const STATUS_LABEL: Record<string, string> = {
  pending: "Starting…", scraping: "Stage 1 · Research", stage1: "Stage 1 · Research",
  awaiting_stage2_approval: "Awaiting review", stage2: "Stage 2 · Copy",
  awaiting_user: "Awaiting review", awaiting_qc: "Awaiting QC",
  generating_hero: "Stage 3 · Hero", awaiting_hero_qc: "Stage 3 · Review hero",
  generating_remaining: "Stage 3 · Prompts", completed: "Complete", failed: "Failed", cancelled: "Cancelled",
};

const MESH: [string, string][] = [
  ["#5b86b8", "#2a3a52"], ["#43c98a", "#16402c"], ["#d6a84f", "#3a2e12"],
  ["#df8079", "#3a1c19"], ["#8a8f9b", "#23262e"], ["#7ba2d4", "#1a2535"],
  ["#56a674", "#142a1e"], ["#cda052", "#2a2310"], ["#b07ad4", "#251a35"],
];

function relativeTime(iso?: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60); if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60); if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24); if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}
function truncateUrl(url?: string | null, max = 52): string {
  if (!url) return "Description-only run";
  try { const u = new URL(url); const d = u.hostname.replace(/^www\./, "") + u.pathname; return d.length > max ? d.slice(0, max) + "…" : d; }
  catch { return url.slice(0, max); }
}
function isStuck(r: RunSummary): boolean {
  if (!r.last_updated_at) return false;
  const ageMs = Date.now() - new Date(r.last_updated_at).getTime();
  return ageMs > 10 * 60 * 1000 && !["completed", "failed", "cancelled", ...WAITING].includes(r.status ?? "");
}

// Thumbnail source: the generated Stage 3 hero if there is one, else the first
// uploaded source photo, else null (→ gradient mesh placeholder).
function thumbUrl(r: RunSummary): string | null {
  if (r.stage3_hero_image_url) return r.stage3_hero_image_url;
  try {
    const arr = r.uploaded_source_images ? JSON.parse(r.uploaded_source_images) : null;
    if (Array.isArray(arr) && typeof arr[0] === "string") return arr[0];
  } catch { /* ignore */ }
  return null;
}

function MeshThumb({ id, className }: { id: number; className?: string }) {
  const [m1, m2] = MESH[id % MESH.length];
  return <div className={`imgmesh ${className ?? ""}`} style={{ "--m1": m1, "--m2": m2 } as React.CSSProperties} />;
}

function StatusBadge({ status, stuck }: { status: string | null; stuck?: boolean }) {
  if (!status) return null;
  let tone = "accent", label = STATUS_LABEL[status] ?? status, pulse = false;
  if (stuck) { tone = "amber"; label = "Stuck"; }
  else if (status === "completed") { tone = "green"; label = "Complete"; }
  else if (status === "failed") tone = "red";
  else if (status === "cancelled") tone = "gray";
  else if (WAITING.has(status)) tone = "amber";
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

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" />
    </svg>
  );
}

export default function HistoryList({ runs }: { runs: RunSummary[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [deleting, setDeleting] = useState<number | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const counts = runs.reduce(
    (a, r) => {
      const s = r.status ?? "";
      if (ACTIVE.has(s)) a.active++;
      else if (s === "completed") a.completed++;
      else if (s === "failed") a.failed++;
      else if (WAITING.has(s)) a.waiting++;
      return a;
    },
    { active: 0, completed: 0, failed: 0, waiting: 0 }
  );
  const needsYou = counts.waiting + counts.failed;

  const matchFilter = (r: RunSummary) => {
    const s = r.status ?? "";
    if (filter === "all") return true;
    if (filter === "needs") return WAITING.has(s) || s === "failed";
    if (filter === "running") return ACTIVE.has(s);
    if (filter === "complete") return s === "completed";
    if (filter === "failed") return s === "failed" || s === "cancelled";
    return true;
  };
  const query = q.trim().toLowerCase();
  const filtered = runs.filter(matchFilter).filter((r) =>
    !query || `${r.brand_name || ""} ${r.product_name || ""} ${r.product_url || ""} #${r.id}`.toLowerCase().includes(query));

  const tabs = [
    { id: "all", label: "All", n: runs.length },
    { id: "needs", label: "Needs you", n: needsYou },
    { id: "running", label: "Running", n: counts.active },
    { id: "complete", label: "Complete", n: counts.completed },
    { id: "failed", label: "Failed", n: counts.failed },
  ];

  async function del(id: number, name: string) {
    if (!window.confirm(`Delete run "${name}"? This removes it and its outputs. This can't be undone.`)) return;
    setDeleting(id);
    try {
      await fetch(`/api/runs/${id}`, { method: "DELETE" });
      router.refresh();
    } finally { setDeleting(null); }
  }

  // Bulk-delete every run currently matching the active tab (+ search).
  async function deleteAll() {
    const ids = filtered.map((r) => r.id);
    if (!ids.length || bulkDeleting) return;
    const label = (tabs.find((t) => t.id === filter)?.label ?? "matching").toLowerCase();
    if (!window.confirm(`Delete all ${ids.length} ${label} run${ids.length > 1 ? "s" : ""}? This removes them and their outputs. This can't be undone.`)) return;
    setBulkDeleting(true);
    try {
      // Cap concurrency so a big sweep doesn't hammer the DB.
      const queue = [...ids];
      const worker = async () => { while (queue.length) { const id = queue.shift()!; await fetch(`/api/runs/${id}`, { method: "DELETE" }).catch(() => {}); } };
      await Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker));
      router.refresh();
      setFilter("all");
    } finally { setBulkDeleting(false); }
  }

  return (
    <div className="px-7 py-7 max-w-[1080px] mx-auto">
      <div className="flex items-end justify-between mb-5 gap-4 flex-wrap">
        <div>
          <h1 className="text-[28px] leading-tight font-bold tracking-tight ff-display text-[var(--color-text)] mb-1">Runs</h1>
          <p className="text-[13px] text-[var(--color-text-2)]">
            {runs.length} total · <span className="text-[var(--color-accent)]">{counts.active} running</span> · {needsYou} need you · {counts.completed} complete
          </p>
        </div>
        <button onClick={() => router.push("/")} className="cursor-pointer inline-flex items-center gap-[7px] rounded-[var(--radius-sm)] px-[15px] py-[9px] text-[13.5px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] tr hover:brightness-110 whitespace-nowrap">
          <Icon.Spark className="w-3.5 h-3.5" /> New run
        </button>
      </div>

      {/* needs-you callout */}
      {needsYou > 0 && filter === "all" && !query && (
        <button onClick={() => setFilter("needs")}
          className="w-full mb-4 flex items-center gap-3 px-4 py-3 rounded-[var(--radius)] border text-left cursor-pointer tr hover:brightness-[.98] fade-in"
          style={{ borderColor: "color-mix(in srgb, var(--color-amber) 35%, transparent)", background: "var(--color-amber-bg)" }}>
          <span className="grid place-items-center w-7 h-7 rounded-full bg-[var(--color-amber)] text-white shrink-0"><Icon.Alert className="w-4 h-4" /></span>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-[620] text-[var(--color-text)]">{needsYou} run{needsYou > 1 ? "s" : ""} waiting on you</p>
            <p className="text-[12px] text-[var(--color-text-2)]">Approvals and failed runs that need a decision to move forward.</p>
          </div>
          <span className="text-[12px] font-[600] text-[var(--color-amber)] inline-flex items-center gap-1 shrink-0">Show <Icon.ArrowRight className="w-3.5 h-3.5" /></span>
        </button>
      )}

      {/* filter tabs + search */}
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-1 p-0.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-2)] border border-[var(--color-border)]">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setFilter(t.id)}
              className={`px-3 py-1.5 rounded-[calc(var(--radius-sm)-2px)] text-[12.5px] font-[600] tr cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap ${filter === t.id ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-[var(--shadow-card)]" : "text-[var(--color-text-3)] hover:text-[var(--color-text)]"}`}>
              {t.label}
              <span className={`ff-mono text-[10px] ${filter === t.id ? "text-[var(--color-accent)]" : "text-[var(--color-text-4)]"}`}>{t.n}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-1 justify-end min-w-[180px]">
          {filter !== "all" && filtered.length > 0 && (
            <button onClick={deleteAll} disabled={bulkDeleting} title={`Delete all ${filtered.length} runs in this tab`}
              className="cursor-pointer inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 py-[7px] text-[12px] font-[620] border tr hover:brightness-95 disabled:opacity-50 whitespace-nowrap shrink-0"
              style={{ borderColor: "color-mix(in srgb, var(--color-red) 45%, transparent)", background: "var(--color-red-bg)", color: "var(--color-red)" }}>
              <TrashIcon className="w-3.5 h-3.5" /> {bulkDeleting ? "Deleting…" : `Delete all ${filtered.length}`}
            </button>
          )}
          <div className="relative flex-1 max-w-[300px]">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-3)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search runs…"
              className="w-full pl-8 pr-3 py-[7px] text-[12.5px] rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-text-4)] focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)]" />
          </div>
        </div>
      </div>

      <div className="border border-[var(--color-border)] rounded-[var(--radius)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-4 py-[11px] bg-[var(--color-surface-2)] border-b border-[var(--color-border)]">
          <span className="eyebrow text-[var(--color-text-3)]">Run</span>
          <span className="eyebrow text-[var(--color-text-3)] hidden sm:block">Status</span>
          <span className="eyebrow text-[var(--color-text-3)] hidden md:block">Updated</span>
          <span className="eyebrow text-[var(--color-text-3)] text-right">Action</span>
        </div>
        {filtered.length === 0 && (
          <div className="px-4 py-14 text-center">
            <p className="text-[13px] text-[var(--color-text-3)]">No runs match{query ? ` "${q}"` : " this filter"}.</p>
          </div>
        )}
        {filtered.map((r, i) => {
          const s = r.status ?? "";
          const stuck = isStuck(r);
          const active = ACTIVE.has(s);
          const waiting = WAITING.has(s) || s === "failed" || stuck;
          const action = active ? "View live" : waiting ? "Continue" : "View";
          const name = r.brand_name || r.product_name || "(unnamed)";
          return (
            <div key={r.id} onClick={() => router.push(`/runs/${r.id}`)}
              className="group grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-4 py-[13px] border-b border-[var(--color-border)] last:border-0 cursor-pointer tr hover:bg-[var(--color-surface-2)] fade-in"
              style={{ animationDelay: `${i * 22}ms`, opacity: deleting === r.id ? 0.4 : undefined }}>
              <div className="min-w-0 flex items-center gap-3">
                <div className="w-9 h-9 rounded-[var(--radius-sm)] overflow-hidden shrink-0 border border-[var(--color-border)] bg-[var(--color-surface-3)]">
                  {thumbUrl(r)
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={thumbUrl(r) as string} alt="" className="w-full h-full object-cover" loading="lazy" />
                    : <MeshThumb id={r.id} className="w-full h-full" />}
                </div>
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <p className="font-[600] text-[13.5px] text-[var(--color-text)] truncate">{name}</p>
                    <span className="ff-mono text-[10px] text-[var(--color-text-4)] shrink-0">#{r.id}</span>
                  </div>
                  <p className="ff-mono text-[11px] text-[var(--color-text-3)] truncate">{truncateUrl(r.product_url)}</p>
                  {active && r.current_step && (
                    <p className="text-[11px] text-[var(--color-accent)] truncate mt-0.5 flex items-center gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-current pulse-dot" />{r.current_step}
                    </p>
                  )}
                </div>
              </div>
              <div className="hidden sm:block"><StatusBadge status={r.status} stuck={stuck} /></div>
              <div className="hidden md:block ff-mono text-[11px] text-[var(--color-text-3)] whitespace-nowrap">{relativeTime(r.last_updated_at ?? r.created_at)}</div>
              <div className="flex items-center justify-end gap-1">
                <button onClick={(e) => { e.stopPropagation(); del(r.id, name); }} title="Delete run" aria-label={`Delete run #${r.id}`}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 grid place-items-center w-7 h-7 rounded-[var(--radius-sm)] text-[var(--color-text-3)] hover:text-[var(--color-red)] hover:bg-[var(--color-red-bg)] tr cursor-pointer">
                  <TrashIcon className="w-[15px] h-[15px]" />
                </button>
                <span className={`inline-flex items-center gap-1 text-[12px] font-[550] min-w-[58px] justify-end ${waiting ? "text-[var(--color-amber)]" : "text-[var(--color-text-2)]"}`}>
                  {action}<Icon.ArrowRight className="w-3.5 h-3.5" />
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
