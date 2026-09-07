"use client";

import { useEffect, useMemo, useState } from "react";
import { parseProductScrape } from "@/lib/product";


// The options to set up in Shopify, read from the AliExpress listing and
// restructurable — by hand or with an instruction like "split into Color and
// Size", since suppliers cram several dimensions into one group. Display only;
// nothing here is pushed to Shopify.

type Variant = { title: string | null; price: string | null; available?: boolean };
type Edited = { options: Record<string, string[]>; variants?: Variant[]; at?: string; source?: string; instruction?: string };

function parseEdited(raw: string | null | undefined): Edited | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Edited;
    return v && v.options && typeof v.options === "object" ? v : null;
  } catch { return null; }
}

export default function VariantsCard({ runId, scrape, requestedAt = null, edited = null }: {
  runId: number;
  scrape: string | null;
  /** Set while a re-read is waiting for the Mac worker. */
  requestedAt?: string | null;
  /** The operator's restructured options (JSON), when they have edited. */
  edited?: string | null;
}) {
  const parsed = useMemo(() => parseProductScrape(scrape), [scrape]);
  const [copied, setCopied] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [asked, setAsked] = useState<string | null>(requestedAt);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [override, setOverride] = useState<Edited | null>(parseEdited(edited));
  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Array<{ name: string; values: string }>>([]);

  useEffect(() => { setAsked(requestedAt); }, [requestedAt]);
  useEffect(() => { setOverride(parseEdited(edited)); }, [edited]);

  const page = parsed?.pages.find((p) => p.role === "product");
  const listingOptions = page?.options ?? {};
  const listingVariants = page?.variants ?? [];
  const options = override?.options ?? listingOptions;
  const variants = override?.variants ?? listingVariants;
  const groups = Object.entries(options).filter(([, vals]) => vals.length);
  const empty = !groups.length;

  const reread = async () => {
    setAsking(true); setErr(null);
    try {
      const r = await fetch(`/api/runs/${runId}/variants-refresh`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) { setErr(d.error || `Failed (${r.status})`); return; }
      setAsked(d.requested_at as string);
    } catch { setErr("Network error"); }
    finally { setAsking(false); }
  };

  const saveOverride = async (next: Edited | null) => {
    setOverride(next);
    setErr(null);
    try {
      const r = await fetch(`/api/runs/${runId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_variants_edited: next ? JSON.stringify(next) : null }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); setErr((d as { error?: string }).error || `Save failed (${r.status})`); }
    } catch { setErr("Network error saving the options"); }
  };

  const runAi = async () => {
    if (aiText.trim().length < 3) return;
    setAiBusy(true); setErr(null); setNote(null);
    try {
      const r = await fetch("/api/variants/edit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, instruction: aiText.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) { setErr((d as { error?: string }).error || `Failed (${r.status})`); return; }
      setOverride(d.edited as Edited);
      setNote((d as { note?: string }).note || null);
      setAiOpen(false); setAiText("");
    } catch { setErr("Network error"); }
    finally { setAiBusy(false); }
  };

  const startEditing = () => {
    setDraft(groups.map(([name, vals]) => ({ name, values: vals.join(", ") })));
    setEditing(true);
  };
  const saveEditing = () => {
    const next: Record<string, string[]> = {};
    for (const row of draft) {
      const name = row.name.trim();
      const vals = row.values.split(",").map((v) => v.trim()).filter(Boolean);
      if (name && vals.length) next[name] = [...new Set(vals)];
    }
    setEditing(false);
    if (!Object.keys(next).length) return;
    void saveOverride({ options: next, variants, source: "manual" });
  };

  if (!parsed) return null;

  const copy = (key: string, text: string) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(null), 1200); }).catch(() => {});
  };

  return (
    <div className="mb-6">
      <div className="flex items-center gap-3.5 mb-2.5 flex-wrap">
        <span className="eyebrow">Variants</span>
        <span className="ff-mono text-[10.5px] text-[var(--color-text-3)]">
          {empty ? "none read from the listing" : `${groups.length} option${groups.length === 1 ? "" : "s"}`}
        </span>
        {override && <span className="ff-mono text-[10px] uppercase tracking-wide text-[var(--color-amber)] bg-[var(--color-amber-bg)] rounded px-1.5 py-0.5">edited</span>}
        <div className="flex-1" />
        {!empty && !editing && <button onClick={() => setAiOpen((v) => !v)} className="btn btn-sm">Edit with AI</button>}
        {!empty && (editing
          ? <><button onClick={saveEditing} className="btn btn-sm btn-primary">Save</button><button onClick={() => setEditing(false)} className="btn btn-sm">Cancel</button></>
          : <button onClick={startEditing} className="btn btn-sm">Edit by hand</button>)}
        {override && !editing && <button onClick={() => saveOverride(null)} className="btn btn-sm" title="Go back to what the listing said">Revert</button>}
        {asked
          ? <span className="ff-mono text-[10.5px] text-[var(--color-amber)]" title="The Mac worker picks this up on its next poll (about 20 s) and re-reads the listing">re-reading on your Mac…</span>
          : <button onClick={reread} disabled={asking} className="btn btn-sm">Re-read listing</button>}
      </div>

      {aiOpen && (
        <div className="mb-2 flex gap-2 items-center flex-wrap">
          <input
            value={aiText} onChange={(e) => setAiText(e.target.value)} autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") void runAi(); if (e.key === "Escape") setAiOpen(false); }}
            placeholder="e.g. split into Color and Size"
            className="flex-1 min-w-[280px] px-[11px] py-2 rounded-[8px] bg-[var(--color-surface)] border border-[var(--color-border)] text-[12.5px] text-[var(--color-text)] outline-none focus:border-[var(--color-border-strong)]"
          />
          <button onClick={runAi} disabled={aiBusy || aiText.trim().length < 3} className="btn btn-sm btn-primary">{aiBusy ? "Working…" : "Apply"}</button>
          <button onClick={() => setAiOpen(false)} className="btn btn-sm">Cancel</button>
        </div>
      )}
      {note && <p className="text-[11.5px] text-[var(--color-amber)] mb-2">{note}</p>}
      {err && <p className="text-[11.5px] text-[var(--color-red)] mb-2">{err}</p>}

      <div className="border border-[var(--color-border)] rounded-[9px] bg-[var(--color-surface)] px-[13px] py-3 space-y-3">
        {empty && <p className="ff-mono text-[11px] text-[var(--color-text-4)]">No option groups in the stored scrape.</p>}

        {editing ? (
          <div className="space-y-2">
            {draft.map((row, i) => (
              <div key={i} className="flex gap-2 items-start">
                <input value={row.name} onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  placeholder="Option name" className="w-[130px] shrink-0 px-2 py-1.5 rounded-[7px] bg-[var(--color-surface)] border border-[var(--color-border)] text-[12.5px] font-[600] text-[var(--color-text)] outline-none focus:border-[var(--color-border-strong)]" />
                <textarea value={row.values} onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, values: e.target.value } : x)))} rows={2}
                  placeholder="Values, comma separated" className="flex-1 px-2 py-1.5 rounded-[7px] bg-[var(--color-surface)] border border-[var(--color-border)] ff-mono text-[11.5px] text-[var(--color-text)] outline-none resize-y focus:border-[var(--color-border-strong)]" />
                <button onClick={() => setDraft((d) => d.filter((_, j) => j !== i))} title="Remove this option" className="btn btn-sm btn-danger">×</button>
              </div>
            ))}
            <button onClick={() => setDraft((d) => [...d, { name: "", values: "" }])} className="btn btn-sm">+ Add option</button>
          </div>
        ) : (
          groups.map(([name, vals]) => (
            <div key={name} className="flex items-start gap-3">
              <div className="w-[110px] shrink-0 pt-0.5">
                <p className="text-[12.5px] font-[600] text-[var(--color-text)] truncate" title={name}>{name}</p>
                <button onClick={() => copy(name, vals.join(", "))} className="ff-mono text-[10px] text-[var(--color-text-4)] hover:text-[var(--color-text-2)] cursor-pointer">
                  {copied === name ? "copied" : "copy values"}
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5 min-w-0">
                {vals.map((v) => (
                  <span key={v} className="ff-mono text-[11px] text-[var(--color-text-2)] border border-[var(--color-border)] rounded-full px-2 py-0.5">{v}</span>
                ))}
              </div>
            </div>
          ))
        )}

      </div>
    </div>
  );
}
