"use client";

// Angles gate, built to be scanned: one row per angle (title, ground badge,
// problem in one line), expand for the detail, tick to select. First tick is
// the primary angle; the rest are supporting. Own angles via "Write my own".

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
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

const inputCls = "w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-[var(--radius-sm)] px-3 py-2 text-[12.5px] leading-relaxed resize-y focus:outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-text-4)]";
const btn = "cursor-pointer inline-flex items-center gap-[7px] rounded-[var(--radius-sm)] px-3 py-[6px] text-[12px] font-[620] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] tr hover:border-[var(--color-text-3)] hover:bg-[var(--color-surface-2)] disabled:opacity-50 whitespace-nowrap";
const primaryBtn = "cursor-pointer inline-flex items-center gap-[7px] rounded-[var(--radius-sm)] px-[13px] py-[7px] text-[12.5px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] border border-transparent tr hover:brightness-110 disabled:opacity-60 whitespace-nowrap";

function Ground({ c }: { c?: Angle["crowding"] }) {
  if (!c) return null;
  const cls = c === "open" ? "bg-[var(--color-green-bg)] text-[var(--color-green)]"
    : c === "crowded" ? "bg-[var(--color-red-bg)] text-[var(--color-red)]"
    : "bg-[var(--color-amber-bg)] text-[var(--color-amber)]";
  return <span className={cx("text-[9.5px] font-[700] uppercase tracking-wider px-1.5 py-0.5 rounded whitespace-nowrap", cls)}>{c === "open" ? "Open" : c === "crowded" ? "Crowded" : "Partly claimed"}</span>;
}

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

function Detail({ a }: { a: Angle }) {
  const row = (label: string, v?: string) => v ? (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-2 text-[12px] leading-relaxed">
      <span className="ff-mono text-[9.5px] uppercase tracking-widest text-[var(--color-text-4)] pt-[3px]">{label}</span>
      <span className="text-[var(--color-text-2)]">{v}</span>
    </div>
  ) : null;
  return (
    <div className="space-y-1.5 pt-2">
      {row("Problem", a.problem)}
      {row("Stakes", a.consequence)}
      {row("Why it works", a.mechanism)}
      {row("Who", a.who)}
      {row("Hook", a.hook)}
      {row("Competitors", a.competitor_angle)}
      {row("Gap", a.gap)}
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

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center justify-between gap-3 mb-2 shrink-0">
        <p className="eyebrow">Angles · {selected.length ? `${selected.length} chosen` : "pick one or more"}</p>
        {editable && (
          <div className="flex items-center gap-2">
            {proposed.length > 0 && (
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Steer (optional)"
                className="w-[180px] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-[var(--radius-sm)] px-2.5 py-[5px] text-[12px] focus:outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-text-4)]" />
            )}
            <button onClick={generate} disabled={busy !== null} className={proposed.length ? btn : primaryBtn}>
              {busy === "generate" ? <Icon.Loader className="w-3.5 h-3.5" /> : proposed.length ? <Icon.Refresh className="w-3.5 h-3.5" /> : <Icon.Spark className="w-3.5 h-3.5" />}
              {busy === "generate" ? "Thinking…" : proposed.length ? "New angles" : "Propose angles"}
            </button>
            {!custom && <button onClick={() => setCustom({ ...EMPTY })} className={btn}>Write my own</button>}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1">
        {editable && custom && (
          <div className="border border-[var(--color-accent)] rounded-[var(--radius)] bg-[var(--color-surface)] px-3 py-3 space-y-2">
            <AngleForm value={custom} onChange={setCustom} />
            <div className="flex items-center gap-2">
              <button onClick={addCustom} disabled={busy !== null} className={primaryBtn}>Add &amp; select</button>
              <button onClick={() => setCustom(null)} className={btn}>Cancel</button>
            </div>
          </div>
        )}

        {rows.length === 0 && !custom && (
          <p className="text-[12.5px] text-[var(--color-text-3)] py-6 text-center">No angles yet.</p>
        )}

        {rows.map((a) => {
          const on = selectedIds.has(a.id);
          const idx = selected.findIndex((s) => s.id === a.id);
          const open = openId === a.id;
          const own = a.id.startsWith("custom-");
          return (
            <div key={a.id} className={cx("rounded-[var(--radius)] border px-3 py-2 tr", on ? "border-[var(--color-accent)] bg-[var(--color-accent-weak)]" : "border-[var(--color-border)] bg-[var(--color-surface)]")}>
              <div className="flex items-start gap-2.5">
                <button disabled={!editable || busy !== null} onClick={() => toggle(a)} aria-label={on ? "Deselect" : "Select"}
                  className={cx("mt-[3px] w-4.5 h-4.5 w-[18px] h-[18px] rounded-[5px] grid place-items-center shrink-0 border-2", editable ? "cursor-pointer" : "cursor-default",
                    on ? "bg-[var(--color-accent)] border-[var(--color-accent)] text-white" : "border-[var(--color-border-strong)]")}>
                  {on && <Icon.Check className="w-3 h-3" strokeWidth={3} />}
                </button>
                <button onClick={() => setOpenId(open ? null : a.id)} className="cursor-pointer flex-1 min-w-0 text-left">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-[680] text-[var(--color-text)]">{a.title}</span>
                    {on && <span className="text-[9.5px] font-[700] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--color-accent)] text-white">{idx === 0 ? "Primary" : "Supporting"}</span>}
                    {own ? <span className="text-[9.5px] font-[700] uppercase tracking-wider px-1.5 py-0.5 rounded border border-[var(--color-border-strong)] text-[var(--color-text-3)]">Yours</span> : <Ground c={a.crowding} />}
                  </div>
                  {!open && <p className="text-[12px] text-[var(--color-text-2)] truncate mt-0.5">{a.problem}</p>}
                </button>
                <Icon.ChevronRight className={cx("w-4 h-4 text-[var(--color-text-3)] shrink-0 mt-[3px] transition-transform", open && "rotate-90")} />
              </div>
              {open && (
                <div className="pl-[28px]">
                  {editingId === a.id ? (
                    <div className="pt-2" onBlur={persistEdits}><AngleForm value={a} onChange={(next) => updateAngle(a.id, next)} /></div>
                  ) : <Detail a={a} />}
                  {editable && (
                    <div className="flex items-center gap-3 pt-2">
                      {on && idx > 0 && <button onClick={() => makePrimary(a.id)} className="cursor-pointer text-[11.5px] text-[var(--color-text-3)] hover:text-[var(--color-text)] underline decoration-dotted underline-offset-2 tr">Make primary</button>}
                      <button onClick={() => setEditingId(editingId === a.id ? null : a.id)} className="cursor-pointer text-[11.5px] text-[var(--color-text-3)] hover:text-[var(--color-text)] underline decoration-dotted underline-offset-2 tr">{editingId === a.id ? "Done" : "Edit"}</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {(busy === "save" || err) && <p className={cx("text-[11px] mt-1.5 shrink-0", err ? "text-[var(--color-red)]" : "text-[var(--color-text-4)]")}>{err ?? "Saving…"}</p>}
    </div>
  );
}
