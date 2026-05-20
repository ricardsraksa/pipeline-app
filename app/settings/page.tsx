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
      <main className="min-h-[calc(100vh-3rem)]">
        <div className="max-w-3xl mx-auto px-5 pt-10">
          <p className="font-mono text-[11px] text-[var(--color-text-3)]">Loading prompts…</p>
        </div>
      </main>
    );
  }

  if (!prompts) return null;

  return (
    <main className="min-h-[calc(100vh-3rem)] pb-24">
      <div className="max-w-3xl mx-auto px-5 pt-10">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-[22px] font-semibold tracking-tight text-[var(--color-text)] mb-1">
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
                className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden"
              >
                {/* Section header */}
                <div className="flex items-center justify-between px-5 py-3 bg-[var(--color-surface-2)]/40 border-b border-[var(--color-border)]">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-[9px] text-[var(--color-text-4)] border border-[var(--color-border)] rounded px-1.5 py-0.5">
                      {STAGE_NUMS[stage]}
                    </span>
                    <h2 className="font-mono text-[10px] text-[var(--color-text-2)] uppercase tracking-[0.14em]">
                      {STAGE_LABELS[stage]}
                    </h2>
                    {isModified && (
                      <span className="inline-flex items-center gap-1 font-mono text-[9px] bg-[color:rgb(184_144_74_/_0.10)] text-[var(--color-warn)] border border-[color:rgb(184_144_74_/_0.25)] px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                        modified
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {s.savedAt && (
                      <span className="text-[10px] font-mono text-[var(--color-text-4)]">
                        Saved {formatDate(s.savedAt)}
                      </span>
                    )}
                    {s.saved && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono bg-[color:rgb(90_158_117_/_0.12)] text-[var(--color-success)] border border-[color:rgb(90_158_117_/_0.28)]">
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
                    className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] focus:border-[var(--color-accent)]/60 focus:ring-2 focus:ring-[var(--color-accent)]/10 rounded-lg px-3.5 py-2.5 text-[12px] font-mono text-[var(--color-text-2)] placeholder-[var(--color-text-4)] focus:outline-none transition-colors resize-y leading-relaxed"
                  />
                </div>

                {/* Footer actions */}
                <div className="flex items-center gap-3 px-5 pb-4">
                  <button
                    onClick={() => save(stage)}
                    disabled={s.saving || s.editing === s.current}
                    className="cursor-pointer inline-flex items-center gap-1.5 h-8 px-3.5 rounded-md bg-[var(--color-accent)] hover:bg-[var(--color-accent-dim)] disabled:opacity-40 disabled:cursor-not-allowed text-white text-[12px] font-medium transition-colors duration-150"
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
                      className="cursor-pointer inline-flex items-center gap-1.5 h-8 px-3.5 rounded-md border border-[var(--color-border)] hover:border-[var(--color-border-hover)] hover:bg-[var(--color-surface-2)] text-[var(--color-text-3)] hover:text-[var(--color-text-2)] text-[12px] transition-colors duration-150 disabled:opacity-40"
                    >
                      {s.resetting ? "Resetting…" : "Reset to default"}
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}
