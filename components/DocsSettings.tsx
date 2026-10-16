"use client";
// Settings → Google Doc: the product docs and their tab counts; extra docs
// take new product tabs once a doc is full (Google allows 100 tabs).
import { useEffect, useState } from "react";

type Doc = { id: string; title: string | null; tabs: number | null; error: string | null };

export default function DocsSettings() {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/settings/docs").then((r) => r.json()).then((d) => { setDocs(d.docs ?? []); setAccount(d.account ?? null); }).catch(() => setErr("Couldn't load"));
  }, []);

  const extras = (docs ?? []).slice(1);
  async function save(nextExtras: string[]) {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/settings/docs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ links: nextExtras }) });
      const d = await r.json();
      if (!r.ok) { setErr(d.error ?? `Failed (${r.status})`); return; }
      setDocs(d.docs ?? []); setLink("");
    } catch { setErr("Network error"); }
    finally { setBusy(false); }
  }

  const row = (d: Doc, i: number) => (
    <div key={d.id} className="flex items-center gap-3 py-2 border-t border-[var(--color-border)] first:border-t-0">
      <a href={`https://docs.google.com/document/d/${d.id}/edit`} target="_blank" rel="noreferrer" className="text-[13px] text-[var(--color-text)] hover:underline truncate">{d.title ?? d.id}</a>
      <span className={`ff-mono text-[11px] ${d.tabs !== null && d.tabs >= 100 ? "text-[var(--color-amber)]" : "text-[var(--color-text-3)]"}`}>{d.tabs !== null ? `${d.tabs} / 100` : ""}</span>
      {d.error && <span className="text-[11.5px] text-[var(--color-red)] truncate">{d.error}</span>}
      <div className="flex-1" />
      {i > 0 && <button onClick={() => void save(extras.filter((x) => x.id !== d.id).map((x) => x.id))} disabled={busy} className="btn btn-sm cursor-pointer">Remove</button>}
    </div>
  );

  return (
    <section className="border border-[var(--color-border)] rounded-[9px] bg-[var(--color-surface)] shadow-[0_1px_2px_rgba(20,20,18,.05)] px-5 py-4 space-y-3">
      <p className="text-[13px] font-[600] text-[var(--color-text)]">Product docs</p>
      {docs === null ? <p className="ff-mono text-[11px] text-[var(--color-text-3)]">Loading…</p> : <div>{docs.map(row)}</div>}
      <div className="flex gap-2 flex-wrap items-center">
        <input value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && link.trim()) void save([...extras.map((x) => x.id), link.trim()]); }}
          placeholder="Google Doc link" spellCheck={false} disabled={busy}
          className="flex-1 min-w-[260px] h-[38px] px-3 rounded-[7px] border border-[var(--color-border)] bg-[var(--color-surface)] text-[12.5px] ff-mono text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]" />
        <button onClick={() => void save([...extras.map((x) => x.id), link.trim()])} disabled={busy || !link.trim()} className="btn btn-sm cursor-pointer">{busy ? "Checking…" : "Add"}</button>
      </div>
      {err && <p className="text-[12px] text-[var(--color-red)]">{err}</p>}
      {account && <p className="text-[11.5px] text-[var(--color-text-3)]">Editor access for <span className="ff-mono text-[var(--color-text-2)] select-all">{account}</span></p>}
    </section>
  );
}
