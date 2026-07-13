"use client";

// Per-field view of the Stage 2 copy kit (derived JSON). Each field gets a
// one-click copy button. The canonical free text + 11pt-Arial whole-kit copy
// lives in the EditableOutput above this — this is the convenience layer.

import { useState } from "react";
import { type Stage2Json, stage2Warnings } from "@/lib/stage2/shape";

function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  if (!text?.trim()) return null;
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => {}); }}
      title={`Copy ${label ?? "field"}`}
      className="shrink-0 inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-[11px] font-[620] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text-2)] tr hover:text-[var(--color-text)] hover:border-[var(--color-text-3)] cursor-pointer"
    >
      {copied ? "Copied ✓" : "Copy"}
    </button>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  if (!value?.trim()) return null;
  return (
    <div className="flex items-start justify-between gap-3 px-3.5 py-2.5 border-b border-[var(--color-border)] last:border-0">
      <div className="min-w-0">
        <p className="eyebrow text-[var(--color-text-3)] mb-0.5">{label}</p>
        <p className={`text-[13px] text-[var(--color-text)] whitespace-pre-wrap break-words ${mono ? "ff-mono text-[12px]" : ""}`}>{value}</p>
      </div>
      <CopyBtn text={value} label={label} />
    </div>
  );
}

export default function Stage2Structured({ json }: { json: Stage2Json }) {
  const warnings = stage2Warnings(json);
  return (
    <div className="space-y-3">
      {warnings.length > 0 && (
        <div className="flex items-start gap-2 px-3.5 py-2.5 rounded-[var(--radius-sm)] bg-[var(--color-amber-bg)]">
          <span className="text-[11.5px] text-[var(--color-text-2)]">
            Structure check: {warnings.join(" · ")}. (The text above is still the source of truth.)
          </span>
        </div>
      )}

      <div className="border border-[var(--color-border)] rounded-[var(--radius)] bg-[var(--color-surface)] overflow-hidden">
        <Field label="Produkt-Name" value={json.product_name} />
        <Field label="Badge" value={json.badge} />
        <Field label="Supporting sentence" value={json.supporting_sentence} />
      </div>

      {json.benefits.length > 0 && (
        <div className="border border-[var(--color-border)] rounded-[var(--radius)] bg-[var(--color-surface)] overflow-hidden">
          <div className="flex items-center justify-between px-3.5 py-2 bg-[var(--color-surface-2)] border-b border-[var(--color-border)]">
            <span className="eyebrow text-[var(--color-text-2)]">Hauptvorteile</span>
            <CopyBtn text={json.benefits.join("\n")} label="all benefits" />
          </div>
          {json.benefits.map((b, i) => <Field key={i} label={`Vorteil ${i + 1}`} value={b} />)}
        </div>
      )}

      {json.sections.length > 0 && (
        <div className="border border-[var(--color-border)] rounded-[var(--radius)] bg-[var(--color-surface)] overflow-hidden">
          <div className="px-3.5 py-2 bg-[var(--color-surface-2)] border-b border-[var(--color-border)]">
            <span className="eyebrow text-[var(--color-text-2)]">Headlines &amp; Paragraphs</span>
          </div>
          {json.sections.map((s, i) => (
            <div key={i} className="px-3.5 py-2.5 border-b border-[var(--color-border)] last:border-0 space-y-1.5">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[13.5px] font-[620] text-[var(--color-text)]">{s.headline}</p>
                <CopyBtn text={`${s.headline}\n\n${s.paragraph}`} label={`section ${i + 1}`} />
              </div>
              <p className="text-[13px] text-[var(--color-text-2)] whitespace-pre-wrap break-words">{s.paragraph}</p>
            </div>
          ))}
        </div>
      )}

      <div className="border border-[var(--color-border)] rounded-[var(--radius)] bg-[var(--color-surface)] overflow-hidden">
        <Field label="Was ist enthalten?" value={json.was_enthalten} />
        {json.faqs.map((f, i) => (
          <div key={i} className="px-3.5 py-2.5 border-b border-[var(--color-border)] last:border-0 space-y-1">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[12.5px] font-[620] text-[var(--color-text)]">{f.q}</p>
              <CopyBtn text={`${f.q}\n${f.a}`} label={`FAQ ${i + 1}`} />
            </div>
            <p className="text-[13px] text-[var(--color-text-2)] whitespace-pre-wrap break-words">{f.a}</p>
          </div>
        ))}
      </div>

      {(json.facebook.headline || json.facebook.primary || json.facebook.description) && (
        <div className="border border-[var(--color-border)] rounded-[var(--radius)] bg-[var(--color-surface)] overflow-hidden">
          <div className="px-3.5 py-2 bg-[var(--color-surface-2)] border-b border-[var(--color-border)]">
            <span className="eyebrow text-[var(--color-text-2)]">Facebook</span>
          </div>
          <Field label="Headline" value={json.facebook.headline} />
          <Field label="Primary text" value={json.facebook.primary} />
          <Field label="Description" value={json.facebook.description} />
        </div>
      )}

      {json.one_liners.length > 0 && (
        <div className="border border-[var(--color-border)] rounded-[var(--radius)] bg-[var(--color-surface)] overflow-hidden">
          <div className="flex items-center justify-between px-3.5 py-2 bg-[var(--color-surface-2)] border-b border-[var(--color-border)]">
            <span className="eyebrow text-[var(--color-text-2)]">One-Liners</span>
            <CopyBtn text={json.one_liners.join("\n")} label="all one-liners" />
          </div>
          {json.one_liners.map((o, i) => <Field key={i} label={`#${i + 1}`} value={o} />)}
        </div>
      )}
    </div>
  );
}
