"use client";

// Shopify panel: the product URL (saved on the run) and one button. The push
// sets the title, fills the metafields and appends the images. Strict/reversible
// on the server: never publishes, never deletes, never touches price.

import { useEffect, useState } from "react";

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
  "set": { label: "set", cls: "text-[var(--color-green)]" },
  "skipped-empty": { label: "empty — skipped", cls: "text-[var(--color-text-4)]" },
  "no-definition": { label: "no matching metafield", cls: "text-[var(--color-amber)]" },
  "unsupported-type": { label: "unsupported type", cls: "text-[var(--color-amber)]" },
  "error": { label: "rejected", cls: "text-[var(--color-red)]" },
};

export default function ShopifyFill({ runId, initialAdminUrl, initialUrl }: { runId: number; initialAdminUrl: string | null; initialUrl?: string | null }) {
  // The one place the run's Shopify product link is set; saved on blur so
  // Push to all uses the same link.
  const [url, setUrl] = useState(initialUrl ?? "");
  const [urlErr, setUrlErr] = useState(false);
  const saveUrl = async (v: string) => {
    if (v.trim() === (initialUrl ?? "")) return;
    try {
      const res = await fetch(`/api/runs/${runId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shopify_product_url: v.trim() || null }) });
      setUrlErr(!res.ok);
      if (res.ok) window.dispatchEvent(new Event("run:changed"));
    } catch { setUrlErr(true); }
  };
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // A template product is set: an empty link means "create it for me".
  const [template, setTemplate] = useState(false);
  useEffect(() => {
    fetch("/api/settings/shopify?lite=1").then((r) => r.json()).then((d) => setTemplate(Boolean(d.url))).catch(() => {});
  }, []);
  const willCreate = template && !url.trim() && !initialAdminUrl;
  const [created, setCreated] = useState<{ adminUrl: string; handle: string } | null>(null);
  const [setup, setSetup] = useState<{ variants?: string; price?: string; problem?: string } | null>(null);

  async function push() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/shopify/fill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, productUrl: url.trim() || undefined, includeTitle: true, dryRun: false }),
      });
      const data = await res.json();
      if (!data.success) { setErr(data.error ?? `Failed (${res.status})`); return; }
      setReport(data.report as Report);
      if (data.created) { setCreated(data.created); setUrl(data.created.adminUrl); }
      setSetup(data.setup && Object.keys(data.setup).length ? data.setup : null);
      if (data.warning) setErr(String(data.warning));
      setNote(data.restructured ? "Re-derived from your edits." : null);
      window.dispatchEvent(new Event("run:changed"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-[var(--color-border)] rounded-[11px] bg-[var(--color-surface)] p-4 space-y-3">
      <h3 className="text-[14px] font-[640] text-[var(--color-text)]">Shopify</h3>
      <div className="flex gap-2 flex-wrap items-center">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={(e) => void saveUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          spellCheck={false}
          aria-label="Shopify product link"
          aria-invalid={urlErr}
          placeholder={initialAdminUrl ? `Last: ${initialAdminUrl}` : "Shopify product link"}
          className={`flex-1 min-w-[260px] border ${urlErr ? "border-[var(--color-red)]" : "border-[var(--color-border-strong)]"} bg-[var(--color-surface)] text-[var(--color-text)] rounded-md px-3 py-1.5 text-[12px] focus:outline-none focus:border-[var(--color-accent)]`}
        />
        <button
          onClick={push}
          disabled={busy || !(url.trim() || initialAdminUrl || template)}
          className="cursor-pointer rounded-md px-3 py-1.5 text-[12px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] disabled:opacity-40"
        >
          {busy ? (willCreate ? "Creating…" : "Pushing…") : willCreate ? "Create & push to Shopify" : "Push to Shopify"}
        </button>
      </div>
      {note && <p className="text-[11.5px] text-[var(--color-text-3)]">{note}</p>}
      {created && (
        <p className="text-[11.5px] text-[var(--color-text-2)]">
          Draft created: /products/{created.handle} ·{" "}
          <a href={created.adminUrl} target="_blank" rel="noopener noreferrer" className="underline">open in Shopify</a>
        </p>
      )}
      {setup && (
        <p className={`text-[11.5px] ${setup.problem ? "text-[var(--color-amber)]" : "text-[var(--color-text-2)]"}`}>
          {[setup.variants, setup.price ? `price ${setup.price}` : null].filter(Boolean).join(" · ")}
          {setup.problem ? `${setup.variants || setup.price ? " · " : ""}${setup.problem}` : ""}
        </p>
      )}
      {err && <p className="text-[11.5px] text-[var(--color-red)]">{err}</p>}
      {report && (
        <div className="space-y-2">
          <p className="text-[11.5px] text-[var(--color-text-2)]">
            Pushed to{" "}
            <a href={report.product.adminUrl} target="_blank" rel="noopener noreferrer" className="underline">
              {report.product.title}
            </a>{" "}
            ({report.product.status.toLowerCase()}, {report.product.mediaCount} existing images)
            {report.titleUpdate ? ` · title ${report.titleUpdate.applied ? "updated" : "not updated"} from “${report.titleUpdate.from}”` : " · title unchanged"}
            {" · "}{report.images.toAdd.length === 0 && report.images.skipped > 0
              ? `no new images — all ${report.images.skipped} already on the product`
              : `${report.images.toAdd.length} image${report.images.toAdd.length === 1 ? "" : "s"} added${report.images.skipped > 0 ? ` (${report.images.skipped} already there)` : ""}`}
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
