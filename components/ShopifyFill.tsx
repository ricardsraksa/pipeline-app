"use client";

// Shopify v2 panel: paste the existing product's URL → Preview (dry run, zero
// writes) → Apply. Strict/reversible on the server: metafields + optional
// title + append-only images; never publishes or deletes.

import { useState } from "react";

interface FieldRow {
  label: string;
  status: "set" | "skipped-empty" | "no-definition" | "unsupported-type" | "error";
  value?: string;
  detail?: string;
}

interface Report {
  product: { title: string; handle: string; status: string; adminUrl: string; mediaCount: number };
  dryRun: boolean;
  fields: FieldRow[];
  orphans: Array<{ name: string }>;
  titleUpdate: { from: string; to: string; applied: boolean } | null;
  images: { toAdd: Array<{ url: string; alt: string }>; skipped: number; added: number };
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })}
      className="cursor-pointer text-[10px] px-1.5 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-3)] hover:text-[var(--color-text)] tr"
    >
      {copied ? "Copied ✓" : "Copy"}
    </button>
  );
}

const STATUS_UI: Record<FieldRow["status"], { label: string; cls: string }> = {
  "set": { label: "will set", cls: "text-[var(--color-green)]" },
  "skipped-empty": { label: "empty — skipped", cls: "text-[var(--color-text-4)]" },
  "no-definition": { label: "no matching metafield", cls: "text-[var(--color-amber)]" },
  "unsupported-type": { label: "unsupported type", cls: "text-[var(--color-amber)]" },
  "error": { label: "rejected", cls: "text-[var(--color-red)]" },
};

export default function ShopifyFill({ runId, initialAdminUrl }: { runId: number; initialAdminUrl: string | null }) {
  const [url, setUrl] = useState("");
  const [includeTitle, setIncludeTitle] = useState(false);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  async function push(dryRun: boolean) {
    setBusy(dryRun ? "preview" : "apply");
    setErr(null);
    try {
      const res = await fetch("/api/shopify/fill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, productUrl: url.trim() || undefined, includeTitle, dryRun }),
      });
      const data = await res.json();
      if (!data.success) { setErr(data.error ?? `Failed (${res.status})`); return; }
      setReport(data.report as Report);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="border border-[var(--color-border)] rounded-[11px] bg-[var(--color-surface)] p-4 space-y-3">
      <div>
        <h3 className="text-[14px] font-[640] text-[var(--color-text)]">Fill Shopify PDP</h3>
        <p className="text-[11.5px] text-[var(--color-text-3)] mt-0.5">
          Fills the metafields and appends the images. Never publishes or deletes.
        </p>
      </div>
      <div className="flex gap-2 flex-wrap items-center">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={initialAdminUrl ? `Last: ${initialAdminUrl}` : "Paste the product URL (admin or storefront)"}
          className="flex-1 min-w-[260px] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-md px-3 py-1.5 text-[12px] focus:outline-none focus:border-[var(--color-accent)]"
        />
        <label className="flex items-center gap-1.5 text-[11.5px] text-[var(--color-text-2)] cursor-pointer select-none">
          <input type="checkbox" checked={includeTitle} onChange={(e) => setIncludeTitle(e.target.checked)} />
          also update title
        </label>
      </div>
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => push(true)}
          disabled={busy !== null}
          className="cursor-pointer rounded-md px-3 py-1.5 text-[12px] font-[620] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text-2)] hover:text-[var(--color-text)] tr disabled:opacity-40"
        >
          {busy === "preview" ? "Previewing…" : "Preview changes (no writes)"}
        </button>
        {report?.dryRun && (
          <button
            onClick={() => push(false)}
            disabled={busy !== null}
            className="cursor-pointer rounded-md px-3 py-1.5 text-[12px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] disabled:opacity-40"
          >
            {busy === "apply" ? "Applying…" : `Apply to “${report.product.title}”`}
          </button>
        )}
      </div>
      {err && <p className="text-[11.5px] text-[var(--color-red)]">{err}</p>}
      {report && (
        <div className="space-y-2">
          <p className="text-[11.5px] text-[var(--color-text-2)]">
            {report.dryRun ? "Preview for" : "Applied to"}{" "}
            <a href={report.product.adminUrl} target="_blank" rel="noopener noreferrer" className="underline">
              {report.product.title}
            </a>{" "}
            ({report.product.status.toLowerCase()}, {report.product.mediaCount} existing images)
            {report.titleUpdate && ` · title ${report.titleUpdate.applied ? "updated" : "would change"} from “${report.titleUpdate.from}”`}
            {" · "}{report.images.toAdd.length} image{report.images.toAdd.length === 1 ? "" : "s"} {report.dryRun ? "to add" : "added"}
            {report.images.skipped > 0 && ` (${report.images.skipped} already there)`}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <tbody>
                {report.fields.map((f) => (
                  <tr key={f.label} className="border-t border-[var(--color-border)]">
                    <td className="py-1 pr-3 whitespace-nowrap text-[var(--color-text-2)]">{f.label}</td>
                    <td className={`py-1 pr-3 whitespace-nowrap ${STATUS_UI[f.status].cls}`}>
                      {STATUS_UI[f.status].label}
                      {f.detail ? ` — ${f.detail}` : ""}
                    </td>
                    <td className="py-1 text-right">
                      {f.status === "no-definition" && f.value ? <CopyBtn text={f.value} /> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {report.orphans.length > 0 && (
            <p className="text-[10.5px] text-[var(--color-text-4)]">
              Store metafields with no pipeline field: {report.orphans.map((o) => o.name).join(", ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
