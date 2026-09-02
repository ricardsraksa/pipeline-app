"use client";

// The angles gate: after research, the strategist proposes 4–6 problem-first
// angles. The operator ticks one or more (the first tick is the PRIMARY angle
// everything leads with; the rest are supporting), can write their own, and
// can edit the wording of anything selected. "Run Stage 3" stays disabled
// until at least one is chosen.

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/Toasts";
import { parseAngles, parseSelectedAngles, type Angle } from "@/lib/angles";
import type { RunStatus } from "@/hooks/useRunPolling";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

const FIELDS: { key: keyof Angle; label: string; rows: number; hint: string }[] = [
  { key: "problem", label: "Problem", rows: 2, hint: "The specific problem, in the customer's world" },
  { key: "consequence", label: "Consequence if unsolved", rows: 2, hint: "The real stakes" },
  { key: "mechanism", label: "Why this product solves it", rows: 2, hint: "Cause and effect, not features" },
  { key: "who", label: "Who feels it most", rows: 1, hint: "A specific person" },
  { key: "hook", label: "Opening hook", rows: 1, hint: "One line a page could start with" },
];

const EMPTY: Angle = { id: "", title: "", problem: "", consequence: "", mechanism: "", who: "", hook: "", why_this_angle: "" };

const inputCls = "w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-[var(--radius-sm)] px-3 py-2 text-[12.5px] leading-relaxed resize-y focus:outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-text-4)]";

function AngleForm({ value, onChange }: { value: Angle; onChange: (a: Angle) => void }) {
  return (
    <div className="space-y-2">
      <input value={value.title} onChange={(e) => onChange({ ...value, title: e.target.value })} placeholder="Short name for the angle"
        className={cx(inputCls, "font-[620] text-[13px]")} />
      {FIELDS.map((f) => (
        <label key={f.key} className="block">
          <span className="ff-mono text-[10px] uppercase tracking-widest text-[var(--color-text-4)]">{f.label}</span>
          <textarea value={String(value[f.key] ?? "")} rows={f.rows} placeholder={f.hint}
            onChange={(e) => onChange({ ...value, [f.key]: e.target.value })} className={cx(inputCls, "mt-1")} />
        </label>
      ))}
    </div>
  );
}

