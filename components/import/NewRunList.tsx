"use client";

// Top of Runs: imported products waiting to start.

import StartRow from "@/components/import/StartRow";
import { cx, useImportList } from "@/components/import/shared";

export default function NewRunList() {
  const { items, docConfigured, failed, reload } = useImportList();
  if (failed) return <div className="text-[13px] text-[var(--color-red)] mb-[26px]">Couldn&apos;t load new runs. <button onClick={reload} className="underline cursor-pointer">Retry</button></div>;
  if (!items || items.length === 0) return null;
  return (
    <div className="mb-[26px]">
      <div className="flex items-center gap-2 px-0.5 pb-[7px]">
        <span className="eyebrow">To start</span>
        <span className="ff-mono text-[11px] text-[var(--color-text-3)]">{items.length}</span>
      </div>
      <div className="border border-[var(--color-border)] rounded-[9px] bg-[var(--color-surface)] overflow-hidden">
        {items.map((it, i) => (
          <div key={it.id} className={cx(i > 0 && "border-t border-[var(--color-border)]")}>
            <StartRow item={it} first={i === 0} docConfigured={docConfigured} onChanged={reload} />
          </div>
        ))}
      </div>
    </div>
  );
}
