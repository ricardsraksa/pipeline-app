"use client";

// Import: where new products go in — name, links (reel, brand site, Amazon)
// and priority. Each gets a P number and a tab in the master doc; starting
// them happens on Start runs.

import Link from "next/link";
import ImportTable from "@/components/import/ImportTable";
import DocImport from "@/components/import/DocImport";
import { cx, docStatus, PriorityBadge, useImportList } from "@/components/import/shared";

export default function ImportPage() {
  const { items, docConfigured, failed, reload } = useImportList();

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "44px 22px 80px" }} data-screen-label="Import">
      <div className="flex items-baseline justify-between mb-[20px]">
        <h1 className="text-[19px] font-[600] tracking-[-0.02em] text-[var(--color-text)]">Import</h1>
        <DocImport onImported={reload} />
      </div>

      <ImportTable onImported={reload} />

      <div className="flex items-center gap-2 px-0.5 pt-[28px] pb-[7px]">
        <span className="eyebrow">Waiting to start</span>
        <span className="ff-mono text-[11px] text-[var(--color-text-3)]">{items?.length ?? ""}</span>
        <Link href="/new" className="ml-auto text-[12.5px] text-[var(--color-accent)] hover:underline cursor-pointer">Start runs →</Link>
      </div>
      {failed && <div className="text-[13px] text-[var(--color-red)]">Couldn&apos;t load the list. <button onClick={reload} className="underline cursor-pointer">Retry</button></div>}
      {items && items.length === 0 && <div className="text-[13px] text-[var(--color-text-2)] px-0.5">Nothing waiting.</div>}
      {items && items.length > 0 && (
        <div className="border border-[var(--color-border)] rounded-[9px] bg-[var(--color-surface)] overflow-hidden">
          {items.map((it, i) => {
            const st = docStatus(it, docConfigured);
            return (
              <div key={it.id} className={cx("grid items-center gap-3 px-[13px] py-[9px]", i > 0 && "border-t border-[var(--color-border)]")}
                style={{ gridTemplateColumns: "52px 18px minmax(0,1fr) auto" }}>
                <span className="ff-mono text-[12px] text-[var(--color-text-2)]">{it.productCode}</span>
                <span>{it.priority ? <PriorityBadge /> : null}</span>
                <span className="text-[13px] text-[var(--color-text)] truncate">{it.name}</span>
                <span className={cx("text-[11.5px] truncate max-w-[260px]",
                  st.tone === "bad" ? "text-[var(--color-red)]" : st.tone === "ok" ? "text-[var(--color-text-3)]" : "text-[var(--color-amber)]")} title={st.text}>{st.text}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
