"use client";

// Angles gate, built to be scanned: one row per angle (title, ground badge,
// problem in one line), expand for the detail, tick to select. First tick is
// the primary angle; the rest are supporting. Own angles via "Write my own".

import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/Toasts";
import { parseAngles, parseSelectedAngles, type Angle } from "@/lib/angles";
import type { RunStatus } from "@/hooks/useRunPolling";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

const FIELDS: { key: keyof Angle; label: string; rows: number; hint: string }[] = [
  { key: "problem", label: "Problem", rows: 2, hint: "The specific problem, in the customer's world" },
  { key: "consequence", label: "Stakes", rows: 2, hint: "What happens if it stays unsolved" },
  { key: "mechanism", label: "Why it works", rows: 2, hint: "Cause and effect, not features" },
  { key: "who", label: "Who", rows: 1, hint: "A specific person" },
  { key: "hook", label: "Hook", rows: 1, hint: "One opening line" },
  { key: "competitor_angle", label: "Competitors say", rows: 2, hint: "What they lead with" },
  { key: "gap", label: "Gap", rows: 2, hint: "Why this ground is open" },
];

const EMPTY: Angle = { id: "", title: "", problem: "", consequence: "", mechanism: "", who: "", hook: "", why_this_angle: "" };

const inputCls = "w-full border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] rounded-[6px] px-2.5 py-2 text-[12.5px] leading-[1.5] resize-y outline-none focus:border-[var(--color-border-strong)] placeholder:text-[var(--color-text-3)]";


