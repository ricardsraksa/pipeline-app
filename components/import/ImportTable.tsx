"use client";

// The Import table: name · links · priority, one product per row. A new
// empty row appears as soon as the last one has text; Enter moves on
// (name → links → next row's name). Import all sends every filled row.

import { useRef, useState } from "react";
import { useToast } from "@/components/Toasts";
import { emptyRow, withTrailingEmpty, type DraftRow } from "@/lib/import/rows";
import { validateRows } from "@/lib/import/validate";
import { cx, inputCls, SplashIcon } from "./shared";

export default function ImportTable({ onImported }: { onImported: () => void }) {
  const { push } = useToast();
  const [rows, setRows] = useState<DraftRow[]>(() => [emptyRow()]);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<number, string>>({});
  const refs = useRef(new Map<string, HTMLInputElement | HTMLTextAreaElement>());
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const set = (key: string, patch: Partial<DraftRow>) => {
    setServerErrors({});
    setRows((rs) => withTrailingEmpty(rs.map((r) => (r.key === key ? { ...r, ...patch } : r))));
  };
  // Focus moves right away (no animation frame: those stall in a background
  // tab). The next row is looked up in the latest rows — the keystroke
  // before may only just have added it.
  const focusLinks = (key: string) => refs.current.get(`${key}:links`)?.focus();
  const focusNextName = (key: string) => {
    const list = rowsRef.current;
    const next = list[list.findIndex((r) => r.key === key) + 1];
    if (next) refs.current.get(`${next.key}:name`)?.focus();
  };

  // Live check, same rules the server applies.
  const { items, errors } = validateRows(rows);
  // Shown once Import was pressed, so a half-typed row isn't flagged mid-typing.
  const errorAt = new Map(tried ? errors.map((e) => [e.index, e.message]) : []);
  for (const [i, m] of Object.entries(serverErrors)) errorAt.set(Number(i), m);
  const filled = items.length;
  const canImport = (filled > 0 || errors.length > 0) && !busy;

  async function importAll() {
    if (!canImport) return;
    if (errors.length) { setTried(true); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: rows.map(({ name, links, priority }) => ({ name, links, priority })) }),
      });
      const d = (await res.json().catch(() => ({}))) as { success?: boolean; added?: number; error?: string; errors?: Array<{ index: number; message: string }> };
      if (!res.ok || !d.success) {
        if (d.errors) setServerErrors(Object.fromEntries(d.errors.map((e) => [e.index, e.message])));
        push(d.error ?? "Not imported — fix the marked rows");
        return;
      }
      push(`Imported ${d.added} product${d.added === 1 ? "" : "s"}`, "success");
      setRows([emptyRow()]);
      setTried(false);
      onImported();
    } catch {
      push("Not imported: no connection");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-[var(--color-border)] rounded-[9px] bg-[var(--color-surface)] overflow-hidden">
      <div className="grid gap-3 px-[13px] py-[8px] border-b border-[var(--color-border)] eyebrow"
        style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.6fr) 72px" }}>
        <span>Product name</span><span>Links</span><span className="text-center">Priority</span>
      </div>
      {rows.map((r, i) => {
        const err = errorAt.get(i);
        return (
          <div key={r.key} className={cx("px-[13px] py-[8px]", i > 0 && "border-t border-[var(--color-border)]")}>
            <div className="grid gap-3 items-start" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.6fr) 72px" }}>
              <input
                ref={(el) => { if (el) refs.current.set(`${r.key}:name`, el); else refs.current.delete(`${r.key}:name`); }}
                value={r.name} onChange={(e) => set(r.key, { name: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); focusLinks(r.key); } }}
                aria-label={`Product name, row ${i + 1}`} disabled={busy}
                className={cx(inputCls, "h-[36px]", err && /name/i.test(err) && "border-[var(--color-red)]")} />
              <textarea
                ref={(el) => { if (el) refs.current.set(`${r.key}:links`, el); else refs.current.delete(`${r.key}:links`); }}
                value={r.links} onChange={(e) => set(r.key, { links: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); focusNextName(r.key); } }}
                rows={Math.min(4, Math.max(1, r.links.split("\n").length))} spellCheck={false} disabled={busy}
                aria-label={`Links, row ${i + 1}`}
                className={cx(inputCls, "py-[8px] min-h-[36px] ff-mono text-[12px] resize-none", err && !/name/i.test(err) && "border-[var(--color-red)]")} />
              <label className="h-[36px] grid place-items-center cursor-pointer rounded-[6px] hover:bg-[var(--color-surface-2)] tr" title="Priority">
                <input type="checkbox" checked={r.priority} onChange={(e) => set(r.key, { priority: e.target.checked })} disabled={busy}
                  className="sr-only peer" aria-label={`Priority, row ${i + 1}`} />
                <span className={cx("w-[30px] h-[30px] grid place-items-center rounded-[6px] border tr peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--color-accent)]",
                  r.priority ? "border-[var(--color-water)] text-[var(--color-water)] bg-[var(--color-water-bg)]" : "border-[var(--color-border-strong)] text-[var(--color-text-3)] hover:text-[var(--color-text-2)]")}>
                  <SplashIcon />
                </span>
              </label>
            </div>
            {err && <div className="text-[11.5px] text-[var(--color-red)] mt-1">{err}</div>}
          </div>
        );
      })}
      <div className="flex items-center justify-end gap-3 px-[13px] py-[10px] border-t border-[var(--color-border)] bg-[var(--color-surface-2)]">
        <button onClick={importAll} disabled={!canImport}
          className="cursor-pointer h-9 px-[14px] rounded-[6px] bg-[var(--color-primary)] text-[var(--color-on-primary)] text-[13px] font-[500] hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed tr">
          {busy ? "Importing…" : filled > 1 ? `Import all (${filled})` : "Import"}
        </button>
      </div>
    </div>
  );
}
