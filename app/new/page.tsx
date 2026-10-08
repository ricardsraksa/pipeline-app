"use client";

// Start runs: the imported products waiting to start, priority first. Paste
// the AliExpress link on a row and press Start — the run takes the next P
// number and begins exactly as before. (Replaces the old New run form.)

import Link from "next/link";
import StartRow from "@/components/import/StartRow";
import { cx, useImportList } from "@/components/import/shared";

export default function StartRunsPage() {
  const { items, docConfigured, failed, reload } = useImportList();

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: "44px 22px 80px" }} data-screen-label="Start runs">
      <div className="flex items-baseline justify-between mb-[20px]">
        <h1 className="text-[19px] font-[600] tracking-[-0.02em] text-[var(--color-text)]">Start runs</h1>
        <Link href="/import" className="text-[12.5px] text-[var(--color-accent)] hover:underline cursor-pointer">Import products →</Link>
      </div>
      {failed && <div className="text-[13px] text-[var(--color-red)] mb-3">Couldn&apos;t load the list. <button onClick={reload} className="underline cursor-pointer">Retry</button></div>}
      {items && items.length === 0 && (
        <div className="border border-dashed border-[var(--color-border-strong)] rounded-[9px] px-5 py-8 text-center text-[13px] text-[var(--color-text-2)]">
          Nothing waiting. <Link href="/import" className="text-[var(--color-accent)] hover:underline cursor-pointer">Import products</Link> to start runs from them.
        </div>
      )}
      {items && items.length > 0 && (
        <div className="border border-[var(--color-border)] rounded-[9px] bg-[var(--color-surface)] overflow-hidden">
          {items.map((it, i) => (
            <div key={it.id} className={cx(i > 0 && "border-t border-[var(--color-border)]")}>
              <StartRow item={it} first={i === 0} docConfigured={docConfigured} onChanged={reload} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