function AngleForm({ value, onChange }: { value: Angle; onChange: (a: Angle) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <input value={value.title} onChange={(e) => onChange({ ...value, title: e.target.value })} placeholder="Short name" className={cx(inputCls, "col-span-2 font-[620] text-[13px]")} />
      {FIELDS.map((f) => (
        <label key={f.key} className={cx("block", f.rows > 1 && "col-span-2")}>
          <span className="ff-mono text-[9.5px] uppercase tracking-widest text-[var(--color-text-4)]">{f.label}</span>
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
  const [openId, setOpenId] = useState<string | null>(null);
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
    try { await patch({ product_angle_selected: next.length ? JSON.stringify(next) : null }); setSelected(next); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save"); }
    finally { setBusy(null); }
  }
  function toggle(a: Angle) {
    if (!editable) return;
    const on = selected.some((s) => s.id === a.id);
    saveSelection(on ? selected.filter((s) => s.id !== a.id) : [...selected, a]);
  }
  function makePrimary(id: string) {
    const a = selected.find((s) => s.id === id);
    if (a) saveSelection([a, ...selected.filter((s) => s.id !== id)]);
  }
  function updateAngle(id: string, next: Angle) {
    setSelected((p) => p.map((s) => (s.id === id ? next : s)));
    setProposed((p) => p.map((s) => (s.id === id ? next : s)));
  }
  async function persistEdits() {
    setBusy("save"); setErr(null);
    try { await patch({ product_angle_selected: selected.length ? JSON.stringify(selected) : null, product_angles: JSON.stringify(proposed) }); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save"); }
    finally { setBusy(null); }
  }
  async function addCustom() {
    if (!custom) return;
    if (custom.title.trim().length < 3 || custom.problem.trim().length < 10) { setErr("Needs a name and a problem."); return; }
    const a: Angle = { ...custom, id: `custom-${Date.now().toString(36)}`, why_this_angle: custom.why_this_angle || "Operator's own angle." };
    const nextProposed = [...proposed, a]; const nextSelected = [...selected, a];
    setBusy("save"); setErr(null);
    try {
      await patch({ product_angles: JSON.stringify(nextProposed), product_angle_selected: JSON.stringify(nextSelected) });
      setProposed(nextProposed); setSelected(nextSelected); setCustom(null);
      push("Angle added", "success");
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save"); }
    finally { setBusy(null); }
  }
  async function generate() {
    setBusy("generate"); setErr(null);
    try {
      const res = await fetch(`/api/runs/${runId}/angles`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }) });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? `HTTP ${res.status}`);
      const own = proposed.filter((a) => a.id.startsWith("custom-"));
      const nextProposed = [...(data.angles as Angle[]), ...own];
      const nextSelected = selected.filter((a) => a.id.startsWith("custom-"));
      await patch({ product_angles: JSON.stringify(nextProposed), product_angle_selected: nextSelected.length ? JSON.stringify(nextSelected) : null });
      setProposed(nextProposed); setSelected(nextSelected); setNote(""); setOpenId(null);
      push(`${data.angles.length} angles`, "success");
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't generate"); }
    finally { setBusy(null); }
  }

  const selectedIds = new Set(selected.map((s) => s.id));
  const order = (a: Angle) => { const i = selected.findIndex((s) => s.id === a.id); return i < 0 ? 99 : i; };
  const rows = [...proposed].sort((x, y) => order(x) - order(y));

  const textBtn = "cursor-pointer text-[11.5px] text-[var(--color-text-2)] hover:text-[var(--color-text)] tr disabled:opacity-50";
  const groundTone = (c?: Angle["crowding"]) =>
    c === "open" ? "var(--color-green)" : c === "crowded" ? "var(--color-red)" : "var(--color-amber)";
  const groundWord = (c?: Angle["crowding"]) => (c === "open" ? "open ground" : c === "crowded" ? "crowded" : "partly claimed");

  return (
    <div className="flex flex-col gap-2">
      {editable && custom && (
        <div className="border border-[var(--color-accent)] rounded-[9px] bg-[var(--color-surface)] px-[13px] py-3 flex flex-col gap-2.5">
          <AngleForm value={custom} onChange={setCustom} />
          <div className="flex items-center gap-3.5">
            <button onClick={addCustom} disabled={busy !== null}
              className="cursor-pointer h-[30px] px-3 rounded-[6px] bg-[var(--color-primary)] text-[var(--color-on-primary)] text-[12.5px] font-[500] hover:opacity-90 tr">Add &amp; select</button>
            <button onClick={() => setCustom(null)} className={textBtn}>Cancel</button>
          </div>
        </div>
      )}

      {rows.length === 0 && !custom && (
        <p className="text-[12.5px] text-[var(--color-text-2)] py-6">No angles yet.</p>
      )}

      {rows.map((a) => {
        const on = selectedIds.has(a.id);
        const idx = selected.findIndex((s) => s.id === a.id);
        const open = openId === a.id;
        const own = a.id.startsWith("custom-");
        return (
          <div key={a.id} className="rounded-[9px] border bg-[var(--color-surface)] overflow-hidden tr"
            style={{ borderColor: on ? "var(--color-accent)" : "var(--color-border)" }}>
            <div className="grid gap-3 items-start px-[13px] py-3" style={{ gridTemplateColumns: "20px minmax(0,1fr) auto" }}>
              <button disabled={!editable || busy !== null} onClick={() => toggle(a)} aria-label={on ? "Deselect" : "Select"}
                className={cx("w-[17px] h-[17px] mt-px rounded-[4px] border grid place-items-center text-[10px] tr", editable ? "cursor-pointer" : "cursor-default")}
                style={{ borderColor: on ? "var(--color-accent)" : "var(--color-border-strong)", background: on ? "var(--color-accent)" : "transparent", color: "var(--color-on-primary)" }}>
                {on ? "✓" : ""}
              </button>
              <div className="min-w-0">
                <div className="flex items-baseline gap-[9px] flex-wrap">
                  <span className="text-[14px] font-[600] text-[var(--color-text)]">{a.title}</span>
                  {on && (
                    <span className="ff-mono text-[9.5px] uppercase tracking-[0.04em] px-1.5 py-0.5 rounded-[4px]"
                      style={idx === 0
                        ? { background: "var(--color-accent)", color: "var(--color-on-primary)" }
                        : { background: "var(--color-surface-2)", color: "var(--color-text-2)" }}>
                      {idx === 0 ? "primary" : "supporting"}
                    </span>
                  )}
                  {own
                    ? <span className="ff-mono text-[9.5px] uppercase tracking-[0.04em] px-1.5 py-0.5 rounded-[4px] border border-[var(--color-border-strong)] text-[var(--color-text-3)]">yours</span>
                    : a.crowding && <span className="text-[11px]" style={{ color: groundTone(a.crowding) }}>{groundWord(a.crowding)}</span>}
                </div>
                <p className="text-[13px] text-[var(--color-text-2)] mt-1 leading-[1.5]">{a.problem}</p>

                {open && (
                  <>
                    {editingId === a.id ? (
                      <div className="mt-3 pt-3 border-t border-[var(--color-border)]" onBlur={persistEdits}><AngleForm value={a} onChange={(next) => updateAngle(a.id, next)} /></div>
                    ) : (
                      <div className="grid gap-x-3.5 gap-y-[7px] mt-3 pt-3 border-t border-[var(--color-border)] text-[12.5px] leading-[1.5]"
                        style={{ gridTemplateColumns: "110px minmax(0,1fr)" }}>
                        {a.consequence && <><span className="text-[var(--color-text-3)]">Stakes</span><span className="text-[var(--color-text)]">{a.consequence}</span></>}
                        {a.mechanism && <><span className="text-[var(--color-text-3)]">Mechanism</span><span className="text-[var(--color-text)]">{a.mechanism}</span></>}
                        {a.who && <><span className="text-[var(--color-text-3)]">Feels it most</span><span className="text-[var(--color-text)]">{a.who}</span></>}
                        {a.hook && <><span className="text-[var(--color-text-3)]">Hook</span><span className="text-[var(--color-text)] italic">“{a.hook}”</span></>}
                        {a.competitor_angle && <><span className="text-[var(--color-text-3)]">They say</span><span className="text-[var(--color-text)]">{a.competitor_angle}</span></>}
                        {a.gap && <><span className="text-[var(--color-text-3)]">Gap taken</span><span className="text-[var(--color-text)]">{a.gap}</span></>}
                      </div>
                    )}
                    {editable && (
                      <div className="flex gap-3.5 mt-3">
                        <button onClick={() => setEditingId(editingId === a.id ? null : a.id)} className={textBtn}>{editingId === a.id ? "Done" : "Edit wording"}</button>
                        {on && idx > 0 && <button onClick={() => makePrimary(a.id)} className={textBtn}>Make primary</button>}
                      </div>
                    )}
                  </>
                )}
              </div>
              <button onClick={() => setOpenId(open ? null : a.id)} className="cursor-pointer text-[11.5px] text-[var(--color-text-3)] hover:text-[var(--color-text)] pt-0.5 tr">
                {open ? "▴" : "▾"}
              </button>
            </div>
          </div>
        );
      })}

      {editable && (
        <div className="flex items-center gap-4 px-0.5 py-1 text-[12px]">
          {!custom && <button onClick={() => setCustom({ ...EMPTY })} className={textBtn}>Write my own</button>}
          <button onClick={generate} disabled={busy !== null} className={textBtn}>{busy === "generate" ? "Thinking…" : rows.length ? "New angles…" : "Propose angles"}</button>
          {rows.length > 0 && (
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Steer the next set"
              className="w-[220px] h-[26px] px-2.5 rounded-[6px] bg-[var(--color-surface)] border border-[var(--color-border)] text-[12px] text-[var(--color-text)] outline-none focus:border-[var(--color-border-strong)] placeholder:text-[var(--color-text-3)]" />
          )}
          <div className="flex-1" />
          {(busy === "save" || err) && <span className={cx("text-[11px]", err ? "text-[var(--color-red)]" : "text-[var(--color-text-3)]")}>{err ?? "Saving…"}</span>}
        </div>
      )}
    </div>
  );
}