export default function AnglePicker({ runId, run, editable }: { runId: number; run: RunStatus; editable: boolean }) {
  const { push } = useToast();
  const proposedFromRun = useMemo(() => parseAngles(run.angles?.proposed), [run.angles?.proposed]);
  const savedSel = useMemo(() => parseSelectedAngles(run.angles?.selected), [run.angles?.selected]);
  const [proposed, setProposed] = useState<Angle[]>(proposedFromRun);
  const [selected, setSelected] = useState<Angle[]>(savedSel);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [custom, setCustom] = useState<Angle | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"generate" | "save" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setProposed(proposedFromRun); }, [proposedFromRun]);
  useEffect(() => { setSelected(savedSel); }, [savedSel]);

  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/runs/${runId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async function saveSelection(next: Angle[]) {
    setBusy("save"); setErr(null);
    try {
      await patch({ product_angle_selected: next.length ? JSON.stringify(next) : null });
      setSelected(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save");
    } finally { setBusy(null); }
  }

  function toggle(a: Angle) {
    if (!editable) return;
    const on = selected.some((s) => s.id === a.id);
    saveSelection(on ? selected.filter((s) => s.id !== a.id) : [...selected, a]);
  }

  function makePrimary(id: string) {
    const a = selected.find((s) => s.id === id);
    if (!a) return;
    saveSelection([a, ...selected.filter((s) => s.id !== id)]);
  }

  function updateSelected(id: string, next: Angle) {
    setSelected((p) => p.map((s) => (s.id === id ? next : s)));
    setProposed((p) => p.map((s) => (s.id === id ? next : s)));
  }

  async function persistEdits() {
    setBusy("save"); setErr(null);
    try {
      await patch({ product_angle_selected: JSON.stringify(selected), product_angles: JSON.stringify(proposed) });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save");
    } finally { setBusy(null); }
  }

  async function addCustom() {
    if (!custom) return;
    if (custom.title.trim().length < 3 || custom.problem.trim().length < 10) { setErr("Give the angle a name and a problem at least."); return; }
    const a: Angle = { ...custom, id: `custom-${Date.now().toString(36)}`, why_this_angle: custom.why_this_angle || "Operator's own angle." };
    const nextProposed = [...proposed, a];
    const nextSelected = [...selected, a];
    setBusy("save"); setErr(null);
    try {
      await patch({ product_angles: JSON.stringify(nextProposed), product_angle_selected: JSON.stringify(nextSelected) });
      setProposed(nextProposed);
      setSelected(nextSelected);
      setCustom(null);
      push("Your angle added and selected", "success");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save");
    } finally { setBusy(null); }
  }

  async function generate() {
    setBusy("generate"); setErr(null);
    try {
      const res = await fetch(`/api/runs/${runId}/angles`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }) });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? `HTTP ${res.status}`);
      // Keep the operator's own angles across a regenerate; the model's are replaced.
      const own = proposed.filter((a) => a.id.startsWith("custom-"));
      const nextProposed = [...(data.angles as Angle[]), ...own];
      const nextSelected = selected.filter((a) => a.id.startsWith("custom-"));
      await patch({ product_angles: JSON.stringify(nextProposed), product_angle_selected: nextSelected.length ? JSON.stringify(nextSelected) : null });
      setProposed(nextProposed);
      setSelected(nextSelected);
      setNote("");
      push(`${data.angles.length} angles proposed`, "success");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't generate angles");
    } finally { setBusy(null); }
  }

  const selectedIds = new Set(selected.map((s) => s.id));
  const btn = "cursor-pointer inline-flex items-center gap-[7px] rounded-[var(--radius-sm)] px-3 py-[7px] text-[12.5px] font-[620] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] tr hover:border-[var(--color-text-3)] hover:bg-[var(--color-surface-2)] disabled:opacity-50 whitespace-nowrap";
  const primaryBtn = "cursor-pointer inline-flex items-center gap-[7px] rounded-[var(--radius-sm)] px-[13px] py-[8px] text-[13px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] border border-transparent tr hover:brightness-110 disabled:opacity-60";

  return (
    <div className="space-y-3">
      <div>
        <p className="eyebrow">Positioning angles · {selected.length ? `${selected.length} chosen` : "pick one or more"}</p>
        <p className="text-[12px] text-[var(--color-text-3)] mt-0.5">First tick is the primary angle; the rest are supporting.</p>
      </div>

      {proposed.length === 0 && !custom ? (
        <div className="border border-dashed border-[var(--color-border)] rounded-[var(--radius)] px-4 py-6 text-center space-y-3">
          <p className="text-[12.5px] text-[var(--color-text-2)]">No angles on this run yet.</p>
          {editable && (
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <button onClick={generate} disabled={busy !== null} className={primaryBtn}>
                {busy === "generate" ? <Icon.Loader className="w-3.5 h-3.5" /> : <Icon.Spark className="w-3.5 h-3.5" />} {busy === "generate" ? "Thinking…" : "Propose angles"}
              </button>
              <button onClick={() => setCustom({ ...EMPTY })} className={btn}>Write my own</button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {proposed.map((a, i) => {
            const on = selectedIds.has(a.id);
            const isPrimary = on && selected[0]?.id === a.id;
            const own = a.id.startsWith("custom-");
            return (
              <button key={a.id} disabled={!editable || busy !== null} onClick={() => toggle(a)}
                className={cx("text-left rounded-[var(--radius)] border p-4 tr", editable ? "cursor-pointer" : "cursor-default",
                  on ? "border-[var(--color-accent)] bg-[var(--color-accent-weak)]" : "border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-strong)]")}>
                <div className="flex items-start gap-2.5">
                  <span className={cx("mt-0.5 w-5 h-5 rounded-[5px] grid place-items-center shrink-0 border-2 text-[10px] font-bold",
                    on ? "bg-[var(--color-accent)] border-[var(--color-accent)] text-white" : "border-[var(--color-border-strong)] text-[var(--color-text-3)]")}>
                    {on ? <Icon.Check className="w-3 h-3" strokeWidth={3} /> : i + 1}
                  </span>
                  <div className="min-w-0 space-y-1.5">
                    <p className="text-[13.5px] font-[680] text-[var(--color-text)] flex items-center gap-2 flex-wrap">
                      {a.title}
                      {isPrimary && <span className="text-[10px] font-[700] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--color-accent)] text-white">Primary</span>}
                      {on && !isPrimary && <span className="text-[10px] font-[700] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--color-surface-3)] text-[var(--color-text-2)]">Supporting</span>}
                      {own && <span className="text-[10px] font-[700] uppercase tracking-wider px-1.5 py-0.5 rounded border border-[var(--color-border-strong)] text-[var(--color-text-3)]">Yours</span>}
                    </p>
                    <p className="text-[12px] text-[var(--color-text-2)] leading-relaxed"><span className="font-[620] text-[var(--color-text)]">Problem: </span>{a.problem}</p>
                    {a.consequence && <p className="text-[12px] text-[var(--color-text-2)] leading-relaxed"><span className="font-[620] text-[var(--color-text)]">Stakes: </span>{a.consequence}</p>}
                    {a.mechanism && <p className="text-[12px] text-[var(--color-text-2)] leading-relaxed"><span className="font-[620] text-[var(--color-text)]">Why it works: </span>{a.mechanism}</p>}
                    {a.who && <p className="text-[11.5px] text-[var(--color-text-3)]"><span className="font-[620]">Who: </span>{a.who}</p>}
                    {a.hook && <p className="text-[11.5px] italic text-[var(--color-text-3)]">“{a.hook}”</p>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* your own angle */}
      {editable && custom && (
        <div className="border border-[var(--color-accent)] rounded-[var(--radius)] bg-[var(--color-surface)] px-4 py-3 space-y-3">
          <p className="text-[12.5px] font-[650] text-[var(--color-text)]">Your own angle</p>
          <AngleForm value={custom} onChange={setCustom} />
          <div className="flex items-center gap-2">
            <button onClick={addCustom} disabled={busy !== null} className={primaryBtn}>Add &amp; select</button>
            <button onClick={() => setCustom(null)} className={btn}>Cancel</button>
          </div>
        </div>
      )}

      {/* chosen list: order, edit */}
      {selected.length > 0 && (
        <div className="border border-[var(--color-border)] rounded-[var(--radius)] bg-[var(--color-surface-2)] px-4 py-3 space-y-2">
          {selected.map((a, i) => (
            <div key={a.id} className="space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-[12.5px] text-[var(--color-text)]">
                  <span className="font-[700]">{i === 0 ? "Primary" : "Supporting"}:</span> {a.title}
                </p>
                {editable && (
                  <div className="flex items-center gap-3">
                    {i > 0 && <button onClick={() => makePrimary(a.id)} className="cursor-pointer text-[11.5px] text-[var(--color-text-3)] hover:text-[var(--color-text)] underline decoration-dotted underline-offset-2 tr">Make primary</button>}
                    <button onClick={() => setEditingId(editingId === a.id ? null : a.id)} className="cursor-pointer text-[11.5px] text-[var(--color-text-3)] hover:text-[var(--color-text)] underline decoration-dotted underline-offset-2 tr">
                      {editingId === a.id ? "Done" : "Edit wording"}
                    </button>
                  </div>
                )}
              </div>
              {editable && editingId === a.id && (
                <div onBlur={persistEdits}>
                  <AngleForm value={a} onChange={(next) => updateSelected(a.id, next)} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editable && proposed.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Steer the next set (optional)"
            className="flex-1 min-w-[240px] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-[var(--radius-sm)] px-3 py-[7px] text-[12.5px] focus:outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-text-4)]" />
          <button onClick={generate} disabled={busy !== null} className={btn}>
            {busy === "generate" ? <Icon.Loader className="w-3.5 h-3.5" /> : <Icon.Refresh className="w-3.5 h-3.5" />} {busy === "generate" ? "Thinking…" : "New angles"}
          </button>
          {!custom && <button onClick={() => setCustom({ ...EMPTY })} className={btn}>Write my own</button>}
        </div>
      )}
      {busy === "save" && <p className="text-[11px] text-[var(--color-text-4)]">Saving…</p>}
      {err && <p className="text-[12px] text-[var(--color-red)]">{err}</p>}
    </div>
  );
}
