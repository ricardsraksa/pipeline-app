"use client";

// Run inbox: Needs you → Running → Recent, each a bordered group of rows.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RunSummary } from "@/lib/db";
import { useToast } from "@/components/Toasts";
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

const toneOf = (s: string | null) =>
  s === "failed" ? "var(--color-red)"
  : WAITING_STATUSES.has(s ?? "") ? "var(--color-amber)"
  : ACTIVE_STATUSES.has(s ?? "") ? "var(--color-accent)"
  : s === "completed" ? "var(--color-green)"
  : "var(--color-text-4)";

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
  const groups = [
    { label: "Needs you", rows: needs },
    { label: "Running", rows: running },
    { label: "Recent", rows: recent },
  ].filter((g) => g.rows.length);

  async function del(e: React.MouseEvent, r: RunSummary) {
    e.stopPropagation();
    const name = r.brand_name || r.product_name || `#${r.id}`;
    if (!window.confirm(`Delete run "${name}"? This can't be undone.`)) return;
    setDeleting(r.id);
    try {
      const res = await fetch(`/api/runs/${r.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.refresh();
      push("Run deleted", "success");
    } catch { push("Couldn't delete that run"); }
    finally { setDeleting(null); }
  }

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "30px 22px 80px" }} data-screen-label="Home">
      <div className="flex items-center gap-3.5 mb-[22px]">
        <h1 className="text-[19px] font-[600] tracking-[-0.02em] text-[var(--color-text)]">Runs</h1>
        <div className="flex-1" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, code or run number"
          className="w-[250px] h-8 px-[11px] text-[13px] rounded-[6px] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] outline-none focus:border-[var(--color-border-strong)] placeholder:text-[var(--color-text-3)]" />
        <button onClick={() => router.push("/new")}
          className="cursor-pointer h-8 px-[13px] rounded-[6px] bg-[var(--color-primary)] text-[var(--color-on-primary)] text-[13px] font-[500] hover:opacity-90 tr">New run</button>
      </div>

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
                style={{ gridTemplateColumns: "34px minmax(0,1fr) 210px 74px 18px" }}>
                <div className="w-[34px] h-[34px] rounded-[5px] border border-[var(--color-border)] grid place-items-center ff-mono text-[9px] text-[var(--color-text-3)] overflow-hidden"
                  style={{ background: "repeating-linear-gradient(135deg,var(--color-surface-2) 0 4px,var(--color-bg) 4px 8px)" }}>
                  {r.stage3_hero_image_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={r.stage3_hero_image_url} alt="" className="w-full h-full object-cover" />
                    : (r.product_code || "—")}
                </div>
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13.5px] font-[500] truncate text-[var(--color-text)]">{r.brand_name || r.product_name || `Run ${r.id}`}</span>
                    <span className="ff-mono text-[10.5px] text-[var(--color-text-3)]">run {r.id}</span>
                  </div>
                  <div className="text-[12px] text-[var(--color-text-2)] truncate">{r.product_url ? truncateUrl(r.product_url, 64) : "—"}</div>
                </div>
                <div className="flex items-center gap-[7px] min-w-0">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: toneOf(r.status) }} />
                  <span className="text-[12.5px] text-[var(--color-text)] truncate">{NEED_COPY[r.status ?? ""] ?? statusLabel(r.status) ?? r.current_step ?? ""}</span>
                </div>
                <div className="ff-mono text-[11px] text-[var(--color-text-3)] text-right">{relativeTime(r.last_updated_at ?? r.created_at)}</div>
                <button onClick={(e) => del(e, r)} disabled={deleting === r.id} aria-label="Delete run"
                  className="cursor-pointer text-[13px] text-[var(--color-text-4)] opacity-0 group-hover:opacity-100 hover:text-[var(--color-red)] tr">×</button>
              </div>
            ))}
          </div>
        </div>
      ))}

      {groups.length === 0 && (
        <div className="py-[60px] text-center text-[13px] text-[var(--color-text-2)]">
          {query ? <>Nothing matches “{q}”.</> : <>No runs yet. <button onClick={() => router.push("/new")} className="cursor-pointer underline">Start one</button>.</>}
        </div>
      )}
    </div>
  );
}
