"use client";

// One-off "Bring in from the doc": tabs in the master doc that have no run
// yet become Import items that keep their tab. Tabs whose "Alibaba link:" is
// already filled (products done by hand) start unticked.

import { useState } from "react";
import { useToast } from "@/components/Toasts";
import { cx, PriorityBadge } from "./shared";

type Tab = { tabId: string; title: string; name: string; links: string[]; priority: boolean; suggested: boolean };

export default function DocImport({ onImported }: { onImported: () => void }) {
  const { push } = useToast();
  const [tabs, setTabs] = useState<Tab[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/import/from-doc", { cache: "no-store" });
      const d = (await res.json().catch(() => ({}))) as { success?: boolean; tabs?: Tab[]; error?: string };
      if (!res.ok || !d.success) { setError(d.error ?? `Couldn't read the doc (${res.status})`); return; }
      setTabs(d.tabs ?? []);
      setPicked(new Set((d.tabs ?? []).filter((t) => t.suggested).map((t) => t.tabId)));
    } catch {
      setError("Couldn't read the doc: no connection");
    } finally {
      setBusy(false);
    }
  }

  async function bringIn() {
    setBusy(true);
    try {
      const res = await fetch("/api/import/from-doc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tabIds: [...picked] }) });
      const d = (await res.json().catch(() => ({}))) as { success?: boolean; added?: number; error?: string };
      if (!res.ok || !d.success) { push(d.error ?? "Not brought in"); return; }
      push(`Brought in ${d.added} from the doc`, "success");
      setTabs(null);
      onImported();
    } catch {
      push("Not brought in: no connection");
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  if (!tabs) {
    return (
      <div className="flex items-center gap-3">
        <button onClick={load} disabled={busy}
          className="cursor-pointer h-9 px-[13px] rounded-[6px] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[13px] text-[var(--color-text)] hover:bg-[var(--color-surface-2)] disabled:opacity-50 tr">
          {busy ? "Reading the doc…" : "Bring in from the doc"}
        </button>
        {error && <span className="text-[12px] text-[var(--color-red)]">{error}</span>}
      </div>
    );
  }

  return (
    <div className="border border-[var(--color-border)] rounded-[9px] bg-[var(--color-surface)] overflow-hidden">
      <div className="flex items-center justify-between px-[13px] py-[9px] border-b border-[var(--color-border)]">
        <span className="text-[13px] font-[500] text-[var(--color-text)]">Doc tabs with no run yet · {tabs.length}</span>
        <button onClick={() => setTabs(null)} className="cursor-pointer text-[12.5px] text-[var(--color-text-2)] hover:text-[var(--color-text)] px-2 h-8 rounded-[6px] tr">Cancel</button>
      </div>
      {tabs.length === 0 && <div className="px-[13px] py-[14px] text-[13px] text-[var(--color-text-2)]">Nothing to bring in.</div>}
      {tabs.map((t, i) => (
        <label key={t.tabId} className={cx("flex items-start gap-3 px-[13px] py-[9px] cursor-pointer hover:bg-[var(--color-surface-2)] tr", i > 0 && "border-t border-[var(--color-border)]")}>
          <input type="checkbox" checked={picked.has(t.tabId)} onChange={() => toggle(t.tabId)} className="mt-[3px] w-4 h-4 cursor-pointer accent-[var(--color-accent)]" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[13px] text-[var(--color-text)]">
              {t.priority && <PriorityBadge />}<span className="truncate">{t.title}</span>
            </div>
            <div className="text-[11.5px] ff-mono text-[var(--color-text-3)] truncate">{t.links.join("  ") || "no link on the tab"}</div>
          </div>
          {!t.suggested && <span className="text-[11px] text-[var(--color-text-3)] shrink-0 mt-[2px]">already sourced</span>}
        </label>
      ))}
      {tabs.length > 0 && (
        <div className="flex justify-end px-[13px] py-[10px] border-t border-[var(--color-border)] bg-[var(--color-surface-2)]">
          <button onClick={bringIn} disabled={busy || picked.size === 0}
            className="cursor-pointer h-9 px-[14px] rounded-[6px] bg-[var(--color-primary)] text-[var(--color-on-primary)] text-[13px] font-[500] hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed tr">
            {busy ? "Bringing in…" : `Bring in ${picked.size}`}
          </button>
        </div>
      )}
    </div>
  );
}
