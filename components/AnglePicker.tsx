"use client";

// The angles gate: after research, the strategist proposes 4–6 problem-first
// angles. The operator picks one (and can tweak its text); Copy and Images are
// built around that pick. "Run Stage 3" stays disabled until one is chosen.

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/Toasts";
import { parseAngle, parseAngles, type Angle } from "@/lib/angles";
import type { RunStatus } from "@/hooks/useRunPolling";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

const FIELDS: { key: keyof Angle; label: string; rows: number }[] = [
  { key: "problem", label: "Problem", rows: 2 },
  { key: "consequence", label: "Consequence if unsolved", rows: 2 },
  { key: "mechanism", label: "Why this product solves it", rows: 2 },
  { key: "who", label: "Who feels it most", rows: 1 },
  { key: "hook", label: "Opening hook", rows: 1 },
];

export default function AnglePicker({ runId, run, editable }: { runId: number; run: RunStatus; editable: boolean }) {
  const { push } = useToast();
  const proposed = useMemo(() => parseAngles(run.angles?.proposed), [run.angles?.proposed]);
  const saved = useMemo(() => parseAngle(run.angles?.selected), [run.angles?.selected]);
  const [pick, setPick] = useState<Angle | null>(saved);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"generate" | "save" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setPick(saved); }, [saved?.id, saved?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(angle: Angle) {
    setBusy("save"); setErr(null);
    try {
      const res = await fetch(`/api/runs/${runId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_angle_selected: JSON.stringify(angle) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPick(angle);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save the angle");
    } finally { setBusy(null); }
  }

  async function generate() {
    setBusy("generate"); setErr(null);
    try {
      const res = await fetch(`/api/runs/${runId}/angles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? `HTTP ${res.status}`);
      setPick(null);
      setNote("");
      push(`${data.angles.length} angles proposed`, "success");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't generate angles");
    } finally { setBusy(null); }
  }

  const chosenId = pick?.id;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="eyebrow">Positioning angle{pick ? " · chosen" : proposed.length ? " · pick one" : ""}</p>
          <p className="text-[12px] text-[var(--color-text-3)] mt-0.5">Each angle is one specific problem, its stakes, and why this product's mechanism fixes it. The copy and every image are built around the one you choose.</p>
        </div>
      </div>

      {proposed.length === 0 ? (
        <div className="border border-dashed border-[var(--color-border)] rounded-[var(--radius)] px-4 py-6 text-center">
          <p className="text-[12.5px] text-[var(--color-text-2)] mb-3">No angles on this run yet.</p>
          {editable && (
            <button onClick={generate} disabled={busy !== null}
              className="cursor-pointer inline-flex items-center gap-[7px] rounded-[var(--radius-sm)] px-[13px] py-[8px] text-[13px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] border border-transparent tr hover:brightness-110 disabled:opacity-60">
              {busy === "generate" ? <Icon.Loader className="w-3.5 h-3.5" /> : <Icon.Spark className="w-3.5 h-3.5" />} {busy === "generate" ? "Thinking…" : "Propose angles"}
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {proposed.map((a, i) => {
            const on = chosenId === a.id;
            return (
              <button key={a.id} disabled={!editable || busy !== null} onClick={() => { if (!on) { setEditing(false); save(a); } }}
                className={cx("text-left rounded-[var(--radius)] border p-4 tr", editable ? "cursor-pointer" : "cursor-default",
                  on ? "border-[var(--color-accent)] bg-[var(--color-accent-weak)]" : "border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-strong)]")}>
                <div className="flex items-start gap-2.5">
                  <span className={cx("mt-0.5 w-5 h-5 rounded-full grid place-items-center shrink-0 border-2 text-[10px] font-bold",
                    on ? "bg-[var(--color-accent)] border-[var(--color-accent)] text-white" : "border-[var(--color-border-strong)] text-[var(--color-text-3)]")}>
                    {on ? <Icon.Check className="w-3 h-3" strokeWidth={3} /> : i + 1}
                  </span>
                  <div className="min-w-0 space-y-1.5">
                    <p className="text-[13.5px] font-[680] text-[var(--color-text)]">{a.title}</p>
                    <p className="text-[12px] text-[var(--color-text-2)] leading-relaxed"><span className="font-[620] text-[var(--color-text)]">Problem: </span>{a.problem}</p>
                    <p className="text-[12px] text-[var(--color-text-2)] leading-relaxed"><span className="font-[620] text-[var(--color-text)]">Stakes: </span>{a.consequence}</p>
                    <p className="text-[12px] text-[var(--color-text-2)] leading-relaxed"><span className="font-[620] text-[var(--color-text)]">Why it works: </span>{a.mechanism}</p>
                    <p className="text-[11.5px] text-[var(--color-text-3)]"><span className="font-[620]">Who: </span>{a.who}</p>
                    <p className="text-[11.5px] italic text-[var(--color-text-3)]">“{a.hook}”</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* the chosen angle, editable */}
      {pick && (
        <div className="border border-[var(--color-border)] rounded-[var(--radius)] bg-[var(--color-surface-2)] px-4 py-3 space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[12.5px] font-[650] text-[var(--color-text)]">Chosen: {pick.title}</p>
            {editable && (
              <button onClick={() => setEditing((v) => !v)} className="cursor-pointer text-[11.5px] text-[var(--color-text-3)] hover:text-[var(--color-text)] underline decoration-dotted underline-offset-2 tr">
                {editing ? "Done editing" : "Edit the wording"}
              </button>
            )}
          </div>
          {editing && (
            <div className="space-y-2">
              <input value={pick.title} onChange={(e) => setPick({ ...pick, title: e.target.value })} onBlur={() => save(pick)}
                className="w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-[var(--radius-sm)] px-3 py-2 text-[13px] font-[620] focus:outline-none focus:border-[var(--color-accent)]" />
              {FIELDS.map((f) => (
                <label key={f.key} className="block">
                  <span className="ff-mono text-[10px] uppercase tracking-widest text-[var(--color-text-4)]">{f.label}</span>
                  <textarea value={String(pick[f.key] ?? "")} rows={f.rows}
                    onChange={(e) => setPick({ ...pick, [f.key]: e.target.value })} onBlur={() => save(pick)}
                    className="mt-1 w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-[var(--radius-sm)] px-3 py-2 text-[12.5px] leading-relaxed resize-y focus:outline-none focus:border-[var(--color-accent)]" />
                </label>
              ))}
              <p className="text-[11px] text-[var(--color-text-4)]">Saved when you leave a field.</p>
            </div>
          )}
        </div>
      )}

      {editable && proposed.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Steer the next set (optional): e.g. “more health-focused”, “angles for first-time owners”"
            className="flex-1 min-w-[240px] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-[var(--radius-sm)] px-3 py-[7px] text-[12.5px] focus:outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-text-4)]" />
          <button onClick={generate} disabled={busy !== null}
            className="cursor-pointer inline-flex items-center gap-[7px] rounded-[var(--radius-sm)] px-3 py-[7px] text-[12.5px] font-[620] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] tr hover:border-[var(--color-text-3)] hover:bg-[var(--color-surface-2)] disabled:opacity-50 whitespace-nowrap">
            {busy === "generate" ? <Icon.Loader className="w-3.5 h-3.5" /> : <Icon.Refresh className="w-3.5 h-3.5" />} {busy === "generate" ? "Thinking…" : "Propose new angles"}
          </button>
        </div>
      )}
      {busy === "save" && <p className="text-[11px] text-[var(--color-text-4)]">Saving…</p>}
      {err && <p className="text-[12px] text-[var(--color-red)]">{err}</p>}
    </div>
  );
}
