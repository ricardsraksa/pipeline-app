"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import ModelSettings, { type SettingsHandle } from "@/components/ModelSettings";
import PricingSettings from "@/components/PricingSettings";
import ShopifySettings from "@/components/ShopifySettings";

// Internal keys are one behind the displayed numbers (the product stage was
// added in front): product = Stage 1, stage1 = Stage 2, and so on.
type Stage = "product" | "stage1" | "angles" | "stage2" | "stage3" | "ads";

const STAGE_ORDER: Stage[] = ["product", "stage1", "angles", "stage2", "stage3", "ads"];

// Same "Stage N · Name" convention as lib/models.ts.
const STAGE_LABELS: Record<Stage, string> = {
  product: "Stage 1 · Product",
  stage1: "Stage 2 · Research",
  angles: "Stage 2 · Angles",
  stage2: "Stage 3 · Copy",
  stage3: "Stage 4 · Images",
  ads: "Stage 5 · Image ads",
};

type Tab = "prompts" | "models" | "pricing" | "shopify";
const TABS: Array<{ key: Tab; label: string }> = [
  { key: "prompts", label: "Prompts" },
  { key: "models", label: "Models" },
  { key: "pricing", label: "Pricing" },
  { key: "shopify", label: "Shopify" },
];
const TAB_KEY = "settings.tab";

interface HistoryEntry {
  prompt: string;
  saved_at: string;
}

