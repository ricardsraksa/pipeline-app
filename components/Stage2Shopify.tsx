"use client";

// Shopify hand-off view: the Stage 2 copy kit as a flat list of rows matching
// the Shopify product-metafields panel exactly — same labels, same order, one
// copy button per field — so each value pastes straight into its field.
// (Labels mirror the store's own definitions verbatim, including its
// "Section 1 Heading" vs "Section 2/3 Headline" inconsistency.)

import { useState } from "react";
import { type Stage2Json, whatsIncluded } from "@/lib/stage2/shape";

function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  if (!text?.trim()) return null;
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })}
      title={`Copy ${label ?? "field"}`}
      className="shrink-0 inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-[11px] font-[620] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text-2)] tr hover:text-[var(--color-text)] hover:border-[var(--color-text-3)] cursor-pointer"
    >
      {copied ? "Copied ✓" : "Copy"}
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  if (!value?.trim()) return null;
  return (
    <div className="flex items-start justify-between gap-3 px-3.5 py-2.5 border-b border-[var(--color-border)] last:border-0">
      <div className="min-w-0">
        <p className="eyebrow text-[var(--color-text-3)] mb-0.5">{label}</p>
        <p className="text-[13px] text-[var(--color-text)] whitespace-pre-wrap break-words">{value}</p>
      </div>
      <CopyBtn text={value} label={label} />
    </div>
  );
}

export default function Stage2Shopify({ json }: { json: Stage2Json }) {
  const rows: Array<{ label: string; value: string }> = [
    { label: "Product Title", value: json.product_name },
    { label: "PDP Badge Text", value: json.badge },
    { label: "PDP Title Support Text", value: json.supporting_sentence },
    { label: "PDP Benefit 1", value: json.benefits[0] ?? "" },
    { label: "PDP Benefit 2", value: json.benefits[1] ?? "" },
    { label: "PDP Benefit 3", value: json.benefits[2] ?? "" },
    { label: "What's Included (Answer)", value: whatsIncluded(json) },
    { label: "Product Specific Question 1", value: json.faqs[0]?.q ?? "" },
    { label: "Product Specific Answer 1", value: json.faqs[0]?.a ?? "" },
    { label: "Product Specific Question 2", value: json.faqs[1]?.q ?? "" },
    { label: "Product Specific Answer 2", value: json.faqs[1]?.a ?? "" },
    { label: "Section 1 Heading", value: json.sections[0]?.headline ?? "" },
    { label: "Section 1 Text", value: json.sections[0]?.paragraph ?? "" },
    { label: "Section 2 Headline", value: json.sections[1]?.headline ?? "" },
    { label: "Section 2 Text", value: json.sections[1]?.paragraph ?? "" },
    { label: "Section 3 Headline", value: json.sections[2]?.headline ?? "" },
    { label: "Section 3 Text", value: json.sections[2]?.paragraph ?? "" },
  ];
  return (
    <div className="border border-[var(--color-border)] rounded-[var(--radius)] bg-[var(--color-surface)] overflow-hidden">
      {rows.map((r) => <Row key={r.label} label={r.label} value={r.value} />)}
    </div>
  );
}
