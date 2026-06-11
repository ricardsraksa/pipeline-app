"use client";

// Line-by-line view of the Stage 2 copy kit: every content line gets its own
// copy button, for pasting straight into individual page-builder fields. Empty
// lines and pure separators (---, ===) are dropped.

import { useState } from "react";

function LineRow({ line }: { line: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start justify-between gap-3 px-3.5 py-2 border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)] tr">
      <p className="text-[13px] text-[var(--color-text)] whitespace-pre-wrap break-words flex-1 leading-snug">{line}</p>
      <button
        onClick={() => navigator.clipboard.writeText(line).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1000); }).catch(() => {})}
        title="Copy line"
        className="shrink-0 inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-[11px] font-[620] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text-2)] tr hover:text-[var(--color-text)] hover:border-[var(--color-text-3)] cursor-pointer"
      >
        {copied ? "Copied ✓" : "Copy"}
      </button>
    </div>
  );
}

export default function Stage2Lines({ text }: { text: string }) {
  const lines = (text || "")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim().length > 0 && !/^[\s\-=_–—·•*]+$/.test(l));

  if (!lines.length) {
    return <p className="text-[12px] text-[var(--color-text-3)]">No copy lines yet.</p>;
  }

  return (
    <div>
      <p className="text-[11.5px] text-[var(--color-text-3)] mb-2">{lines.length} lines · copy any line straight into a field.</p>
      <div className="border border-[var(--color-border)] rounded-[var(--radius)] bg-[var(--color-surface)] overflow-hidden">
        {lines.map((line, i) => <LineRow key={i} line={line} />)}
      </div>
    </div>
  );
}
