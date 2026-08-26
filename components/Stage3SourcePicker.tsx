"use client";

// Per-run picker for which source product photos Stage 3 may use as
// references. All candidates (uploaded + scraped) default to included; a click
// toggles a photo onto/off the run's blacklist (runs.stage3_source_blacklist).
// Excluded photos are skipped by the hero prompt-writer, hero generation and
// regeneration, and the skip-hero path — useful when a supplier photo misleads
// the prompt writer or Higgsfield's moderation rejects it.

import { useState } from "react";

export default function Stage3SourcePicker({
  runId,
  candidates,
  blacklist,
  onChanged,
}: {
  runId: number;
  candidates: string[];
  blacklist: string[];
  onChanged: () => void | Promise<void>;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const excluded = new Set(blacklist);
  const activeCount = candidates.filter((u) => !excluded.has(u)).length;

  async function toggle(url: string) {
    setErr(null);
    const isExcluded = excluded.has(url);
    if (!isExcluded && activeCount <= 1) {
      setErr("At least one source image must stay in use.");
      return;
    }
    const next = isExcluded ? blacklist.filter((u) => u !== url) : [...blacklist, url];
    setSaving(url);
    try {
      const res = await fetch(`/api/runs/${runId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage3_source_blacklist: JSON.stringify(next) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save — check your connection.");
    } finally {
      setSaving(null);
    }
  }

  if (!candidates.length) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h4 className="font-[var(--font-ibm-plex-mono)] text-[10px] uppercase tracking-widest text-[var(--color-text-3)]">
          Source images — {activeCount} of {candidates.length} in use
        </h4>
      </div>
      <p className="text-[11px] text-[var(--color-text-3)]">
        Click a photo to exclude it from Stage 3 (or bring it back). Excluded photos are never sent to the prompt writer or Higgsfield.
      </p>
      <div className="flex flex-wrap gap-2">
        {candidates.map((url) => {
          const off = excluded.has(url);
          return (
            <button
              key={url}
              onClick={() => toggle(url)}
              disabled={saving !== null}
              title={off ? "Excluded — click to use again" : "In use — click to exclude"}
              className={`relative w-[72px] h-[72px] rounded-[9px] overflow-hidden border cursor-pointer tr ${
                off
                  ? "border-[var(--color-border)] opacity-35 grayscale"
                  : "border-[var(--color-border-strong)] hover:border-[var(--color-text-3)]"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="w-full h-full object-cover" />
              {off && (
                <span className="absolute inset-x-0 bottom-0 bg-black/70 text-white text-[9px] font-[620] text-center py-0.5">
                  Excluded
                </span>
              )}
              {saving === url && (
                <span className="absolute inset-0 grid place-items-center bg-black/40 text-white text-[10px]">…</span>
              )}
            </button>
          );
        })}
      </div>
      {err && <p className="text-[11px] text-[var(--color-red)]">{err}</p>}
    </div>
  );
}
