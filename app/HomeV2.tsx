"use client";

// Run inbox: Needs you → Running → For later → Recent, each a bordered group of rows.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { RunSummary } from "@/lib/db";
import { useToast } from "@/components/Toasts";
import { PriorityBadge } from "@/components/import/shared";
import { HistoryRefresher } from "./history/HistoryRefresher";
import { ACTIVE_STATUSES, WAITING_STATUSES, relativeTime, statusLabel, truncateUrl } from "@/components/ui/run-ui";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

const NEED_COPY: Record<string, string> = {
  awaiting_product_approval: "Review the product",
  awaiting_stage2_approval: "Pick an angle",
  awaiting_user: "Ready for images",
  awaiting_hero_qc: "Review the hero",
  awaiting_qc: "Review the 8 prompts",
  failed: "Run failed",
  cancelled: "Run cancelled",
};

type SortKey = "newest" | "oldest" | "updated" | "code_desc" | "code_asc" | "name";
const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "newest", label: "Newest first" },
  { key: "oldest", label: "Oldest first" },
  { key: "updated", label: "Last updated" },
  { key: "code_desc", label: "P number, high to low" },
  { key: "code_asc", label: "P number, low to high" },
  { key: "name", label: "Name A to Z" },
];
const codeNum = (c: string | null) => { const m = (c ?? "").match(/^\s*P?\s*0*(\d{1,6})\b/i); return m ? Number(m[1]) : null; };
const nameOf = (r: RunSummary) => (r.brand_name || r.product_name || `Run ${r.id}`).toLowerCase();
const sorter = (k: SortKey) => (a: RunSummary, b: RunSummary): number => {
  switch (k) {
    case "oldest": return a.created_at.localeCompare(b.created_at);
    case "updated": return (b.last_updated_at ?? b.created_at).localeCompare(a.last_updated_at ?? a.created_at);
    // Runs without a code sort last either way.
    case "code_desc": return (codeNum(b.product_code) ?? -1) - (codeNum(a.product_code) ?? -1);
    case "code_asc": return (codeNum(a.product_code) ?? Infinity) - (codeNum(b.product_code) ?? Infinity);
    case "name": return nameOf(a).localeCompare(nameOf(b));
    default: return b.created_at.localeCompare(a.created_at);
  }
};

const toneOf = (s: string | null) =>
  s === "failed" ? "var(--color-red)"
  : WAITING_STATUSES.has(s ?? "") ? "var(--color-amber)"
  : ACTIVE_STATUSES.has(s ?? "") ? "var(--color-accent)"
  : s === "completed" ? "var(--color-green)"
  : "var(--color-text-4)";

// Lucide-style row action icons.
const svgProps = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, className: "w-4 h-4" };
const ClockIcon = () => <svg {...svgProps}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
const TrashIcon = () => <svg {...svgProps}><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /></svg>;

