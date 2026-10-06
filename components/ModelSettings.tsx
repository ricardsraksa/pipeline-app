"use client";

import { useCallback, useEffect, useImperativeHandle, useState } from "react";
import { Icon } from "@/components/ui/Icon";

interface ModelOption { id: string; label: string; hint: string; }
interface RoleSelection {
  role: string;
  label: string;
  description: string;
  default: string;
  selected: string;
  isDefault: boolean;
}

// Lets the Settings page drive Save all / Discard across its tabs.
export interface SettingsHandle {
  save: () => Promise<boolean>;
  discard: () => void;
}

// Per-role model picker. Reads /api/settings/models, lets the operator choose a
// model for each logical role, and saves all selections at once. Takes effect
// on the next run — no redeploy.
export default function ModelSettings({ ref, onDirtyChange }: { ref?: React.Ref<SettingsHandle>; onDirtyChange?: (n: number) => void }) {
  const [catalog, setCatalog] = useState<ModelOption[]>([]);
  const [rows, setRows] = useState<RoleSelection[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function applyData(data: { catalog?: ModelOption[]; selections?: RoleSelection[] }) {
    if (data.catalog) setCatalog(data.catalog);
    const sels = data.selections ?? [];
    setRows(sels);
    const d: Record<string, string> = {};
    for (const r of sels) d[r.role] = r.selected;
    setDraft(d);
  }

  const load = useCallback(() => {
    setLoading(true); setLoadErr(false);
    fetch("/api/settings/models")
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(applyData)
      .catch(() => setLoadErr(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const dirtyCount = rows.filter((r) => draft[r.role] !== r.selected).length;
  const dirty = dirtyCount > 0;
  useEffect(() => { onDirtyChange?.(dirtyCount); }, [dirtyCount, onDirtyChange]);
  const labelFor = (id: string) => catalog.find((m) => m.id === id)?.label ?? id;

  async function save(): Promise<boolean> {
    setSaving(true); setSaved(false); setErr(null);
    try {
      const res = await fetch("/api/settings/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selections: draft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) { setErr(data.error ?? "Save failed."); return false; }
      applyData(data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      return true;
    } catch {
      setErr("Save failed.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    const d: Record<string, string> = {};
    for (const r of rows) d[r.role] = r.selected;
    setDraft(d);
    setErr(null);
  }

  useImperativeHandle(ref, () => ({ save: () => (dirty ? save() : Promise.resolve(true)), discard }));

  return (
    <section className="border border-[var(--color-border)] rounded-[9px] bg-[var(--color-surface)] shadow-[0_1px_2px_rgba(20,20,18,.05)] overflow-hidden">
      <div className="px-5 py-4">

        {loading ? (
          <p className="font-[var(--font-ibm-plex-mono)] text-[11px] text-[var(--color-text-3)]">Loading…</p>
        ) : loadErr ? (
          <div className="flex items-center gap-3">
            <p className="text-[12.5px] text-[var(--color-red)]">Couldn&apos;t load.</p>
            <button onClick={load} className="btn btn-sm">Retry</button>
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-border)]">
            {rows.map((r) => {
              const changed = draft[r.role] !== r.selected;
              return (
                <div key={r.role} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-[600] text-[var(--color-text)]">{r.label}</p>
                      {draft[r.role] === r.default ? (
                        <span className="font-[var(--font-ibm-plex-mono)] text-[9px] uppercase tracking-wider text-[var(--color-text-4)] border border-[var(--color-border)] rounded px-1.5 py-0.5">default</span>
                      ) : (
                        <span className="font-[var(--font-ibm-plex-mono)] text-[9px] uppercase tracking-wider text-[var(--color-amber)] bg-[var(--color-amber-bg)] rounded px-1.5 py-0.5">custom</span>
                      )}
                    </div>
                    <p className="text-[10.5px] text-[var(--color-text-4)] mt-0.5 font-[var(--font-ibm-plex-mono)]">Default: {labelFor(r.default)}</p>
                  </div>
                  <select
                    value={draft[r.role] ?? r.selected}
                    onChange={(e) => setDraft((d) => ({ ...d, [r.role]: e.target.value }))}
                    aria-label={r.label}
                    className={`shrink-0 cursor-pointer rounded-lg border bg-[var(--color-surface)] text-[var(--color-text)] text-[12.5px] font-[560] px-3 py-2 pr-7 transition-all focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)] ${changed ? "border-[var(--color-accent)]" : "border-[var(--color-border-strong)]"}`}
                  >
                    {catalog.map((m) => (
                      <option key={m.id} value={m.id}>{m.label} — {m.hint}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        )}

        {err && <p className="text-[11.5px] text-[var(--color-red)] mt-3">{err}</p>}

        {!loading && !loadErr && (
          <div className="flex items-center gap-3 mt-4">
            <button onClick={save} disabled={saving || !dirty} className="btn btn-primary">
              {saving ? (<><Icon.Loader className="w-3.5 h-3.5" />Saving…</>) : "Save"}
            </button>
            {dirty && !saving && <button onClick={discard} className="btn">Discard</button>}
            {saved && (
              <span className="inline-flex items-center gap-1.5 text-xs font-[620] text-[var(--color-green)]">
                <Icon.Check className="w-3 h-3" /> Saved
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
