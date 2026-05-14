"use client";

import { useEffect, useState } from "react";

type Stage = "stage1" | "stage2" | "stage3";

const STAGE_LABELS: Record<Stage, string> = {
  stage1: "Stage 1 — Research Brief",
  stage2: "Stage 2 — German Copy",
  stage3: "Stage 3 — Image Prompts",
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
      <main className="min-h-screen bg-[#0a0a0a]">
        <div className="max-w-2xl mx-auto px-4 pt-8">
          <p className="text-xs font-mono text-[#404040]">Loading prompts...</p>
        </div>
      </main>
    );
  }

  if (!prompts) return null;

  return (
    <main className="min-h-screen bg-[#0a0a0a] pb-16">
      <div className="max-w-2xl mx-auto px-4 pt-8">
        <div className="mb-7">
          <h1 className="font-mono text-xs text-[#2563eb] tracking-[0.2em] uppercase mb-2">
            Settings — Prompt Editor
          </h1>
          <p className="text-[#404040] text-sm">
            Edit the system prompts for each stage. Changes take effect on the next pipeline run.
          </p>
        </div>

        <div className="space-y-8">
          {(["stage1", "stage2", "stage3"] as Stage[]).map((stage) => {
            const s = prompts[stage];
            const isModified = s.editing !== s.default;

            return (
              <section key={stage}>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="font-mono text-xs text-[#e5e5e5] uppercase tracking-wider">
                    {STAGE_LABELS[stage]}
                  </h2>
                  <div className="flex items-center gap-3">
                    {s.savedAt && (
                      <span className="text-xs font-mono text-[#404040]">
                        Saved {formatDate(s.savedAt)}
                      </span>
                    )}
                    {s.saved && (
                      <span className="text-xs font-mono text-[#16a34a]">Saved ✓</span>
                    )}
                  </div>
                </div>

                <textarea
                  value={s.editing}
                  onChange={(e) => update(stage, { editing: e.target.value, saved: false })}
                  rows={20}
                  className="w-full bg-[#0d0d0d] border border-[#2a2a2a] focus:border-[#2563eb] rounded-md px-4 py-3 text-xs font-mono text-[#d4d4d4] leading-relaxed resize-y focus:outline-none transition-colors"
                />

                <div className="flex items-center gap-3 mt-2">
                  <button
                    onClick={() => save(stage)}
                    disabled={s.saving || s.editing === s.current}
                    className="px-4 py-2 bg-[#2563eb] hover:bg-[#1d4ed8] disabled:bg-[#1a1a1a] disabled:text-[#3a3a3a] text-white rounded font-mono text-xs transition-colors"
                  >
                    {s.saving ? "Saving..." : "Save"}
                  </button>

                  {isModified && (
                    <button
                      onClick={() => reset(stage)}
                      disabled={s.resetting}
                      className="px-3 py-2 bg-[#1a1a1a] hover:bg-[#222] border border-[#2a2a2a] rounded text-xs font-mono text-[#737373] hover:text-[#e5e5e5] transition-colors"
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
