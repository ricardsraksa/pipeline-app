"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import ModelSettings from "@/components/ModelSettings";

type Stage = "stage1" | "stage2" | "stage3";

const STAGE_LABELS: Record<Stage, string> = {
  stage1: "Stage 1 — Research Brief",
  stage2: "Stage 2 — German Copy",
  stage3: "Stage 3 — Image Prompts",
};

const STAGE_NUMS: Record<Stage, string> = {
  stage1: "01",
  stage2: "02",
  stage3: "03",
};

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
  history: HistoryEntry[];
  historyOpen: boolean;
  restoringIndex: number | null;
  previewIndex: number | null;
}

export default function SettingsPage() {
  const [prompts, setPrompts] = useState<Record<Stage, PromptState> | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh(preserveEdits = false) {
    const data = await fetch("/api/prompts").then((r) => r.json());
    setPrompts((prev) => {
      const state: Record<Stage, PromptState> = {} as Record<Stage, PromptState>;
      for (const stage of ["stage1", "stage2", "stage3"] as Stage[]) {
        const prevS = prev?.[stage];
        state[stage] = {
          current: data[stage],
          default: data.defaults[stage],
          savedAt: data.saved_at?.[stage] ?? null,
          editing: preserveEdits && prevS ? prevS.editing : data[stage],
          saving: false,
          saved: false,
          resetting: false,
          history: (data.history?.[stage] ?? []) as HistoryEntry[],
          historyOpen: prevS?.historyOpen ?? false,
          restoringIndex: null,
          previewIndex: prevS?.previewIndex ?? null,
        };
      }
      return state;
    });
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  function update(stage: Stage, patch: Partial<PromptState>) {
    setPrompts((prev) => {
      if (!prev) return prev;
      return { ...prev, [stage]: { ...prev[stage], ...patch } };
    });
  }

  async function save(stage: Stage) {
    if (!prompts) return;
    update(stage, { saving: true, saved: false });
    try {
      const res = await fetch("/api/prompts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage, prompt: prompts[stage].editing }),
      });
      const data = await res.json();
      if (data.success) {
        update(stage, { saved: true });
        await refresh(true);
      }
    } finally {
      update(stage, { saving: false });
    }
  }

  async function reset(stage: Stage) {
    if (!prompts) return;
    update(stage, { resetting: true });
    try {
      await fetch("/api/prompts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      const defaultText = prompts[stage].default;
      update(stage, { editing: defaultText, saved: false });
      await refresh(true);
    } finally {
      update(stage, { resetting: false });
    }
  }

  async function restore(stage: Stage, index: number) {
    update(stage, { restoringIndex: index });
    try {
      const res = await fetch("/api/prompts/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage, index }),
      });
      const data = await res.json();
      if (data.success) {
        await refresh(false);
      }
    } finally {
      update(stage, { restoringIndex: null });
    }
  }

  function formatDate(iso: string | null): string {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString("de-DE", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      });
    } catch { return iso; }
  }

  if (loading) {
    return (
      <main className="px-7 py-7 max-w-[720px] mx-auto">
        <p className="font-[var(--font-ibm-plex-mono)] text-[11px] text-[var(--color-text-3)]">Loading prompts…</p>
      </main>
    );
  }

  if (!prompts) return null;

  return (
    <main className="px-6 py-8 max-w-[760px] mx-auto" data-screen-label="Settings">
      <Link href="/" className="cursor-pointer inline-flex items-center gap-1 text-[12px] text-[var(--color-text-3)] hover:text-[var(--color-text)] tr mb-4">
        <Icon.ArrowLeft className="w-3.5 h-3.5" /> Home
      </Link>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-[26px] font-bold tracking-tight ff-display text-[var(--color-text)] mb-1">
          Settings
        </h1>
        <p className="text-[13px] text-[var(--color-text-2)]">
          The models and system prompts that drive each stage. Changes take effect on the next pipeline run. Old prompt versions are kept in history — nothing is lost on reset.
        </p>
      </div>

      <ModelSettings />

      <div className="space-y-5">
        {(["stage1", "stage2", "stage3"] as Stage[]).map((stage) => {
          const s = prompts[stage];
          const isModified = s.editing !== s.default;

          return (
            <section
              key={stage}
              className="border border-[var(--color-border)] rounded-[11px] bg-[var(--color-surface)] shadow-[0_1px_2px_rgba(20,20,18,.05)] overflow-hidden"
            >
              {/* Section header */}
              <div className="flex items-center justify-between px-5 py-3 bg-[var(--color-surface-2)] border-b border-[var(--color-border)]">
                <div className="flex items-center gap-2.5">
                  <span className="font-[var(--font-ibm-plex-mono)] text-[9px] text-[var(--color-text-4)] border border-[var(--color-border)] rounded px-1.5 py-0.5">
                    {STAGE_NUMS[stage]}
                  </span>
                  <h3 className="text-[13px] font-[600] text-[var(--color-text-2)]">
                    {STAGE_LABELS[stage]}
                  </h3>
                  {isModified && (
                    <span className="inline-flex items-center gap-1 text-xs font-[620] px-2.5 py-1 rounded-full bg-[var(--color-amber-bg)] text-[var(--color-amber)] whitespace-nowrap">
                      Modified
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {s.savedAt && (
                    <span className="text-[11px] font-[var(--font-ibm-plex-mono)] text-[var(--color-text-4)]">
                      Saved {formatDate(s.savedAt)}
                    </span>
                  )}
                  {s.saved && (
                    <span className="inline-flex items-center gap-1.5 text-xs font-[620] px-2.5 py-1 rounded-full bg-[var(--color-green-bg)] text-[var(--color-green)] whitespace-nowrap">
                      <Icon.Check className="w-3 h-3" />
                      Saved
                    </span>
                  )}
                </div>
              </div>

              {/* Textarea */}
              <div className="px-5 py-4">
                <textarea
                  value={s.editing}
                  onChange={(e) => update(stage, { editing: e.target.value, saved: false })}
                  rows={18}
                  className="w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-lg px-[13px] py-[11px] text-[12px] font-[var(--font-ibm-plex-mono)] transition-all focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)] resize-y leading-relaxed"
                />
              </div>

              {/* Footer actions */}
              <div className="flex items-center gap-3 px-5 pb-4">
                <button
                  onClick={() => save(stage)}
                  disabled={s.saving || s.editing === s.current}
                  className="cursor-pointer inline-flex items-center gap-[7px] rounded-lg px-[15px] py-[9px] text-[13.5px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] border border-transparent transition-all hover:brightness-105 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {s.saving ? (
                    <><Icon.Loader className="w-3.5 h-3.5" />Saving…</>
                  ) : (
                    <><Icon.Check className="w-3.5 h-3.5" />Save</>
                  )}
                </button>

                {isModified && (
                  <button
                    onClick={() => reset(stage)}
                    disabled={s.resetting}
                    className="cursor-pointer inline-flex items-center gap-[7px] rounded-lg px-[15px] py-[9px] text-[13.5px] font-[620] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] transition-all hover:border-[var(--color-text-3)] hover:bg-[var(--color-surface-2)] whitespace-nowrap disabled:opacity-40"
                  >
                    {s.resetting ? "Resetting…" : "Reset to default"}
                  </button>
                )}

                {s.history.length > 0 && (
                  <button
                    onClick={() => update(stage, { historyOpen: !s.historyOpen })}
                    className="cursor-pointer ml-auto inline-flex items-center gap-[6px] rounded-lg px-[12px] py-[8px] text-[12px] font-[600] text-[var(--color-text-2)] border border-transparent transition-all hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] whitespace-nowrap"
                    aria-expanded={s.historyOpen}
                  >
                    {s.historyOpen ? "▼" : "▶"} History ({s.history.length})
                  </button>
                )}
              </div>

              {/* History list */}
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
                                  · {h.prompt.length.toLocaleString()} chars
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
                                className="cursor-pointer inline-flex items-center gap-[5px] rounded-md px-[10px] py-[6px] text-[11.5px] font-[620] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] transition-all hover:border-[var(--color-text-3)] disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
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
            </section>
          );
        })}
      </div>
    </main>
  );
}
