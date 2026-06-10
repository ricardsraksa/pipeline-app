/* ============================================================================
   rundetail.jsx — Run detail view: animated pipeline, stage outputs, QC gates,
   feedback, AI-regenerate, inline edit, Stage 3 hero→8 flow. Exposes RunDetail.
   ============================================================================ */

/* ── one-pager markdown (headings, lists, paragraphs) ─────────────────────*/
function OnePagerMarkdown({ text }) {
  const lines = (text || "").split("\n");
  const blocks = []; let list = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.type;
    blocks.push(<Tag key={"l" + blocks.length} className={list.type === "ol" ? "list-decimal pl-5 space-y-1.5" : "list-disc pl-5 space-y-1.5"}>
      {list.items.map((it, i) => <li key={i} className="text-[13px] text-[var(--color-text-2)] leading-relaxed">{it}</li>)}
    </Tag>); list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flush(); continue; }
    const h1 = line.match(/^# +(.+)$/), h2 = line.match(/^## +(.+)$/), ol = line.match(/^\d+\.\s+(.+)$/), ul = line.match(/^[-*]\s+(.+)$/);
    if (h1) { flush(); blocks.push(<h1 key={"h" + blocks.length} className="text-[20px] font-bold tracking-tight ff-display text-[var(--color-text)] mb-1">{h1[1]}</h1>); }
    else if (h2) { flush(); blocks.push(<h2 key={"h" + blocks.length} className="eyebrow text-[var(--color-text-3)] block mt-5 mb-2">{h2[1]}</h2>); }
    else if (ol) { if (!list || list.type !== "ol") { flush(); list = { type: "ol", items: [] }; } list.items.push(ol[1]); }
    else if (ul) { if (!list || list.type !== "ul") { flush(); list = { type: "ul", items: [] }; } list.items.push(ul[1]); }
    else { flush(); blocks.push(<p key={"p" + blocks.length} className="text-[13px] text-[var(--color-text-2)] leading-relaxed">{line}</p>); }
  }
  flush();
  return <div className="space-y-1">{blocks}</div>;
}

/* ── section wrapper ──────────────────────────────────────────────────────*/
function Section({ id, label, count, accent, children }) {
  return (
    <section id={id} className="space-y-3 scroll-mt-6">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className={window.cx("w-1.5 h-1.5 rounded-full", accent ? "bg-[var(--color-accent)]" : "bg-[var(--color-text-4)]")} />
          <h2 className="eyebrow text-[var(--color-text-2)]">{label}</h2>
        </div>
        {typeof count === "number" && <span className="ff-mono text-[11px] text-[var(--color-text-4)]">{count} {count === 1 ? "doc" : "docs"}</span>}
        <div className="bg-[var(--color-border)] h-px flex-1" />
      </div>
      {children}
    </section>
  );
}

