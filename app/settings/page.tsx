"use client";

import { useEffect, useState } from "react";

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
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-zinc-950">
        <div className="max-w-2xl mx-auto px-6 pt-10">
          <p className="font-mono text-[11px] text-zinc-600">Loading prompts...</p>
        </div>
      </main>
    );
  }

  if (!prompts) return null;

  return (
    <main className="min-h-screen bg-zinc-950 pb-16">
      <div className="max-w-2xl mx-auto px-6 pt-10">
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <span className="font-mono text-[10px] text-blue-400 uppercase tracking-widest">Settings</span>
            <span className="text-zinc-700">·</span>
            <span className="font-mono text-[10px] text-zinc-600 uppercase tracking-widest">Prompt Editor</span>
          </div>
          <p className="text-zinc-500 text-sm">
            Edit the system prompts for each stage. Changes take effect on the next pipeline run.
          </p>
        </div>

        <div className="space-y-6">
          {(["stage1", "stage2", "stage3"] as Stage[]).map((stage) => {
            const s = prompts[stage];
            const isModified = s.editing !== s.default;

            return (
              <section key={stage} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-[9px] text-zinc-600 border border-zinc-800 rounded px-1.5 py-0.5">
                      {STAGE_NUMS[stage]}
                    </span>
                    <h2 className="font-mono text-[11px] text-zinc-400 uppercase tracking-widest">
                      {STAGE_LABELS[stage]}
                    </h2>
                    {isModified && (
                      <span className="inline-flex items-center gap-1 font-mono text-[9px] bg-amber-950/40 text-amber-400 border border-amber-900/40 px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                        modified
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {s.savedAt && (
                      <span className="text-[10px] font-mono text-zinc-600">
                        Saved {formatDate(s.savedAt)}
                      </span>
                    )}
                    {s.saved && (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-950/60 text-emerald-400 border border-emerald-900/50">
                        Saved ✓
                      </span>
                    )}
                  </div>
                </div>

                <textarea
                  value={s.editing}
                  onChange={(e) => update(stage, { editing: e.target.value, saved: false })}
                  rows={18}
                  className="w-full bg-zinc-900 border border-zinc-800 focus:border-zinc-600 focus:ring-1 focus:ring-blue-500/10 rounded-lg px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none transition-colors disabled:opacity-40 font-mono leading-relaxed resize-y"
                />

                <div className="flex items-center gap-3 mt-3">
                  <button
                    onClick={() => save(stage)}
                    disabled={s.saving || s.editing === s.current}
                    className="cursor-pointer px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    {s.saving ? "Saving..." : "Save"}
                  </button>

                  {isModified && (
                    <button
                      onClick={() => reset(stage)}
                      disabled={s.resetting}
                      className="cursor-pointer px-4 py-2 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 rounded-lg text-sm transition-colors"
                    >
                      {s.resetting ? "Resetting..." : "Reset to Default"}
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
