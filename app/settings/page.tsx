"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";

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

interface PromptState {
  current: string;
  default: string;
  savedAt: string | null;
  editing: string;
  saving: boolean;
  saved: boolean;
  resetting: boolean;
}

export default function SettingsPage() {
  const [prompts, setPrompts] = useState<Record<Stage, PromptState> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/prompts")
      .then((r) => r.json())
      .then((data) => {
        const state: Record<Stage, PromptState> = {} as Record<Stage, PromptState>;
        for (const stage of ["stage1", "stage2", "stage3"] as Stage[]) {
          state[stage] = {
            current: data[stage],
            default: data.defaults[stage],
            savedAt: null,
            editing: data[stage],
            saving: false,
            saved: false,
            resetting: false,
          };
        }
        setPrompts(state);
      })
      .finally(() => setLoading(false));
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
        update(stage, { current: prompts[stage].editing, savedAt: data.saved_at, saved: true });
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
      update(stage, { editing: defaultText, current: defaultText, savedAt: null, saved: false });
    } finally {
      update(stage, { resetting: false });
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
    <main className="px-7 py-7 max-w-[720px] mx-auto">
      {/* Header */}
      <div className="mb-7">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text)] mb-1">
          Settings
        </h1>
        <p className="text-[13px] text-[var(--color-text-2)]">
          Edit the system prompts for each stage. Changes take effect on the next pipeline run.
        </p>
      </div>

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
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
