"use client";

// Who this product is for — the buyer every word is written to, and the user
// the product is for and the pictures show. Decided by the research, editable
// here; every stage reads it (lib/audience.ts).

import { useEffect, useState } from "react";

type Audience = { buyer: string; user: string; same: boolean; relation?: string; source: "research" | "derived" | "manual"; at: string };

const inputCls =
  "w-full min-h-[38px] rounded-[7px] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-[13px] px-2.5 py-2 outline-none focus:border-[var(--color-border-strong)]";

export default function AudienceCard({ runId, audience }: { runId: number; audience: Audience | null }) {
  const [a, setA] = useState<Audience | null>(audience);
  const [draft, setDraft] = useState({ buyer: audience?.buyer ?? "", same: audience?.same ?? true, user: audience?.same ? "" : audience?.user ?? "", relation: audience?.relation ?? "" });
  const [err, setErr] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (audience && (!a || audience.at > a.at)) {
      setA(audience);
      setDraft({ buyer: audience.buyer, same: audience.same, user: audience.same ? "" : audience.user, relation: audience.relation ?? "" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audience]);

  const save = async (next: typeof draft) => {
    setDraft(next);
    if (!next.buyer.trim()) return;
    if (!next.same && (!next.user.trim() || !next.relation.trim())) return;
    const body: Audience = {
      buyer: next.buyer.trim(),
      same: next.same,
      user: next.same ? next.buyer.trim() : next.user.trim(),
      ...(next.same ? {} : { relation: next.relation.trim() }),
      source: "manual",
      at: new Date().toISOString(),
    };
    if (a && a.buyer === body.buyer && a.same === body.same && a.user === body.user && (a.relation ?? "") === (body.relation ?? "")) return;
    setErr(null);
    try {
      const r = await fetch(`/api/runs/${runId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audience: JSON.stringify(body) }) });
      if (!r.ok) { const d = await r.json().catch(() => ({})); setErr((d as { error?: string }).error ?? `Could not save (${r.status})`); return; }
      setA(body);
      window.dispatchEvent(new Event("run:changed"));
    } catch { setErr("Network error saving who it's for"); }
  };

  const workItOut = async () => {
    setWorking(true); setErr(null);
    try {
      const r = await fetch(`/api/runs/${runId}/audience`, { method: "POST" });
      const d = await r.json().catch(() => ({})) as { success?: boolean; audience?: Audience; error?: string };
      if (!d.success || !d.audience) { setErr(d.error ?? `Failed (${r.status})`); return; }
      setA(d.audience);
      setDraft({ buyer: d.audience.buyer, same: d.audience.same, user: d.audience.same ? "" : d.audience.user, relation: d.audience.relation ?? "" });
      window.dispatchEvent(new Event("run:changed"));
    } catch { setErr("Network error"); } finally { setWorking(false); }
  };

  const tag = a ? (a.source === "manual" ? "edited" : a.source === "derived" ? "worked out" : "from research") : "not set";

  return (
    <div className="mb-6">
      <div className="flex items-center gap-3.5 mb-2.5">
        <span className="eyebrow">Who it&apos;s for</span>
        <span className="ff-mono text-[10.5px] text-[var(--color-text-4)]">{tag}</span>
        <div className="flex-1" />
        {!a && <button onClick={workItOut} disabled={working} className="btn btn-sm cursor-pointer">{working ? "Working it out…" : "Work it out"}</button>}
      </div>
      <div className="border border-[var(--color-border)] rounded-[9px] bg-[var(--color-surface)] px-[13px] py-3 space-y-3">
        <label className="flex flex-col gap-1">
          <span className="eyebrow">Buyer — every word is written to her</span>
          <input value={draft.buyer} onChange={(e) => setDraft({ ...draft, buyer: e.target.value })} onBlur={() => save(draft)}
            placeholder="Middle-aged mom buying for her ageing parent" className={inputCls} />
        </label>
        <div className="flex items-center gap-2" role="radiogroup" aria-label="Who uses it">
          {[{ v: true, l: "Uses it herself" }, { v: false, l: "Buys it for someone else" }].map((o) => (
            <button key={String(o.v)} role="radio" aria-checked={draft.same === o.v} onClick={() => save({ ...draft, same: o.v })}
              className={`cursor-pointer min-h-[36px] px-3 rounded-[7px] border text-[12.5px] transition-colors duration-150 ${draft.same === o.v ? "border-[var(--color-border-strong)] bg-[var(--color-surface-2)] text-[var(--color-text)]" : "border-[var(--color-border)] text-[var(--color-text-2)] hover:text-[var(--color-text)]"}`}>
              {o.l}
            </button>
          ))}
        </div>
        {!draft.same && (
          <div className="grid gap-3" style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)" }}>
            <label className="flex flex-col gap-1 min-w-0">
              <span className="eyebrow">User — who the pictures show</span>
              <input value={draft.user} onChange={(e) => setDraft({ ...draft, user: e.target.value })} onBlur={() => save(draft)}
                placeholder="Parent in their 70s, unsteady getting up" className={inputCls} />
            </label>
            <label className="flex flex-col gap-1 min-w-0">
              <span className="eyebrow">The copy calls them</span>
              <input value={draft.relation} onChange={(e) => setDraft({ ...draft, relation: e.target.value })} onBlur={() => save(draft)}
                placeholder="your mom or dad" className={inputCls} />
            </label>
          </div>
        )}
        {err && <p className="text-[11.5px] text-[var(--color-red)]">{err}</p>}
      </div>
    </div>
  );
}