interface PromptState {
  current: string;
  default: string;
  savedAt: string | null;
  editing: string;
  saving: boolean;
  saved: boolean;
  resetting: boolean;
  error: string | null;
  open: boolean;
  history: HistoryEntry[];
  historyOpen: boolean;
  restoringIndex: number | null;
  previewIndex: number | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

const errOf = async (res: Response, fallback: string) => {
  const data = await res.json().catch(() => ({}));
  return res.ok && data.success ? null : ((data as { error?: string }).error ?? fallback);
};

export default function SettingsPage() {
  const [prompts, setPrompts] = useState<Record<Stage, PromptState> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(false);
  const [tab, setTab] = useState<Tab>("prompts");
  const [modelDirty, setModelDirty] = useState(0);
  const [pricingDirty, setPricingDirty] = useState(0);
  const [savingAll, setSavingAll] = useState(false);
  const modelsRef = useRef<SettingsHandle>(null);
  const pricingRef = useRef<SettingsHandle>(null);

  useEffect(() => {
    try { const v = localStorage.getItem(TAB_KEY) as Tab | null; if (v && TABS.some((t) => t.key === v)) setTab(v); } catch { /* no storage */ }
  }, []);
  const changeTab = (t: Tab) => { setTab(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* no storage */ } };

  // preserveEdits keeps unsaved text on screen; reloadStage takes the server
  // text for that one prompt.
  const refresh = useCallback(async (preserveEdits = false, reloadStage?: Stage) => {
    const res = await fetch("/api/prompts");
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    setPrompts((prev) => {
      const state: Record<Stage, PromptState> = {} as Record<Stage, PromptState>;
      for (const stage of STAGE_ORDER) {
        const prevS = prev?.[stage];
        state[stage] = {
          current: data[stage],
          default: data.defaults[stage],
          savedAt: data.saved_at?.[stage] ?? null,
          editing: preserveEdits && prevS && stage !== reloadStage ? prevS.editing : data[stage],
          saving: false,
          saved: prevS?.saved ?? false,
          resetting: false,
          error: null,
          open: prevS?.open ?? false,
          history: (data.history?.[stage] ?? []) as HistoryEntry[],
          historyOpen: prevS?.historyOpen ?? false,
          restoringIndex: null,
          previewIndex: prevS?.previewIndex ?? null,
        };
      }
      return state;
    });
  }, []);

  const load = useCallback(() => {
    setLoading(true); setLoadErr(false);
    refresh().catch(() => setLoadErr(true)).finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => { load(); }, [load]);

  function update(stage: Stage, patch: Partial<PromptState>) {
    setPrompts((prev) => {
      if (!prev) return prev;
      return { ...prev, [stage]: { ...prev[stage], ...patch } };
    });
  }

  async function save(stage: Stage, text: string): Promise<boolean> {
    update(stage, { saving: true, saved: false, error: null });
    try {
      const res = await fetch("/api/prompts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage, prompt: text }),
      });
      const error = await errOf(res, "Save failed.");
      if (error) { update(stage, { saving: false, error }); return false; }
      update(stage, { saved: true });
      setTimeout(() => update(stage, { saved: false }), 2000);
      await refresh(true).catch(() => undefined);
      update(stage, { saving: false });
      return true;
    } catch {
      update(stage, { saving: false, error: "Save failed." });
      return false;
    }
  }

  async function reset(stage: Stage) {
    if (!window.confirm("Replaces your saved prompt with the default. Reset?")) return;
    update(stage, { resetting: true, error: null });
    try {
      const res = await fetch("/api/prompts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      const error = await errOf(res, "Reset failed.");
      if (error) { update(stage, { resetting: false, error }); return; }
      await refresh(true, stage);
    } catch {
      update(stage, { resetting: false, error: "Reset failed." });
    }
  }

  async function restore(stage: Stage, index: number) {
    update(stage, { restoringIndex: index, error: null });
    try {
      const res = await fetch("/api/prompts/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage, index }),
      });
      const error = await errOf(res, "Restore failed.");
      if (error) { update(stage, { restoringIndex: null, error }); return; }
      // Only the restored prompt takes the server text; unsaved edits in the
      // other prompts stay on screen.
      await refresh(true, stage);
    } catch {
      update(stage, { restoringIndex: null, error: "Restore failed." });
    }
  }

  const dirtyStages = prompts ? STAGE_ORDER.filter((s) => prompts[s].editing !== prompts[s].current) : [];
  const unsaved = dirtyStages.length + modelDirty + pricingDirty;
  const tabDirty: Record<Tab, boolean> = { prompts: dirtyStages.length > 0, models: modelDirty > 0, pricing: pricingDirty > 0, shopify: false };

  useEffect(() => {
    if (!unsaved) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [unsaved]);

  async function saveAll() {
    if (!prompts) return;
    setSavingAll(true);
    try {
      // One at a time: every prompt save rewrites the same stored file.
      for (const s of dirtyStages) await save(s, prompts[s].editing);
      if (modelDirty) await modelsRef.current?.save();
      if (pricingDirty) await pricingRef.current?.save();
    } finally {
      setSavingAll(false);
    }
  }

  function discardAll() {
    if (!window.confirm(`Discard ${unsaved} unsaved ${unsaved === 1 ? "change" : "changes"}?`)) return;
    setPrompts((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      for (const s of STAGE_ORDER) next[s] = { ...prev[s], editing: prev[s].current, error: null };
      return next;
    });
    modelsRef.current?.discard();
    pricingRef.current?.discard();
  }

  return (
    <main className="px-6 py-8 max-w-[760px] mx-auto" data-screen-label="Settings">
      <h1 className="text-[19px] font-[600] tracking-[-0.02em] text-[var(--color-text)] mb-4">
        Settings
      </h1>

      <div role="tablist" className="flex items-center gap-[2px] border-b border-[var(--color-border)] mb-5">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => changeTab(t.key)}
            className={`relative cursor-pointer inline-flex items-center gap-1.5 px-3 h-9 text-[13px] tr ${tab === t.key ? "text-[var(--color-text)]" : "text-[var(--color-text-2)] hover:text-[var(--color-text)]"}`}>
            {t.label}
            {tabDirty[t.key] && <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-amber)]" aria-label="Unsaved" />}
            {tab === t.key && <span className="absolute left-2 right-2 -bottom-px h-[2px] rounded-[2px] bg-[var(--color-accent)]" />}
          </button>
        ))}
      </div>

      <div hidden={tab !== "models"}>
        <ModelSettings ref={modelsRef} onDirtyChange={setModelDirty} />
      </div>
      <div hidden={tab !== "pricing"}>
        <PricingSettings ref={pricingRef} onDirtyChange={setPricingDirty} />
      </div>
      <div hidden={tab !== "shopify"}>
        <ShopifySettings />
      </div>

      <div hidden={tab !== "prompts"}>
        {loading ? (
          <p className="font-[var(--font-ibm-plex-mono)] text-[11px] text-[var(--color-text-3)]">Loading…</p>
        ) : loadErr || !prompts ? (
          <div className="flex items-center gap-3">
            <p className="text-[12.5px] text-[var(--color-red)]">Couldn&apos;t load.</p>
            <button onClick={load} className="btn btn-sm">Retry</button>
          </div>
        ) : (
          <div className="space-y-3">
            {STAGE_ORDER.map((stage) => {
              const s = prompts[stage];
              // Edited = the SAVED prompt differs from the default; typing alone doesn't count.
              const isEdited = s.current !== s.default;
              const isDirty = s.editing !== s.current;

              return (
                <section
                  key={stage}
                  className="border border-[var(--color-border)] rounded-[9px] bg-[var(--color-surface)] overflow-hidden"
                >
                  <button
                    onClick={() => update(stage, { open: !s.open })}
                    aria-expanded={s.open}
                    className={`cursor-pointer w-full flex items-center justify-between gap-3 px-5 py-3 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] tr text-left ${s.open ? "border-b border-[var(--color-border)]" : ""}`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {s.open ? <Icon.ChevronDown className="w-3.5 h-3.5 text-[var(--color-text-3)]" /> : <Icon.ChevronRight className="w-3.5 h-3.5 text-[var(--color-text-3)]" />}
                      <h3 className="text-[13px] font-[600] text-[var(--color-text)]">
                        {STAGE_LABELS[stage]}
                      </h3>
                      {isEdited && (
                        <span className="text-[11px] font-[620] px-2 py-0.5 rounded-full bg-[var(--color-amber-bg)] text-[var(--color-amber)] whitespace-nowrap">
                          Edited
                        </span>
                      )}
                      {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-amber)]" aria-label="Unsaved" title="Unsaved" />}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {s.saved && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-[620] text-[var(--color-green)]">
                          <Icon.Check className="w-3 h-3" /> Saved
                        </span>
                      )}
                      {s.savedAt && (
                        <span className="text-[11px] font-[var(--font-ibm-plex-mono)] text-[var(--color-text-4)]">
                          {formatDate(s.savedAt)}
                        </span>
                      )}
                    </div>
                  </button>

                  {s.open && (
                    <>
                      <div className="px-5 py-4">
                        <textarea
                          value={s.editing}
                          onChange={(e) => update(stage, { editing: e.target.value, saved: false })}
                          rows={18}
                          aria-label={STAGE_LABELS[stage]}
                          className="w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-lg px-[13px] py-[11px] text-[12px] font-[var(--font-ibm-plex-mono)] transition-all focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)] resize-y leading-relaxed"
                        />
                      </div>

                      <div className="flex items-center gap-2 px-5 pb-4">
                        <button
                          onClick={() => save(stage, s.editing)}
                          disabled={s.saving || !isDirty}
                          className="btn btn-primary"
                        >
                          {s.saving ? (<><Icon.Loader className="w-3.5 h-3.5" />Saving…</>) : "Save"}
                        </button>

                        {isDirty && !s.saving && (
                          <button onClick={() => update(stage, { editing: s.current, error: null })} className="btn">
                            Discard
                          </button>
                        )}

                        {isEdited && (
                          <button onClick={() => reset(stage)} disabled={s.resetting} className="btn">
                            {s.resetting ? "Resetting…" : "Reset to default"}
                          </button>
                        )}

                        {s.history.length > 0 && (
                          <button
                            onClick={() => update(stage, { historyOpen: !s.historyOpen })}
                            className="cursor-pointer ml-auto inline-flex items-center gap-[6px] rounded-lg px-[12px] py-[8px] text-[12px] font-[600] text-[var(--color-text-2)] border border-transparent transition-all hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] whitespace-nowrap"
                            aria-expanded={s.historyOpen}
                          >
                            {s.historyOpen ? <Icon.ChevronDown className="w-3 h-3" /> : <Icon.ChevronRight className="w-3 h-3" />} History ({s.history.length})
                          </button>
                        )}
                      </div>
                      {s.error && <p className="px-5 pb-4 -mt-2 text-[11.5px] text-[var(--color-red)]">{s.error}</p>}

                      {s.historyOpen && s.history.length > 0 && (
                        <div className="border-t border-[var(--color-border)] bg-[var(--color-surface-2)]">
                          <ul className="divide-y divide-[var(--color-border)]">
                            {s.history.map((h, i) => {
                              const expanded = s.previewIndex === i;
                              const preview = h.prompt.replace(/\s+/g, " ").slice(0, 120);
                              return (
                                <li key={`${h.saved_at}-${i}`} className="px-5 py-3">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 mb-1">
                                        <span className="font-[var(--font-ibm-plex-mono)] text-[10px] text-[var(--color-text-4)]">
                                          {formatDate(h.saved_at)}
                                        </span>
                                        <span className="font-[var(--font-ibm-plex-mono)] text-[10px] text-[var(--color-text-4)]">
                                          · {h.prompt.length.toLocaleString("en-GB")} chars
                                        </span>
                                      </div>
                                      {expanded ? (
                                        <pre className="whitespace-pre-wrap text-[11px] font-[var(--font-ibm-plex-mono)] text-[var(--color-text-2)] max-h-[280px] overflow-y-auto bg-[var(--color-surface)] border border-[var(--color-border)] rounded p-3">
                                          {h.prompt}
                                        </pre>
                                      ) : (
                                        <p className="text-[12px] text-[var(--color-text-3)] truncate">
                                          {preview}{h.prompt.length > 120 ? "…" : ""}
                                        </p>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      <button
                                        onClick={() => update(stage, { previewIndex: expanded ? null : i })}
                                        className="cursor-pointer text-[11px] font-[600] text-[var(--color-text-3)] hover:text-[var(--color-text)] transition-colors px-2 py-1"
                                      >
                                        {expanded ? "Hide" : "View"}
                                      </button>
                                      <button
                                        onClick={() => restore(stage, i)}
                                        disabled={s.restoringIndex !== null}
                                        className="btn btn-sm"
                                      >
                                        {s.restoringIndex === i ? "Restoring…" : "Restore"}
                                      </button>
                                    </div>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}
                    </>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>

      {unsaved > 0 && (
        <div className="sticky bottom-4 mt-6 flex items-center gap-3 px-4 py-2.5 rounded-[9px] border border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-[var(--shadow-pop)]">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-amber)]" />
          <span className="text-[12.5px] text-[var(--color-text)]">{unsaved} unsaved</span>
          <div className="flex-1" />
          <button onClick={discardAll} disabled={savingAll} className="btn">Discard</button>
          <button onClick={saveAll} disabled={savingAll} className="btn btn-primary">
            {savingAll ? (<><Icon.Loader className="w-3.5 h-3.5" />Saving…</>) : "Save all"}
          </button>
        </div>
      )}
    </main>
  );
}
