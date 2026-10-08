"use client";

// One product waiting to start: its number, name and links, an edit mode
// (name, links, priority), and the AliExpress box + Start.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toasts";
import { cx, docStatus, inputCls, isInstagram, CheckIcon, type ImportItem } from "./shared";

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const looksLikeUrl = (s: string) => { try { const u = new URL(s); return u.protocol === "https:" || u.protocol === "http:"; } catch { return false; } };

export default function StartRow({ item, first, docConfigured, onChanged }: { item: ImportItem; first: boolean; docConfigured: boolean; onChanged: () => void }) {
  const router = useRouter();
  const { push } = useToast();
  const [ali, setAli] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: item.name, links: item.urls.join("\n"), priority: item.priority });
  const st = docStatus(item, docConfigured);

  async function start() {
    if (!looksLikeUrl(ali.trim()) || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/import/${item.id}/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productUrl: ali.trim() }) });
      const d = (await res.json().catch(() => ({}))) as { success?: boolean; runId?: number; code?: string; error?: string };
      if (!res.ok || !d.success || !d.runId) { push(d.error ?? `Not started (${res.status})`); return; }
      push(`${d.code} started`, "success");
      router.push(`/runs/${d.runId}`);
    } catch {
      push("Not started: no connection");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/import/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const d = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!res.ok || !d.success) { push(d.error ?? "Not saved"); return; }
      setEditing(false);
      onChanged();
    } catch {
      push("Not saved: no connection");
    } finally {
      setBusy(false);
    }
  }

  async function togglePriority() {
    setBusy(true);
    try {
      const res = await fetch(`/api/import/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ priority: !item.priority }) });
      if (!res.ok) push("Priority not changed");
      onChanged();
    } catch {
      push("Priority not changed: no connection");
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="px-[13px] py-[11px] flex flex-col gap-2 bg-[var(--color-surface-2)]">
        <div className="grid gap-3" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.6fr) auto" }}>
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Product name" className={cx(inputCls, "h-[36px]")} />
          <textarea value={draft.links} onChange={(e) => setDraft({ ...draft, links: e.target.value })} rows={Math.min(5, Math.max(2, draft.links.split("\n").length + 1))}
            spellCheck={false} aria-label="Links" className={cx(inputCls, "py-[8px] ff-mono text-[12px] resize-y")} />
          <label className="h-[36px] flex items-center gap-1.5 cursor-pointer text-[12.5px] text-[var(--color-text-2)]">
            <input type="checkbox" checked={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.checked })} className="w-4 h-4 cursor-pointer accent-[var(--color-priority)]" />
            Priority
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={() => { setEditing(false); setDraft({ name: item.name, links: item.urls.join("\n"), priority: item.priority }); }}
            className="cursor-pointer h-8 px-3 rounded-[6px] text-[12.5px] text-[var(--color-text-2)] hover:bg-[var(--color-surface-3)] tr">Cancel</button>
          <button onClick={save} disabled={busy}
            className="cursor-pointer h-8 px-3 rounded-[6px] bg-[var(--color-primary)] text-[var(--color-on-primary)] text-[12.5px] font-[500] hover:opacity-90 disabled:opacity-50 tr">{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    );
  }

  const aliBad = ali.trim() !== "" && !looksLikeUrl(ali.trim());
  return (
    <div className={cx("px-[13px] py-[10px] grid items-center gap-3", first && "bg-[color-mix(in_srgb,var(--color-accent)_5%,transparent)]")}
      style={{ gridTemplateColumns: "52px 32px minmax(0,1fr) minmax(220px,300px) 76px 32px" }}>
      <span className="ff-mono text-[12.5px] text-[var(--color-text)]">{item.productCode}</span>
      <button onClick={togglePriority} disabled={busy} title={item.priority ? "Remove priority" : "Make priority"} aria-label={item.priority ? "Remove priority" : "Make priority"}
        className={cx("cursor-pointer w-8 h-8 grid place-items-center rounded-[6px] hover:bg-[var(--color-surface-2)] tr",
          item.priority ? "text-[var(--color-priority)] bg-[var(--color-priority-bg)]" : "text-[var(--color-text-3)] opacity-50 hover:opacity-100")}>
        <CheckIcon />
      </button>
      <div className="min-w-0">
        <div className="text-[13.5px] font-[500] text-[var(--color-text)] truncate flex items-center gap-1.5">
          {item.name}
        </div>
        <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11.5px]">
          {item.urls.map((u) => (
            <a key={u} href={u} target="_blank" rel="noreferrer" title={u} className="cursor-pointer text-[var(--color-text-2)] hover:text-[var(--color-accent)] hover:underline truncate max-w-[200px]">
              {isInstagram(u) ? "reel" : hostOf(u)}
            </a>
          ))}
          <span className={cx(st.tone === "bad" ? "text-[var(--color-red)]" : "text-[var(--color-text-3)]", "truncate max-w-[220px]")} title={st.text}>· {st.text}</span>
        </div>
      </div>
      <input value={ali} onChange={(e) => setAli(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void start(); }}
        placeholder="AliExpress link" spellCheck={false} aria-label={`AliExpress link for ${item.name}`} disabled={busy}
        className={cx(inputCls, "h-[36px] ff-mono text-[12px]", aliBad && "border-[var(--color-red)]")} />
      <button onClick={start} disabled={busy || !looksLikeUrl(ali.trim())}
        className="cursor-pointer h-9 rounded-[6px] bg-[var(--color-primary)] text-[var(--color-on-primary)] text-[13px] font-[500] hover:opacity-90 disabled:opacity-35 disabled:cursor-not-allowed tr">
        {busy ? "…" : "Start"}
      </button>
      <button onClick={() => { setDraft({ name: item.name, links: item.urls.join("\n"), priority: item.priority }); setEditing(true); }} title="Edit" aria-label={`Edit ${item.name}`}
        className="cursor-pointer w-8 h-8 grid place-items-center rounded-[6px] text-[var(--color-text-3)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] tr">
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
      </button>
    </div>
  );
}
