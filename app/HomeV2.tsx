"use client";

// v2 inbox Home: Needs you → Running → Recent, with search (home2.jsx).

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RunSummary } from "@/lib/db";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/Toasts";
import { ACTIVE_STATUSES, WAITING_STATUSES, RunThumb, StatusBadge, relativeTime, truncateUrl } from "@/components/ui/run-ui";

const NEED_COPY: Record<string, [string, string]> = {
  awaiting_product_approval: ["Review the product", "Description and photos"],
  awaiting_stage2_approval: ["Pick an angle", "Research is done"],
  awaiting_user: ["Ready for images", "Hero first, then the 8"],
  awaiting_hero_qc: ["Review the hero", "Reference for the other 8"],
  awaiting_qc: ["Review the 8 prompts", "Then generate"],
  failed: ["Run failed", "Resume to continue"],
  cancelled_stuck: ["Run cancelled", "Resume to continue"],
};

export default function HomeV2({ runs }: { runs: RunSummary[] }) {
  const router = useRouter();
  const { push } = useToast();
  const [q, setQ] = useState("");
  const [deleting, setDeleting] = useState<number | null>(null);
  const query = q.trim().toLowerCase();
  const match = (r: RunSummary) =>
    !query || `${r.product_code || ""} ${r.brand_name || ""} ${r.product_name || ""} #${r.id}`.toLowerCase().includes(query);

  const needs = runs.filter((r) => (WAITING_STATUSES.has(r.status ?? "") || r.status === "failed") && match(r));
  const running = runs.filter((r) => ACTIVE_STATUSES.has(r.status ?? "") && match(r));
  const recent = runs.filter((r) => ["completed", "cancelled"].includes(r.status ?? "") && match(r));

  const open = (id: number) => router.push(`/runs/${id}`);

  const del = async (e: React.MouseEvent, r: RunSummary) => {
    e.stopPropagation();
    const name = r.brand_name || r.product_name || `#${r.id}`;
    if (!window.confirm(`Delete run "${name}"? This removes it and its outputs. This can't be undone.`)) return;
    setDeleting(r.id);
    try {
      await fetch(`/api/runs/${r.id}`, { method: "DELETE" });
      push("Run deleted", "success");
      router.refresh();
    } finally { setDeleting(null); }
  };

  const nameRow = (r: RunSummary, big?: boolean) => (
    <div className="flex items-baseline gap-2">
      {r.product_code && <span className="ff-mono text-[10px] font-[600] px-1.5 py-px rounded bg-[var(--color-accent-weak)] text-[var(--color-accent-text)] shrink-0">{r.product_code}</span>}
      <p className={`${big ? "text-[14px] font-[650]" : "text-[13.5px] font-[620]"} text-[var(--color-text)] truncate`}>{r.brand_name || r.product_name}</p>
      <span className="ff-mono text-[10px] text-[var(--color-text-4)]">#{r.id}</span>
    </div>
  );

  return (
    <div className="px-6 py-8 max-w-[880px] mx-auto" data-screen-label="Home">
      {/* header row */}
      <div className="flex items-center justify-between gap-4 mb-7 flex-wrap">
        <div>
          <h1 className="text-[26px] leading-tight font-bold tracking-tight ff-display text-[var(--color-text)]">Pipeline</h1>
          <p className="text-[13px] text-[var(--color-text-2)] mt-0.5">
            {needs.length > 0
              ? <><strong className="text-[var(--color-amber)]">{needs.length} run{needs.length > 1 ? "s" : ""} need{needs.length === 1 ? "s" : ""} you</strong> · {running.length} running</>
              : <>{running.length} running · all caught up</>}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-3)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
              className="w-[170px] pl-8 pr-3 py-[8px] text-[12.5px] rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-text-4)] focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)]" />
          </div>
          <button onClick={() => router.push("/new")}
            className="cursor-pointer inline-flex items-center gap-[7px] rounded-[var(--radius-sm)] px-[15px] py-[9px] text-[13.5px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] border border-transparent tr hover:brightness-110 whitespace-nowrap">
            <Icon.Plus className="w-3.5 h-3.5" /> New run
          </button>
        </div>
      </div>

      {/* ── needs you ── */}
      {needs.length > 0 && (
        <section className="mb-7">
          <span className="eyebrow block mb-2.5 text-[var(--color-amber)]">Needs you · {needs.length}</span>
          <div className="space-y-2.5">
            {needs.map((r) => {
              const [title, sub] = NEED_COPY[r.status ?? ""] || ["Waiting", ""];
              const failed = r.status === "failed";
              return (
                <div key={r.id} role="button" tabIndex={0} onClick={() => open(r.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(r.id); } }}
                  className="w-full text-left flex items-center gap-3.5 px-4 py-3.5 rounded-[var(--radius)] border bg-[var(--color-surface)] shadow-[var(--shadow-card)] tr cursor-pointer hover:border-[var(--color-text-3)] group focus:outline-none focus:shadow-[0_0_0_3px_var(--color-ring)]"
                  style={{ borderColor: `color-mix(in srgb, ${failed ? "var(--color-red)" : "var(--color-amber)"} 35%, var(--color-border))`, opacity: deleting === r.id ? 0.4 : undefined }}>
                  <RunThumb run={r} className="w-11 h-11" />
                  <div className="flex-1 min-w-0">
                    {nameRow(r, true)}
                    <p className="text-[12.5px] truncate mt-0.5">
                      <span className={failed ? "text-[var(--color-red)] font-[600]" : "text-[var(--color-amber)] font-[600]"}>{title}</span>
                      <span className="text-[var(--color-text-3)]"> — {sub}</span>
                    </p>
                  </div>
                  <span className="ff-mono text-[10.5px] text-[var(--color-text-4)] shrink-0 hidden sm:block">{relativeTime(r.last_updated_at ?? r.created_at)}</span>
                  <span className="shrink-0 inline-flex items-center gap-1.5 px-3 py-[7px] rounded-[var(--radius-sm)] text-[12.5px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] group-hover:brightness-110 tr">
                    {failed ? "Resume" : "Review"} <Icon.ArrowRight className="w-3.5 h-3.5" />
                  </span>
                  <button onClick={(e) => del(e, r)} title="Delete run" aria-label={`Delete run #${r.id}`}
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 grid place-items-center w-7 h-7 rounded-[var(--radius-sm)] text-[var(--color-text-3)] hover:text-[var(--color-red)] hover:bg-[var(--color-red-bg)] tr cursor-pointer shrink-0">
                    <Icon.Trash className="w-[15px] h-[15px]" />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── running ── */}
      {running.length > 0 && (
        <section className="mb-7">
          <span className="eyebrow block mb-2.5">Running · {running.length}</span>
          <div className="space-y-2">
            {running.map((r) => (
              <button key={r.id} onClick={() => open(r.id)}
                className="w-full text-left flex items-center gap-3.5 px-4 py-3 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] tr cursor-pointer hover:border-[var(--color-text-3)]">
                <RunThumb run={r} className="w-9 h-9" />
                <div className="flex-1 min-w-0">
                  {nameRow(r)}
                  {r.current_step && (
                    <p className="text-[12px] text-[var(--color-accent-text)] truncate mt-0.5 flex items-center gap-1.5 ff-mono">
                      <span className="w-1 h-1 rounded-full bg-[var(--color-green)] pulse-dot shrink-0" />{r.current_step}
                    </p>
                  )}
                </div>
                <StatusBadge status={r.status} />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── recent ── */}
      <section>
        <span className="eyebrow block mb-2.5">Recent · {recent.length}</span>
        {recent.length === 0 && needs.length === 0 && running.length === 0 ? (
          <div className="border border-[var(--color-border)] rounded-[var(--radius)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] px-6 py-12 text-center">
            <p className="text-[14px] font-[600] text-[var(--color-text)] mb-1">{query ? `Nothing matches "${q}"` : "No runs yet"}</p>
            {!query && <p className="text-[12.5px] text-[var(--color-text-3)] mb-4">Describe a product and drop a few photos — the pipeline does the rest.</p>}
            {!query && (
              <button onClick={() => router.push("/new")}
                className="cursor-pointer inline-flex items-center gap-[7px] rounded-[var(--radius-sm)] px-[15px] py-[9px] text-[13.5px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] border border-transparent tr hover:brightness-110 whitespace-nowrap">
                <Icon.Plus className="w-3.5 h-3.5" /> Start your first run
              </button>
            )}
          </div>
        ) : (
          <div className="border border-[var(--color-border)] rounded-[var(--radius)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] overflow-hidden">
            {recent.map((r) => (
              <div key={r.id} onClick={() => open(r.id)}
                className="group flex items-center gap-3.5 px-4 py-3 border-b border-[var(--color-border)] last:border-0 cursor-pointer tr hover:bg-[var(--color-surface-2)]"
                style={{ opacity: deleting === r.id ? 0.4 : undefined }}>
                <RunThumb run={r} className="w-9 h-9" />
                <div className="flex-1 min-w-0">
                  {nameRow(r)}
                  <p className="ff-mono text-[11px] text-[var(--color-text-3)] truncate">{truncateUrl(r.product_url, 44)}</p>
                </div>
                <span className="ff-mono text-[10.5px] text-[var(--color-text-4)] hidden sm:block">{relativeTime(r.last_updated_at ?? r.created_at)}</span>
                <StatusBadge status={r.status} />
                <button onClick={(e) => del(e, r)} title="Delete run" aria-label={`Delete run #${r.id}`}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 grid place-items-center w-7 h-7 rounded-[var(--radius-sm)] text-[var(--color-text-3)] hover:text-[var(--color-red)] hover:bg-[var(--color-red-bg)] tr cursor-pointer shrink-0">
                  <Icon.Trash className="w-[15px] h-[15px]" />
                </button>
              </div>
            ))}
            {recent.length === 0 && <p className="px-4 py-6 text-center text-[12.5px] text-[var(--color-text-3)]">Completed runs land here.</p>}
          </div>
        )}
      </section>
    </div>
  );
}
