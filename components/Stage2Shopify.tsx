"use client";

// Shopify hand-off view: the Stage 2 copy kit as a flat list of rows matching
// the Shopify product-metafields panel exactly — same labels, same order, one
// copy button per field — so each value pastes straight into its field.
// (Labels mirror the store's own definitions verbatim, including its
// "Section 1 Heading" vs "Section 2/3 Headline" inconsistency.)

import { useState } from "react";
import { type Stage2Json, whatsIncluded } from "@/lib/stage2/shape";
import { SHOPIFY_FIELDS } from "@/lib/shopify/fields";

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

/** A card of rows with an optional "Copy all" for the whole group. */
function Group({
  title,
  rows,
  copyAll,
}: {
  title?: string;
  rows: Array<{ label: string; value: string }>;
  copyAll?: string;
}) {
  const filled = rows.filter((r) => r.value?.trim());
  if (!filled.length) return null;
  return (
    <div className="border border-[var(--color-border)] rounded-[var(--radius)] bg-[var(--color-surface)] overflow-hidden">
      {title && (
        <div className="flex items-center justify-between gap-3 px-3.5 py-2 bg-[var(--color-surface-2)] border-b border-[var(--color-border)]">
          <span className="eyebrow text-[var(--color-text-2)]">{title}</span>
          {copyAll?.trim() && <CopyBtn text={copyAll} label={`all of ${title}`} />}
        </div>
      )}
      {filled.map((r) => <Row key={r.label} label={r.label} value={r.value} />)}
    </div>
  );
}

export default function Stage2Shopify({ json }: { json: Stage2Json }) {
  const section = (i: number) => json.sections[i] ?? { headline: "", paragraph: "" };
  // "Copy all" for a section gives heading + text as one block — for pasting
  // both fields at once, or into anything that takes the whole section.
  const sectionAll = (i: number) => {
    const s = section(i);
    return [s.headline, s.paragraph].filter((x) => x?.trim()).join("\n\n");
  };
  const faq = (i: number) => json.faqs[i] ?? { q: "", a: "" };
  // Question + answer as one block, for pasting the pair in one go.
  const faqAll = (i: number) => {
    const f = faq(i);
    return [f.q, f.a].filter((x) => x?.trim()).join("\n\n");
  };

  return (
    <div className="space-y-3">
      <Group
        rows={[
          { label: "Product Title", value: json.product_name },
          ...SHOPIFY_FIELDS.slice(0, 2).map((f) => ({ label: f.label, value: f.get(json) })),
        ]}
      />
      <Group
        title="Benefits"
        copyAll={json.benefits.filter((b) => b?.trim()).join("\n")}
        rows={[
          { label: "PDP Benefit 1", value: json.benefits[0] ?? "" },
          { label: "PDP Benefit 2", value: json.benefits[1] ?? "" },
          { label: "PDP Benefit 3", value: json.benefits[2] ?? "" },
        ]}
      />
      <Group rows={[{ label: "What's Included (Answer)", value: whatsIncluded(json) }]} />
      <Group
        title="FAQ 1"
        copyAll={faqAll(0)}
        rows={[
          { label: "Product Specific Question 1", value: faq(0).q },
          { label: "Product Specific Answer 1", value: faq(0).a },
        ]}
      />
      <Group
        title="FAQ 2"
        copyAll={faqAll(1)}
        rows={[
          { label: "Product Specific Question 2", value: faq(1).q },
          { label: "Product Specific Answer 2", value: faq(1).a },
        ]}
      />
      <Group
        title="Section 1"
        copyAll={sectionAll(0)}
        rows={[
          { label: "Section 1 Heading", value: section(0).headline },
          { label: "Section 1 Text", value: section(0).paragraph },
        ]}
      />
      <Group
        title="Section 2"
        copyAll={sectionAll(1)}
        rows={[
          { label: "Section 2 Headline", value: section(1).headline },
          { label: "Section 2 Text", value: section(1).paragraph },
        ]}
      />
      <Group
        title="Section 3"
        copyAll={sectionAll(2)}
        rows={[
          { label: "Section 3 Headline", value: section(2).headline },
          { label: "Section 3 Text", value: section(2).paragraph },
        ]}
      />
      <Group
        title="Facebook ad"
        copyAll={[
          json.facebook?.headline && `Headline: ${json.facebook.headline}`,
          json.facebook?.primary && `Primary text: ${json.facebook.primary}`,
          json.facebook?.description && `Description: ${json.facebook.description}`,
        ].filter(Boolean).join("\n\n")}
        rows={[
          { label: "Facebook Headline", value: json.facebook?.headline ?? "" },
          { label: "Facebook Primary Text", value: json.facebook?.primary ?? "" },
          { label: "Facebook Description", value: json.facebook?.description ?? "" },
        ]}
      />
      <Group
        title="One-liners"
        copyAll={json.one_liners.filter((o) => o?.trim()).join("\n")}
        rows={json.one_liners.map((o, i) => ({ label: `One-liner ${i + 1}`, value: o }))}
      />
    </div>
  );
}
