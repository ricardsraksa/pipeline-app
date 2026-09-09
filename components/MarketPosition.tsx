"use client";

// Where the buyer stands before she reads a word: how much she knows about
// this kind of product, and how many similar products she has already been
// sold. Diagnosed by the Stage 2 research; correctable here because a wrong
// call sends the angles, the copy and the ads into the wrong opening.

import { useEffect, useState } from "react";
import {
  AWARENESS_LABEL, AWARENESS_STAGES, SOPHISTICATION_LABEL, SOPHISTICATION_STAGES,
  type AwarenessStage, type MarketPosition as MP, type SophisticationStage,
} from "@/lib/market";

const selectCls =
  "min-h-[38px] rounded-[7px] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] ff-mono text-[12.5px] px-2.5 py-2 outline-none focus:border-[var(--color-border-strong)] cursor-pointer";

export default function MarketPositionCard({ runId, position }: { runId: number; position: MP | null }) {
  const [mp, setMp] = useState<MP | null>(position);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (position && (!mp || position.at > mp.at)) setMp(position);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position]);

  if (!mp) return null;

  const save = (next: MP) => {
    setMp(next);
    setErr(null);
    fetch(`/api/runs/${runId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ market_position: JSON.stringify(next) }),
    })
      .then(async (r) => { if (!r.ok) { const d = await r.json().catch(() => ({})); setErr((d as { error?: string }).error || `Could not save (${r.status})`); } })
      .catch(() => setErr("Network error saving market position"));
  };

  const set = (patch: Partial<MP>) => save({ ...mp, ...patch, source: "manual", at: new Date().toISOString() });

  return (
    <div className="mb-6">
      <div className="flex items-center gap-3.5 mb-2.5">
        <span className="eyebrow">Market</span>
        {mp.source === "manual" && <span className="ff-mono text-[10.5px] text-[var(--color-text-4)]">edited</span>}
      </div>
      <div className="border border-[var(--color-border)] rounded-[9px] bg-[var(--color-surface)] px-[13px] py-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="min-w-0 flex flex-col gap-1">
            <span className="eyebrow">Awareness</span>
            <select
              value={mp.awareness}
              onChange={(e) => set({ awareness: e.target.value as AwarenessStage })}
              className={selectCls}
            >
              {AWARENESS_STAGES.map((a) => <option key={a} value={a}>{AWARENESS_LABEL[a]}</option>)}
            </select>
          </label>
          <label className="min-w-0 flex flex-col gap-1">
            <span className="eyebrow">Sophistication</span>
            <select
              value={mp.sophistication}
              onChange={(e) => set({ sophistication: Number(e.target.value) as SophisticationStage })}
              className={selectCls}
            >
              {SOPHISTICATION_STAGES.map((s) => <option key={s} value={s}>{SOPHISTICATION_LABEL[s]}</option>)}
            </select>
          </label>
        </div>
        {err && <p className="text-[11.5px] text-[var(--color-red)] mt-2">{err}</p>}
      </div>
    </div>
  );
}