/* ── animated 3-node pipeline + live log ──────────────────────────────────*/
function PipelineProgress({ run }) {
  const stages = [{ key: "stage1", label: "Research" }, { key: "stage2", label: "Copy" }, { key: "stage3", label: "Images" }];
  const active = !["completed", "failed", "cancelled", "awaiting_user", "awaiting_qc", "awaiting_stage2_approval", "awaiting_hero_qc"].includes(run.status);
  const logRef = useRef(null);
  const log = run.log || [];
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log.length]);

  const node = (state, idx) => {
    const cls = {
      complete: "bg-[var(--color-green)] text-[var(--color-on-primary)] border-[var(--color-green)]",
      running: "bg-[var(--color-primary)] text-[var(--color-on-primary)] border-[var(--color-primary)] ring-pulse",
      error: "bg-[var(--color-red)] text-white border-[var(--color-red)]",
      waiting: "bg-[var(--color-amber)] text-white border-[var(--color-amber)]",
      pending: "border-[var(--color-border-strong)] text-[var(--color-text-3)]",
    }[state];
    return (
      <span className={window.cx("w-9 h-9 rounded-full grid place-items-center font-bold text-sm border-2 tr", cls)}>
        {state === "complete" ? <span className="pop-in"><Icon.Check className="w-4 h-4" strokeWidth={3} /></span>
          : state === "running" ? <Icon.Loader className="w-4 h-4" />
          : state === "error" ? <Icon.X className="w-4 h-4" strokeWidth={3} />
          : state === "waiting" ? <span className="text-sm">!</span>
          : <span className="text-sm">{idx + 1}</span>}
      </span>
    );
  };

  return (
    <Card className="px-5 py-4">
      <div className="flex items-center gap-1">
        {stages.map((s, i) => {
          const state = window.getStageState(run, s.key);
          const labelCls = { pending: "text-[var(--color-text-3)]", running: "text-[var(--color-accent)]", error: "text-[var(--color-red)]", waiting: "text-[var(--color-amber)]", complete: "text-[var(--color-text)]" }[state];
          return (
            <div key={s.key} className="flex items-center flex-1 min-w-0 last:flex-initial">
              <button onClick={() => document.getElementById(`stage-${i + 1}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                title={`Jump to ${s.label}`}
                className="flex flex-col items-center gap-1.5 cursor-pointer group bg-transparent border-0 p-0">
                <span className="tr group-hover:scale-110">{node(state, i)}</span>
                <span className={window.cx("text-[11px] font-[550] whitespace-nowrap group-hover:text-[var(--color-text)] tr", labelCls)}>{s.label}</span>
              </button>
              {i < stages.length - 1 && (
                <div className="flex-1 h-0.5 mx-3 rounded-full bg-[var(--color-border-strong)] overflow-hidden" style={{ marginBottom: 18 }}>
                  <div className="h-full bg-[var(--color-green)] origin-left tr" style={{ transform: `scaleX(${state === "complete" ? 1 : 0})`, transition: "transform .5s ease" }} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {active && log.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
          <div ref={logRef} className="rounded-[var(--radius-sm)] bg-[var(--color-bg)] border border-[var(--color-border)] px-3 py-2.5 max-h-[112px] overflow-y-auto ff-mono text-[11px] leading-[1.7]">
            {log.slice(-6).map((l, i, arr) => {
              const last = i === arr.length - 1;
              return (
                <div key={l.k} className={window.cx("log-line flex gap-2", last ? "text-[var(--color-text)]" : "text-[var(--color-text-3)]")}>
                  <span className="text-[var(--color-accent)] shrink-0">{last ? "›" : " "}</span>
                  <span className={last ? "caret" : ""}>{l.t}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

/* ── feedback (thumbs + note) ─────────────────────────────────────────────*/
function FeedbackButtons({ run, stage, patch }) {
  const vote = run.feedback[stage];
  const note = run.feedback[stage + "Note"] || "";
  const [saving, setSaving] = useState(false);
  const setVote = (v) => patch({ feedback: { ...run.feedback, [stage]: vote === v ? null : v } });
  const setNote = (t) => { patch({ feedback: { ...run.feedback, [stage + "Note"]: t } }); setSaving(true); clearTimeout(setNote._t); setNote._t = setTimeout(() => setSaving(false), 700); };
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[12px] text-[var(--color-text-3)] mr-1">Was this useful?</span>
        <button onClick={() => setVote("up")} title="Mark useful"
          className={window.cx("cursor-pointer inline-flex items-center justify-center w-7 h-7 rounded-md border tr", vote === "up" ? "border-[var(--color-green)] bg-[var(--color-green-bg)] text-[var(--color-green)]" : "border-[var(--color-border)] text-[var(--color-text-3)] hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)]")}>
          <Icon.ThumbsUp className="w-[14px] h-[14px]" />
        </button>
        <button onClick={() => setVote("down")} title="Mark not useful"
          className={window.cx("cursor-pointer inline-flex items-center justify-center w-7 h-7 rounded-md border tr", vote === "down" ? "border-[var(--color-red)] bg-[var(--color-red-bg)] text-[var(--color-red)]" : "border-[var(--color-border)] text-[var(--color-text-3)] hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)]")}>
          <Icon.ThumbsDown className="w-[14px] h-[14px]" />
        </button>
      </div>
      {(vote !== null || note) && (
        <div className="w-full max-w-xs fade-in">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
            placeholder={vote === "down" ? "What was wrong? (guides future runs)" : "What to lean into next time? (optional)"}
            className="w-full text-[12px] text-[var(--color-text)] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md px-2 py-1.5 placeholder:text-[var(--color-text-4)] focus:outline-none focus:border-[var(--color-accent)] resize-y" />
          {saving && <p className="text-[10px] ff-mono text-[var(--color-text-4)] mt-0.5">Saving…</p>}
        </div>
      )}
    </div>
  );
}

/* ── AI regenerate panel ──────────────────────────────────────────────────*/
const STAGE_HINTS = {
  stage1: "e.g. Add more technical detail about the cradle, or focus benefits on long-term outcomes.",
  stage2: "e.g. Make the tone warmer and less technical, or shorten the hero headline.",
  "stage3-prompts": "e.g. Use darker backgrounds and add rim lighting to all contextual shots.",
};
function AIRegenerate({ stage, initialFeedback, onRegenerated }) {
  const [open, setOpen] = useState(false);
  const [instr, setInstr] = useState(initialFeedback || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => { if (open) setInstr(initialFeedback || ""); }, [open]);
  const go = () => {
    if (instr.trim().length < 5) { setErr("Instructions must be at least 5 characters"); return; }
    setBusy(true); setErr(null);
    setTimeout(() => { setBusy(false); setOpen(false); setInstr(""); onRegenerated(); }, 1500);
  };
  if (!open) return (
    <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
      <Icon.Spark className="w-3.5 h-3.5 text-[var(--color-accent)]" /> Edit with AI
    </Button>
  );
  return (
    <div className="border border-[var(--color-border)] rounded-[var(--radius)] bg-[var(--color-accent-weak)] px-4 py-3.5 fade-in space-y-2.5 w-full max-w-xl">
      <div className="flex items-start justify-between gap-2">
        <Eyebrow className="flex items-center gap-1.5 text-[var(--color-accent-text)]"><Icon.Spark className="w-3.5 h-3.5 text-[var(--color-accent)]" /> Tell Claude what to change</Eyebrow>
        <button onClick={() => { setOpen(false); setErr(null); }} disabled={busy} className="cursor-pointer text-[var(--color-text-3)] hover:text-[var(--color-text)] disabled:opacity-40"><Icon.X className="w-3.5 h-3.5" /></button>
      </div>
      <textarea value={instr} onChange={(e) => setInstr(e.target.value)} placeholder={STAGE_HINTS[stage]} rows={3} autoFocus disabled={busy}
        className="w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-[var(--radius-sm)] px-[13px] py-[11px] text-sm focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)] resize-y disabled:opacity-50" />
      {err && <p className="text-[11px] text-[var(--color-red)] flex items-center gap-1.5"><Icon.Alert className="w-3.5 h-3.5" />{err}</p>}
      <div className="flex items-center gap-2">
        <Button onClick={go} disabled={busy || instr.trim().length < 5}>
          {busy ? (<><Icon.Loader className="w-3.5 h-3.5" /> Regenerating…</>) : (<><Icon.Spark className="w-3.5 h-3.5" /> Regenerate</>)}
        </Button>
        <Button variant="secondary" onClick={() => { setOpen(false); setErr(null); }} disabled={busy}>Cancel</Button>
        <p className="ml-auto ff-mono text-[10px] text-[var(--color-text-3)] hidden sm:block">Replaces current edits</p>
      </div>
    </div>
  );
}

/* ── inline-editable output (Stage 2 copy) ────────────────────────────────*/
function EditableOutput({ run, patch, label, push }) {
  const original = run.outputs.stage2Output;
  const edited = run.outputs.stage2OutputEdited;
  const display = edited ?? original;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const isEdited = edited != null;
  const save = () => { patch({ outputs: { ...run.outputs, stage2OutputEdited: draft, stage2EditedAt: new Date().toISOString() } }); setEditing(false); push("Saved your edits", "success"); };
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
        <div className="flex items-center gap-2">
          <Eyebrow>{label}</Eyebrow>
          {isEdited && !editing && <span className="inline-flex items-center text-xs font-[620] px-2.5 py-0.5 rounded-full bg-[var(--color-amber-bg)] text-[var(--color-amber)]">Edited</span>}
        </div>
        {!editing && (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => { navigator.clipboard?.writeText(display).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1400); }} className={copied ? "text-[var(--color-green)]" : ""}>{copied ? "Copied ✓" : "Copy"}</Button>
            <Button variant="ghost" size="sm" onClick={() => { setDraft(display); setEditing(true); }}><Icon.Pencil className="w-3 h-3" /> Edit</Button>
          </div>
        )}
      </div>
      <div className="p-4">
        {editing ? (
          <div className="space-y-3">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={14}
              className="w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-[var(--radius-sm)] px-[13px] py-[11px] text-[13px] focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)] resize-y" />
            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
              <Button size="sm" onClick={save}>Save</Button>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-[var(--radius-sm)] border border-[var(--color-border)] p-4 max-h-[520px] overflow-y-auto">
            <div className="whitespace-pre-wrap break-words" style={{ fontFamily: "Arial, Helvetica, sans-serif", fontSize: "11pt", color: "#000", lineHeight: 1.5 }}>{display}</div>
          </div>
        )}
      </div>
    </Card>
  );
}

/* ── per-stage back/restart row ───────────────────────────────────────────*/
function StageActions({ stage, prevLabel, prevId, onRestart, restarting }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {prevId && (
        <Button variant="secondary" size="sm" onClick={() => document.getElementById(prevId)?.scrollIntoView({ behavior: "smooth", block: "start" })}>
          <Icon.ArrowLeft className="w-3.5 h-3.5" /> Back to {prevLabel}
        </Button>
      )}
      <Button variant="secondary" size="sm" onClick={() => onRestart(stage)} disabled={restarting}>
        {restarting ? <Icon.Loader className="w-3.5 h-3.5" /> : <Icon.Refresh className="w-3.5 h-3.5" />} Restart {stage === "stage1" ? "Stage 1" : stage === "stage2" ? "Stage 2" : "Stage 3"}
      </Button>
    </div>
  );
}

/* ── sticky "what to do next" ribbon ──────────────────────────────────────*/
const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
function nextAction(run, engine, push) {
  const s = run.status, o = run.outputs;
  if (s === "awaiting_stage2_approval") return { tone: "amber", icon: "review", title: "Research ready for your review", sub: "Edit it if needed, then generate the German copy.", cta: "Run Stage 2", onClick: engine.startStage2 };
  if (s === "awaiting_user") return { tone: "amber", icon: "image", title: "Copy approved — ready for images", sub: "Generate a hero shot, then the 8 derivatives.", cta: "Go to Stage 3", onClick: () => scrollTo("stage-3") };
  if (s === "awaiting_hero_qc") return { tone: "amber", icon: "review", title: "Hero shot needs your approval", sub: "It becomes the reference for every other image.", cta: "Review hero", onClick: () => scrollTo("stage-3") };
  if (s === "awaiting_qc") return { tone: "amber", icon: "review", title: "8 prompts ready to review", sub: "Tweak any prompt, then generate the images.", cta: "Review prompts", onClick: () => scrollTo("stage-3") };
  if (s === "failed") return { tone: "red", icon: "alert", title: "Run failed" + (run.current_step ? ` at ${run.current_step}` : ""), sub: "Pick up from the last completed step — nothing is lost.", cta: "Resume pipeline", onClick: engine.resume };
  if (s === "cancelled") return { tone: "amber", icon: "alert", title: "Run cancelled", sub: "Resume to continue where it stopped.", cta: "Resume", onClick: engine.resume };
  if (s === "completed") return { tone: "green", icon: "check", title: "Run complete", sub: "All research, copy, and images are ready.", cta: "Download all", onClick: () => push("Bundled all docs + images → .zip", "success") };
  // active running
  return { tone: "accent", running: true, title: window.statusLabel(s), sub: run.current_step || "Working…" };
}
function NextActionBar({ run, engine, push }) {
  const a = nextAction(run, engine, push);
  const toneBar = { amber: "var(--color-amber)", red: "var(--color-red)", green: "var(--color-green)", accent: "var(--color-accent)" }[a.tone];
  const ic = a.running
    ? <Icon.Loader className="w-4 h-4" />
    : a.icon === "alert" ? <Icon.Alert className="w-4 h-4" />
    : a.icon === "image" ? <Icon.Image className="w-4 h-4" />
    : a.icon === "check" ? <Icon.Check className="w-4 h-4" strokeWidth={3} />
    : <Icon.Spark className="w-4 h-4" />;
  return (
    <div className="sticky top-[52px] z-30 -mx-1">
      <div className="flex items-center gap-3 px-4 py-3 rounded-[var(--radius)] border bg-[color-mix(in_srgb,var(--color-surface)_92%,transparent)] backdrop-blur-md shadow-[var(--shadow-card)]"
        style={{ borderColor: `color-mix(in srgb, ${toneBar} 28%, var(--color-border))` }}>
        <span className="grid place-items-center w-8 h-8 rounded-full shrink-0 text-white" style={{ background: toneBar }}>{ic}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-[620] text-[var(--color-text)] truncate">{a.title}</p>
          {a.sub && <p className="text-[11.5px] text-[var(--color-text-2)] truncate">{a.sub}</p>}
        </div>
        {a.running
          ? (!["completed", "failed", "cancelled"].includes(run.status) && <Button variant="danger" size="sm" onClick={engine.kill}><Icon.Stop className="w-3 h-3" /> Kill</Button>)
          : <Button size="sm" onClick={a.onClick} className="shrink-0">{a.cta}<Icon.ArrowRight className="w-3.5 h-3.5" /></Button>}
      </div>
    </div>
  );
}

/* ── live log panel (console feel during active runs) ─────────────────────*/
function LiveLog({ run }) {
  const active = !["completed", "failed", "cancelled", "awaiting_user", "awaiting_qc", "awaiting_stage2_approval", "awaiting_hero_qc"].includes(run.status);
  const log = run.log || [];
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [log.length]);
  if (!active || !log.length) return null;
  return (
    <Card className="overflow-hidden fade-in">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] pulse-dot" />
        <Eyebrow className="text-[var(--color-text-2)]">Live · {window.statusLabel(run.status)}</Eyebrow>
      </div>
      <div ref={ref} className="bg-[var(--color-bg)] px-4 py-3 max-h-[150px] overflow-y-auto ff-mono text-[11.5px] leading-[1.8]">
        {log.slice(-8).map((l, i, arr) => {
          const last = i === arr.length - 1;
          return (
            <div key={l.k} className={window.cx("log-line flex gap-2", last ? "text-[var(--color-text)]" : "text-[var(--color-text-3)]")}>
              <span className="text-[var(--color-accent)] shrink-0">{last ? "›" : "·"}</span>
              <span className={last ? "caret" : ""}>{l.t}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ── scroll-spy: which stage section is at the top ────────────────────────*/
function useActiveSection(ids) {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    const onScroll = () => {
      let cur = null;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= 160) cur = id;
      }
      setActive(cur || ids[0]);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
    // eslint-disable-next-line
  }, [ids.join(",")]);
  return active;
}

/* ── right-rail: vertical pipeline that doubles as jump nav ────────────────*/
const STATE_TEXT = { complete: "Complete", running: "Running…", waiting: "Needs you", error: "Failed", pending: "Pending" };
function StageRail({ run, active, hasAnyOutput, onDownload }) {
  const o = run.outputs;
  const stages = [
    { key: "stage1", id: "stage-1", label: "Research", present: Boolean(o.onePager) || ["stage1", "scraping", "pending"].includes(run.status) },
    { key: "stage2", id: "stage-2", label: "Copy", present: Boolean(o.stage2Output) || run.status === "stage2" },
    { key: "stage3", id: "stage-3", label: "Images", present: Boolean(o.stage2Output) || ["awaiting_user", "generating_hero", "awaiting_hero_qc", "generating_remaining", "awaiting_qc", "completed"].includes(run.status) },
  ];
  const jump = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const miniNode = (state, idx) => {
    const cls = {
      complete: "bg-[var(--color-green)] text-[var(--color-on-primary)] border-[var(--color-green)]",
      running: "bg-[var(--color-primary)] text-[var(--color-on-primary)] border-[var(--color-primary)] ring-pulse",
      error: "bg-[var(--color-red)] text-white border-[var(--color-red)]",
      waiting: "bg-[var(--color-amber)] text-white border-[var(--color-amber)]",
      pending: "bg-[var(--color-surface)] border-[var(--color-border-strong)] text-[var(--color-text-3)]",
    }[state];
    return (
      <span className={window.cx("relative z-10 w-7 h-7 rounded-full grid place-items-center font-bold text-[11px] border-2", cls)}>
        {state === "complete" ? <Icon.Check className="w-3.5 h-3.5" strokeWidth={3} />
          : state === "running" ? <Icon.Loader className="w-3 h-3" />
          : state === "error" ? <Icon.X className="w-3.5 h-3.5" strokeWidth={3} />
          : state === "waiting" ? <span>!</span> : <span>{idx + 1}</span>}
      </span>
    );
  };
  return (
    <Card className="p-3">
      <Eyebrow className="text-[var(--color-text-3)] px-1.5 pb-1 block">Pipeline</Eyebrow>
      <div className="relative">
        <div className="absolute left-[22px] top-7 bottom-7 w-0.5 bg-[var(--color-border-strong)]" />
        {stages.map((s, i) => {
          const state = window.getStageState(run, s.key);
          const isActive = active === s.id;
          return (
            <button key={s.key} onClick={() => s.present && jump(s.id)} disabled={!s.present}
              className={window.cx("relative flex items-center gap-3 w-full text-left rounded-[var(--radius-sm)] px-1.5 py-1.5 tr",
                isActive ? "bg-[var(--color-accent-weak)]" : s.present ? "hover:bg-[var(--color-surface-2)] cursor-pointer" : "opacity-50 cursor-default")}>
              {miniNode(state, i)}
              <div className="min-w-0">
                <p className={window.cx("text-[13px] font-[600] leading-tight whitespace-nowrap", isActive ? "text-[var(--color-accent-text)]" : "text-[var(--color-text)]")}>{s.label}</p>
                <p className={window.cx("text-[11px] leading-tight mt-0.5 whitespace-nowrap", state === "running" ? "text-[var(--color-accent)]" : state === "waiting" ? "text-[var(--color-amber)]" : state === "error" ? "text-[var(--color-red)]" : state === "complete" ? "text-[var(--color-green)]" : "text-[var(--color-text-3)]")}>{STATE_TEXT[state]}</p>
              </div>
            </button>
          );
        })}
      </div>
      {hasAnyOutput && (
        <div className="mt-2 pt-2 border-t border-[var(--color-border)]">
          <button onClick={onDownload} className="w-full flex items-center gap-2.5 rounded-[var(--radius-sm)] px-1.5 py-2 text-[13px] font-[550] text-[var(--color-text-2)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] tr cursor-pointer whitespace-nowrap">
            <span className="w-7 grid place-items-center"><Icon.Download className="w-4 h-4" /></span>
            Download all (.zip)
          </button>
        </div>
      )}
    </Card>
  );
}

/* ── right-rail: run facts ────────────────────────────────────────────────*/
function FactsCard({ run }) {
  const rows = [
    ["Run", `#${run.id}`],
    ["Source", run.product_url ? truncateUrl(run.product_url, 26) : "Description only"],
    ["Images", `${run.sources?.length || 0} uploaded`],
    ["Started", relativeTime(run.startedAt)],
  ];
  return (
    <Card className="p-4">
      <Eyebrow className="text-[var(--color-text-3)] block mb-2.5">Run details</Eyebrow>
      <div className="space-y-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3">
            <span className="text-[12px] text-[var(--color-text-3)] shrink-0">{k}</span>
            <span className="ff-mono text-[11px] text-[var(--color-text-2)] text-right truncate">{v}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ════════════════════════════ RUN DETAIL ═════════════════════════════════*/
function RunDetail({ run, engine, patch, push, onBack }) {
  const [restarting, setRestarting] = useState(false);
  const [showInputs, setShowInputs] = useState(false);
  const o = run.outputs;
  const displayName = run.brand_name || run.product_name || `Run #${run.id}`;
  const elapsed = elapsedTime(run.startedAt, run.completedAt);
  const isTerminal = ["completed", "failed", "cancelled"].includes(run.status);
  const showResume = ["failed", "cancelled"].includes(run.status);
  const hasOnePager = Boolean(o.onePager);
  const hasAnyOutput = hasOnePager || o.stage2Output;

  const doRestart = (stage) => { setRestarting(true); engine.restartStage(stage); setTimeout(() => setRestarting(false), 1000); };
  const activeSection = useActiveSection(["stage-1", "stage-2", "stage-3"]);
  const downloadAll = () => push("Bundled all docs + images → .zip", "success");

  return (
    <div className="px-7 py-7 max-w-[1240px] mx-auto">
      {/* breadcrumb + header */}
      <div className="space-y-3 mb-5">
        <button onClick={onBack} className="cursor-pointer inline-flex items-center gap-1 text-[12px] text-[var(--color-text-3)] hover:text-[var(--color-text)] tr">
          <Icon.ArrowLeft className="w-3.5 h-3.5" /> Runs
        </button>
        <div className="min-w-0 flex items-start gap-3.5">
          <div className="w-12 h-12 rounded-[var(--radius)] overflow-hidden shrink-0 border border-[var(--color-border)]">
            <MeshThumb m1={window.PD.MESH[run.id % 9][0]} m2={window.PD.MESH[run.id % 9][1]} className="w-full h-full" />
          </div>
          <div className="min-w-0">
            <div className="flex items-baseline gap-3 mb-0.5">
              <h1 className="text-[24px] font-bold tracking-tight ff-display text-[var(--color-text)] truncate">{displayName}</h1>
              <span className="ff-mono text-[12px] text-[var(--color-text-4)]">#{run.id}</span>
            </div>
            {run.product_url ? (
              <a href={run.product_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-[var(--color-text-3)] hover:text-[var(--color-accent)] tr max-w-full truncate">
                <span className="truncate">{run.product_url}</span><Icon.ExternalLink className="w-3 h-3 shrink-0" />
              </a>
            ) : <span className="ff-mono text-[11px] text-[var(--color-text-4)]">Description-only run</span>}
          </div>
        </div>
      </div>

      {/* sticky next-action ribbon (full width) */}
      <NextActionBar run={run} engine={engine} push={push} />

      {/* two-pane: content + sticky rail */}
      <div className="grid lg:grid-cols-[minmax(0,1fr)_252px] gap-6 items-start mt-5">
        {/* ── content ── */}
        <div className="min-w-0 space-y-6 order-2 lg:order-1">
          <LiveLog run={run} />

          {/* submitted inputs (collapsible) */}
          {(run.product_description || run.sources?.length > 0) && (
            <Card className="overflow-hidden">
              <button onClick={() => setShowInputs((v) => !v)}
                className="w-full flex items-center gap-2 px-5 py-3 text-left hover:bg-[var(--color-surface-2)] tr cursor-pointer">
                <Icon.ChevronRight className={window.cx("w-3.5 h-3.5 text-[var(--color-text-3)] transition-transform", showInputs && "rotate-90")} />
                <Eyebrow className="text-[var(--color-text-2)]">Submitted inputs</Eyebrow>
                <span className="text-[12px] text-[var(--color-text-3)]">description · {run.sources?.length || 0} source image{run.sources?.length === 1 ? "" : "s"}</span>
              </button>
              {showInputs && (
                <div className="px-5 pb-5 space-y-3 fade-in">
                  {run.product_description && (
                    <div>
                      <Eyebrow className="block mb-1.5">Description</Eyebrow>
                      <p className="text-[13px] text-[var(--color-text-2)] leading-relaxed">{run.product_description}</p>
                    </div>
                  )}
                  {run.sources?.length > 0 && (
                    <div>
                      <Eyebrow className="block mb-1.5">Source images · {run.sources.length}</Eyebrow>
                      <div className="grid grid-cols-5 sm:grid-cols-6 gap-2">
                        {run.sources.map((s, i) => (
                          <div key={i} className="aspect-square rounded-[9px] overflow-hidden border border-[var(--color-border)]"><MeshThumb m1={s.m1} m2={s.m2} className="w-full h-full" /></div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}

          {/* scrape errors */}
          {run.status !== "pending" && run.scrapeErrors?.length > 0 && hasOnePager && (
            <Card className="px-4 py-3 bg-[var(--color-amber-bg)] border-[color-mix(in_srgb,var(--color-amber)_25%,transparent)] fade-in">
              <div className="flex items-start gap-2.5">
                <Icon.Alert className="w-4 h-4 text-[var(--color-amber)] shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-[12px] text-[var(--color-text)] font-[600] mb-1">{run.scrapeErrors.length} competitor URL couldn't be scraped</p>
                  {run.scrapeErrors.map((e, i) => (
                    <p key={i} className="ff-mono text-[10px] text-[var(--color-text-3)] truncate"><span className="text-[var(--color-text-2)]">{e.url}</span> · {e.error}</p>
                  ))}
                </div>
              </div>
            </Card>
          )}

          {/* ── Stage 1 ── */}
          {(hasOnePager || ["stage1", "scraping", "pending"].includes(run.status)) && (
            <Section id="stage-1" label="Stage 1 · Research summary" accent={run.status === "stage1"}>
              {hasOnePager ? (
                <>
                  <Card className="px-6 py-5"><OnePagerMarkdown text={o.onePagerEdited ?? o.onePager} /></Card>
                  <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
                    <StageActions stage="stage1" onRestart={doRestart} restarting={restarting} />
                    <AIRegenerate stage="stage1" initialFeedback={run.feedback.stage1Note} onRegenerated={() => push("Stage 1 regenerated", "success")} />
                  </div>
                  <div className="flex items-start justify-between gap-3 flex-wrap pt-1">
                    <span />
                    <FeedbackButtons run={run} stage="stage1" patch={patch} />
                  </div>
                  {run.status === "awaiting_stage2_approval" && (
                    <div className="mt-3 border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] border-l-4 border-l-[var(--color-amber)] rounded-[var(--radius)] px-[18px] py-4 flex items-center gap-4 flex-wrap fade-in">
                      <Icon.Alert className="w-4 h-4 text-[var(--color-amber)] shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] text-[var(--color-text)] font-[600]">Review the research summary above</p>
                        <p className="text-[12px] text-[var(--color-text-2)] mt-0.5">Edit it if needed, then run Stage 2 to generate the German copy.</p>
                      </div>
                      <Button onClick={engine.startStage2}>Looks good — run Stage 2 <Icon.ArrowRight className="w-3.5 h-3.5" /></Button>
                    </div>
                  )}
                </>
              ) : <Spinner label={run.current_step || "Researching the product…"} />}
            </Section>
          )}

          {/* ── Stage 2 ── */}
          {(o.stage2Output || run.status === "stage2") && (
            <Section id="stage-2" label="Stage 2 · German copy" accent={run.status === "stage2"}>
              {o.stage2Output ? (
                <>
                  <EditableOutput run={run} patch={patch} label="German copy kit" push={push} />
                  <div className="flex items-center justify-between pt-1 gap-3 flex-wrap">
                    <AIRegenerate stage="stage2" initialFeedback={run.feedback.stage2Note} onRegenerated={() => push("Stage 2 regenerated", "success")} />
                    <FeedbackButtons run={run} stage="stage2" patch={patch} />
                  </div>
                  <StageActions stage="stage2" prevLabel="Stage 1" prevId="stage-1" onRestart={doRestart} restarting={restarting} />
                </>
              ) : <Spinner label="Generating German copy…" />}
            </Section>
          )}

          {/* ── Stage 3 ── */}
          {(Boolean(o.stage2Output) || ["awaiting_user", "generating_hero", "awaiting_hero_qc", "generating_remaining", "awaiting_qc", "completed"].includes(run.status)) && (
            <Section id="stage-3" label="Stage 3 · Images" accent={["generating_hero", "generating_remaining"].includes(run.status)}>
              <Stage3Panel run={run} engine={engine} push={push} />
              <StageActions stage="stage3" prevLabel="Stage 2" prevId="stage-2" onRestart={doRestart} restarting={restarting} />
            </Section>
          )}
        </div>

        {/* ── sticky rail ── */}
        <aside className="order-1 lg:order-2 lg:sticky lg:top-[120px] space-y-3">
          <Card className="p-3.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <StatusBadge status={run.status} />
              {elapsed && <span className="ff-mono text-[11px] text-[var(--color-text-4)] whitespace-nowrap">{elapsed}</span>}
            </div>
            {!isTerminal && (
              <Button variant="danger" size="sm" onClick={engine.kill}><Icon.Stop className="w-3 h-3" /> Kill</Button>
            )}
          </Card>
          <StageRail run={run} active={activeSection} hasAnyOutput={hasAnyOutput} onDownload={downloadAll} />
          <FactsCard run={run} />
        </aside>
      </div>
    </div>
  );
}

window.RunDetail = RunDetail;
window.OnePagerMarkdown = OnePagerMarkdown;
Object.assign(window, { FeedbackButtons, AIRegenerate, EditableOutput, StageActions, LiveLog, Section, nextAction });