export default function HomeV2({ runs, loadFailed = false, top }: { runs: RunSummary[]; loadFailed?: boolean; top?: React.ReactNode }) {
  const router = useRouter();
  const { push } = useToast();
  const [q, setQ] = useState("");
  const [deleting, setDeleting] = useState<number | null>(null);
  // Sort order, remembered per browser.
  const [sort, setSort] = useState<SortKey>("newest");
  useEffect(() => {
    try { const v = localStorage.getItem("home.sort") as SortKey | null; if (v && SORTS.some((s) => s.key === v)) setSort(v); } catch { /* no storage */ }
  }, []);
  const changeSort = (k: SortKey) => { setSort(k); try { localStorage.setItem("home.sort", k); } catch { /* no storage */ } };
  // Inline product code editor on the row: type the number, the P is added.
  const [editingCode, setEditingCode] = useState<number | null>(null);
  const [codeDraft, setCodeDraft] = useState("");
  const [codeShown, setCodeShown] = useState<Record<number, string | null>>({});
  async function saveCode(r: RunSummary) {
    setEditingCode(null);
    const t = codeDraft.trim().toUpperCase();
    const m = t.match(/^P?\s*0*(\d{1,6})$/);
    if (t && !m) { push("Product code must be a number"); return; }
    const next = m ? `P${m[1]}` : null;
    if (next === (r.product_code ?? null)) return;
    setCodeShown((c) => ({ ...c, [r.id]: next }));
    try {
      const res = await fetch(`/api/runs/${r.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product_code: next }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); const msg = (d as { error?: string }).error; push(msg ? `Product code not saved: ${msg}` : "Product code not saved"); setCodeShown((c) => { const n = { ...c }; delete n[r.id]; return n; }); return; }
      router.refresh();
    } catch { push("Product code not saved: no connection"); setCodeShown((c) => { const n = { ...c }; delete n[r.id]; return n; }); }
  }
  const codeOf = (r: RunSummary) => (r.id in codeShown ? codeShown[r.id] : r.product_code);
  const query = q.trim().toLowerCase();
  const match = (r: RunSummary) =>
    !query || `${r.product_code || ""} ${r.brand_name || ""} ${r.product_name || ""} #${r.id}`.toLowerCase().includes(query);

  const asleep = (r: RunSummary) => Boolean(r.snoozed_at);
  // Stage 5 runs after the pipeline is "completed", so its state lives in
  // ads_step rather than status — a run waiting on the ad review still needs
  // the operator, and one writing or generating ads is still working.
  const adsWaiting = (r: RunSummary) => r.ads_step === "review" || Boolean(r.ads_error);
  const adsRunning = (r: RunSummary) => r.ads_step === "writing" || r.ads_step === "generating";
  const needs = runs.filter((r) => !asleep(r) && (WAITING_STATUSES.has(r.status ?? "") || r.status === "failed" || adsWaiting(r)) && match(r));
  const running = runs.filter((r) => !asleep(r) && !adsWaiting(r) && (ACTIVE_STATUSES.has(r.status ?? "") || adsRunning(r)) && match(r));
  const recent = runs.filter((r) => !asleep(r) && !adsWaiting(r) && !adsRunning(r) && ["completed", "cancelled"].includes(r.status ?? "") && match(r));
  // Set aside: still live, just not asking for attention.
  const later = runs.filter((r) => asleep(r) && match(r));
  const by = sorter(sort);
  const groups = [
    { label: "Needs you", rows: [...needs].sort(by) },
    { label: "Running", rows: [...running].sort(by) },
    { label: "For later", rows: [...later].sort(by) },
    { label: "Recent", rows: [...recent].sort(by) },
  ].filter((g) => g.rows.length);
  // Fast polling while anything is working, including Stage 5 ads.
  const hasActiveRuns = runs.some((r) => ACTIVE_STATUSES.has(r.status ?? "") || adsRunning(r));

  const [snoozing, setSnoozing] = useState<number | null>(null);
  async function snooze(e: React.MouseEvent, r: RunSummary) {
    e.stopPropagation();
    setSnoozing(r.id);
    try {
      const res = await fetch(`/api/runs/${r.id}/snooze`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snoozed: !r.snoozed_at }),
      });
      if (!res.ok) { push("Couldn't update the run"); return; }
      router.refresh();
    } catch { push("Couldn't update the run"); }
    finally { setSnoozing(null); }
  }

  async function del(e: React.MouseEvent, r: RunSummary) {
    e.stopPropagation();
    const name = r.brand_name || r.product_name || `#${r.id}`;
    if (!window.confirm(`Delete "${name}" and all its outputs?`)) return;
    setDeleting(r.id);
    try {
      const res = await fetch(`/api/runs/${r.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      router.refresh();
      push("Run deleted", "success");
    } catch { push("Couldn't delete that run"); }
    finally { setDeleting(null); }
  }

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "30px 22px 80px" }} data-screen-label="Runs">
      <HistoryRefresher hasActiveRuns={hasActiveRuns} />
      <div className="flex items-center gap-3.5 mb-[22px]">
        <h1 className="text-[19px] font-[600] tracking-[-0.02em] text-[var(--color-text)]">Runs</h1>
        <div className="flex-1" />
        <select value={sort} onChange={(e) => changeSort(e.target.value as SortKey)} aria-label="Sort runs"
          className="cursor-pointer h-8 px-2.5 text-[12.5px] rounded-[6px] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-2)] outline-none focus:border-[var(--color-border-strong)]">
          {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search runs"
          className="w-[250px] h-8 px-[11px] text-[13px] rounded-[6px] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] outline-none focus:border-[var(--color-border-strong)] placeholder:text-[var(--color-text-3)]" />
      </div>

      {top}

      {groups.map((g) => (
        <div key={g.label} className="mb-[26px]">
          <div className="flex items-center gap-2 px-0.5 pb-[7px]">
            <span className="eyebrow">{g.label}</span>
            <span className="ff-mono text-[11px] text-[var(--color-text-3)]">{g.rows.length}</span>
          </div>
          <div className="border border-[var(--color-border)] rounded-[9px] bg-[var(--color-surface)] overflow-hidden">
            {g.rows.map((r, i) => (
              <div key={r.id} onClick={() => router.push(`/runs/${r.id}`)}
                className={cx("group w-full grid items-center gap-3.5 px-[13px] py-[11px] text-left cursor-pointer hover:bg-[var(--color-surface-2)] tr",
                  i > 0 && "border-t border-[var(--color-border)]")}
                style={{ gridTemplateColumns: "34px 44px minmax(0,1fr) 180px 64px 32px 32px" }}>
                <div className="w-[34px] h-[34px] rounded-[5px] border border-[var(--color-border)] grid place-items-center ff-mono text-[9px] text-[var(--color-text-3)] overflow-hidden"
                  style={{ background: "repeating-linear-gradient(135deg,var(--color-surface-2) 0 4px,var(--color-bg) 4px 8px)" }}>
                  {r.stage3_hero_image_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={r.stage3_hero_image_url} alt="" className="w-full h-full object-cover" />
                    : null}
                </div>
                {editingCode === r.id ? (
                  <input autoFocus value={codeDraft} onChange={(e) => setCodeDraft(e.target.value)} onBlur={() => saveCode(r)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void saveCode(r); } else if (e.key === "Escape") { e.preventDefault(); setEditingCode(null); } }}
                    inputMode="numeric" aria-label="Product code"
                    className="ff-mono w-[44px] text-[11.5px] text-[var(--color-text)] bg-[var(--color-surface)] border border-[var(--color-border-strong)] rounded-[4px] px-1 py-px outline-none focus:border-[var(--color-accent)]" />
                ) : (
                  <button onClick={(e) => { e.stopPropagation(); setCodeDraft((codeOf(r) ?? "").replace(/^P/i, "")); setEditingCode(r.id); }}
                    title="Product code" aria-label="Edit product code"
                    className="cursor-pointer ff-mono text-[11.5px] text-left text-[var(--color-text-2)] rounded-[4px] px-1 -mx-1 hover:bg-[var(--color-surface-2)]">{codeOf(r) || "—"}</button>
                )}
                <div className="min-w-0">
                  <div className="text-[13.5px] font-[500] truncate text-[var(--color-text)] flex items-center gap-1.5" title={`Run ${r.id}`}>
                    {r.priority ? <PriorityBadge /> : null}<span className="truncate">{r.brand_name || r.product_name || `Run ${r.id}`}</span>
                  </div>
                  <div className="text-[12px] text-[var(--color-text-2)] truncate" title={r.product_url ?? undefined}>{r.product_url ? truncateUrl(r.product_url, 140) : "—"}</div>
                </div>
                <div className="flex items-center gap-[7px] min-w-0">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: toneOf(r.status) }} />
                  <span className="text-[12.5px] text-[var(--color-text)] truncate">{
                    r.ads_error ? "Ads failed"
                    : r.ads_step === "review" ? "Review the 5 ads"
                    : r.ads_step === "writing" ? "Writing the ad briefs"
                    : r.ads_step === "generating" ? "Generating the ads"
                    : NEED_COPY[r.status ?? ""] ?? statusLabel(r.status) ?? r.current_step ?? ""
                  }</span>
                </div>
                <div className="ff-mono text-[11px] text-[var(--color-text-3)] text-right">{relativeTime(r.last_updated_at ?? r.created_at)}</div>
                <button onClick={(e) => snooze(e, r)} disabled={snoozing === r.id}
                  aria-label={r.snoozed_at ? "Bring back" : "Set aside for later"}
                  title={r.snoozed_at ? "Bring back" : "Set aside for later"}
                  className={cx("cursor-pointer w-8 h-8 grid place-items-center rounded-[6px] tr hover:bg-[var(--color-surface-3)] hover:text-[var(--color-amber)] hover:opacity-100",
                    r.snoozed_at ? "text-[var(--color-amber)]" : "text-[var(--color-text-3)] opacity-40 group-hover:opacity-100")}>
                  <ClockIcon />
                </button>
                <button onClick={(e) => del(e, r)} disabled={deleting === r.id} aria-label="Delete run" title="Delete run"
                  className="cursor-pointer w-8 h-8 grid place-items-center rounded-[6px] text-[var(--color-text-3)] opacity-40 group-hover:opacity-100 hover:opacity-100 hover:bg-[var(--color-surface-3)] hover:text-[var(--color-red)] tr"><TrashIcon /></button>
              </div>
            ))}
          </div>
        </div>
      ))}

      {groups.length === 0 && (
        <div className="py-[60px] text-center text-[13px] text-[var(--color-text-2)]">
          {loadFailed
            ? <span className="inline-flex items-center gap-3"><span className="text-[var(--color-red)]">Couldn&apos;t load runs.</span><button onClick={() => router.refresh()} className="btn btn-sm">Retry</button></span>
            : query ? <>Nothing matches “{q}”.</> : <>No runs yet.</>}
        </div>
      )}
    </div>
  );
}
