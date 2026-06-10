/* ============================================================================
   run2.jsx — v2 run page: stepper + accordion stage cards + sticky bottom
   action bar. Progressive disclosure: done stages collapse to summaries.
   Exposes RunV2.
   ============================================================================ */

const STAGE_DEFS = [
  { key: "stage1", id: "v2-stage-1", n: 1, title: "Research", what: "Product ID, market, avatar, offer one-pager" },
  { key: "stage2", id: "v2-stage-2", n: 2, title: "German copy", what: "Full DTC copy kit from the approved research" },
  { key: "stage3", id: "v2-stage-3", n: 3, title: "Images", what: "Hero shot first, then 8 derivatives" },
];

const stageActionable = (st) => ["running", "waiting", "error"].includes(st);

function v2Summary(run, key) {
  const o = run.outputs, s3 = run.stage3;
  if (key === "stage1") {
    if (!o.onePager) return null;
    return (run.brand_name ? run.brand_name + " · " : "") + "research one-pager" + (o.onePagerEdited ? " · edited" : "");
  }
  if (key === "stage2") {
    if (!o.stage2Output) return null;
    return "German copy kit · 8 blocks" + (o.stage2OutputEdited ? " · edited" : "");
  }
  if (run.status === "completed" && s3.images.length) {
    const pass = s3.images.filter((im) => (im.user_override ?? im.verdict) === "pass").length;
    return `hero + ${s3.images.length} images · ${pass} pass`;
  }
  return null;
}

/* ── one stage accordion card ─────────────────────────────────────────────*/
function StageCard({ def, state, open, onToggle, summary, children, isLast }) {
  const stateIcon = {
    complete: <span className="w-7 h-7 rounded-full grid place-items-center bg-[var(--color-green)] text-[var(--color-on-primary)] border-2 border-[var(--color-green)]"><Icon.Check className="w-3.5 h-3.5" strokeWidth={3} /></span>,
    running: <span className="w-7 h-7 rounded-full grid place-items-center bg-[var(--color-primary)] text-[var(--color-on-primary)] border-2 border-[var(--color-primary)] ring-pulse"><Icon.Loader className="w-3.5 h-3.5" /></span>,
    waiting: <span className="w-7 h-7 rounded-full grid place-items-center bg-[var(--color-amber)] text-white border-2 border-[var(--color-amber)] text-[12px] font-bold">!</span>,
    error: <span className="w-7 h-7 rounded-full grid place-items-center bg-[var(--color-red)] text-white border-2 border-[var(--color-red)]"><Icon.X className="w-3.5 h-3.5" strokeWidth={3} /></span>,
    pending: <span className="w-7 h-7 rounded-full grid place-items-center border-2 border-[var(--color-border-strong)] text-[var(--color-text-3)] text-[12px] font-bold bg-[var(--color-surface)]">{def.n}</span>,
  }[state];
  const stateLabel = { complete: "Done", running: "Running…", waiting: "Needs you", error: "Failed", pending: "Waiting" }[state];
  const stateColor = { complete: "text-[var(--color-green)]", running: "text-[var(--color-accent-text)]", waiting: "text-[var(--color-amber)]", error: "text-[var(--color-red)]", pending: "text-[var(--color-text-4)]" }[state];
  const canOpen = state !== "pending";
  return (
    <div id={def.id} className="relative scroll-mt-24">
      {!isLast && <div className="absolute left-[29px] top-[52px] bottom-[-14px] w-0.5 bg-[var(--color-border)]" aria-hidden="true" />}
      <Card className={window.cx("overflow-visible", open && "border-[var(--color-border-strong)]")}>
        <button onClick={() => canOpen && onToggle()} disabled={!canOpen}
          className={window.cx("w-full flex items-center gap-3.5 px-4 py-3.5 text-left tr rounded-[var(--radius)]", canOpen ? "cursor-pointer hover:bg-[var(--color-surface-2)]" : "cursor-default opacity-70")}>
          {stateIcon}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2.5 flex-wrap">
              <p className="text-[14.5px] font-[680] text-[var(--color-text)] whitespace-nowrap">{def.title}</p>
              <span className={window.cx("text-[11.5px] font-[620] whitespace-nowrap", stateColor)}>{stateLabel}</span>
            </div>
            <p className="text-[12px] text-[var(--color-text-3)] truncate mt-0.5">{summary || def.what}</p>
          </div>
          {canOpen && <Icon.ChevronRight className={window.cx("w-4 h-4 text-[var(--color-text-3)] transition-transform shrink-0", open && "rotate-90")} />}
        </button>
        {open && <div className="px-4 pb-5 pt-1 border-t border-[var(--color-border)] fade-in"><div className="pt-4 space-y-4">{children}</div></div>}
      </Card>
    </div>
  );
}

/* ── bottom sticky action bar ─────────────────────────────────────────────*/
function BottomBar({ run, engine, push, openStage }) {
  const a = window.nextAction(run, engine, push);
  const toneBar = { amber: "var(--color-amber)", red: "var(--color-red)", green: "var(--color-green)", accent: "var(--color-accent)" }[a.tone];
  const hasDocs = Boolean(run.outputs.onePager || run.outputs.stage2Output);
  const hasImages = Boolean(run.stage3.heroUrl || (run.stage3.images && run.stage3.images.length));
  // re-route stage-3 CTAs to open the stage-3 accordion
  const onClick = () => {
    if (["awaiting_user", "awaiting_hero_qc", "awaiting_qc"].includes(run.status)) { openStage("stage3"); }
    else if (run.status === "awaiting_stage2_approval") { engine.startStage2(); }
    else if (a.onClick) a.onClick();
  };
  const showPrimary = !a.running && run.status !== "completed";
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 px-4 pb-4 pointer-events-none">
      <div className="max-w-[880px] mx-auto pointer-events-auto">
        <div className="flex items-center gap-3 px-4 py-3 rounded-[var(--radius-lg)] border bg-[color-mix(in_srgb,var(--color-surface)_94%,transparent)] backdrop-blur-md shadow-[var(--shadow-pop)]"
          style={{ borderColor: `color-mix(in srgb, ${toneBar} 30%, var(--color-border))` }}>
          <span className="grid place-items-center w-8 h-8 rounded-full shrink-0 text-white" style={{ background: toneBar }}>
            {a.running ? <Icon.Loader className="w-4 h-4" /> : a.icon === "alert" ? <Icon.Alert className="w-4 h-4" /> : a.icon === "check" ? <Icon.Check className="w-4 h-4" strokeWidth={3} /> : a.icon === "image" ? <Icon.Image className="w-4 h-4" /> : <Icon.Spark className="w-4 h-4" />}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-[650] text-[var(--color-text)] truncate">{a.title}</p>
            {a.sub && <p className="text-[11.5px] text-[var(--color-text-2)] truncate">{a.sub}</p>}
          </div>
          {(hasDocs || hasImages) && (
            <div className="flex items-center gap-2 shrink-0">
              {hasDocs && (
                <Button variant="secondary" size="sm" onClick={() => push("Bundled research + copy → docs.zip", "success")}>
                  <Icon.Download className="w-3.5 h-3.5" /> Docs
                </Button>
              )}
              {hasImages && (
                <Button variant="secondary" size="sm" onClick={() => push("Bundled hero + images → images.zip", "success")}>
                  <Icon.Image className="w-3.5 h-3.5" /> Images
                </Button>
              )}
            </div>
          )}
          {a.running
            ? <Button variant="danger" size="sm" onClick={engine.kill}><Icon.Stop className="w-3 h-3" /> Kill</Button>
            : showPrimary && <Button onClick={onClick} className="shrink-0">{a.cta}<Icon.ArrowRight className="w-3.5 h-3.5" /></Button>}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════ RUN V2 ═════════════════════════════════════*/
function RunV2({ run, engine, patch, push, onBack }) {
  const [restarting, setRestarting] = useState(false);
  const [overrides, setOverrides] = useState({});
  const o = run.outputs;
  const displayName = run.brand_name || run.product_name || `Run #${run.id}`;
  const elapsed = elapsedTime(run.startedAt, run.completedAt);

  // reset manual open/close when pipeline state changes
  useEffect(() => { setOverrides({}); }, [run.status]);

  const states = {
    stage1: window.getStageState(run, "stage1"),
    stage2: window.getStageState(run, "stage2"),
    stage3: window.getStageState(run, "stage3"),
  };
  // the approval gate after research belongs on Stage 1 — that's what needs review
  if (run.status === "awaiting_stage2_approval") { states.stage1 = "waiting"; states.stage2 = "pending"; }
  // completed runs: open stage 3 by default (the deliverable)
  const autoOpen = (key) => stageActionable(states[key]) || (run.status === "completed" && key === "stage3");
  const isOpen = (key) => overrides[key] !== undefined ? overrides[key] : autoOpen(key);
  const toggle = (key) => setOverrides((p) => ({ ...p, [key]: !isOpen(key) }));
  const openStage = (key) => {
    setOverrides((p) => ({ ...p, [key]: true }));
    setTimeout(() => document.getElementById("v2-stage-" + key.slice(-1))?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };
  const doRestart = (stage) => { setRestarting(true); engine.restartStage(stage); setTimeout(() => setRestarting(false), 1000); };

  const present = {
    stage1: Boolean(o.onePager) || ["stage1", "scraping", "pending"].includes(run.status),
    stage2: Boolean(o.stage2Output) || run.status === "stage2" || Boolean(o.onePager),
    stage3: Boolean(o.stage2Output) || ["awaiting_user", "generating_hero", "awaiting_hero_qc", "generating_remaining", "awaiting_qc", "completed"].includes(run.status),
  };

  return (
    <div className="px-6 py-8 pb-32 max-w-[880px] mx-auto" data-screen-label="Run">
      {/* header */}
      <button onClick={onBack} className="cursor-pointer inline-flex items-center gap-1 text-[12px] text-[var(--color-text-3)] hover:text-[var(--color-text)] tr mb-4">
        <Icon.ArrowLeft className="w-3.5 h-3.5" /> Home
      </button>
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div className="min-w-0 flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-[var(--radius)] overflow-hidden shrink-0 border border-[var(--color-border)]">
            <MeshThumb m1={window.PD.MESH[run.id % 9][0]} m2={window.PD.MESH[run.id % 9][1]} className="w-full h-full" />
          </div>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2.5">
              <h1 className="text-[22px] font-bold tracking-tight ff-display text-[var(--color-text)] truncate">{displayName}</h1>
              <span className="ff-mono text-[11.5px] text-[var(--color-text-4)]">#{run.id}</span>
            </div>
            <p className="text-[12px] text-[var(--color-text-3)] truncate mt-0.5">{run.product_url ? truncateUrl(run.product_url, 56) : "Description-only run"}{elapsed ? ` · ${elapsed}` : ""}</p>
          </div>
        </div>
        <StatusBadge status={run.status} />
      </div>

      {/* live log while running */}
      <div className="mb-5"><LiveLog run={run} /></div>

      {/* stage accordion */}
      <div className="space-y-3.5">
        {STAGE_DEFS.filter((d) => present[d.key]).map((def, i, arr) => (
          <StageCard key={def.key} def={def} state={states[def.key]} open={isOpen(def.key)} onToggle={() => toggle(def.key)}
            summary={v2Summary(run, def.key)} isLast={i === arr.length - 1}>
            {def.key === "stage1" && (
              o.onePager ? (
                <>
                  <Card className="px-5 py-4 bg-[var(--color-surface-2)] border-[var(--color-border)]"><OnePagerMarkdown text={o.onePagerEdited ?? o.onePager} /></Card>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <StageActions stage="stage1" onRestart={doRestart} restarting={restarting} />
                    <AIRegenerate stage="stage1" initialFeedback={run.feedback.stage1Note} onRegenerated={() => push("Stage 1 regenerated", "success")} />
                  </div>
                  <div className="flex justify-end"><FeedbackButtons run={run} stage="stage1" patch={patch} /></div>
                </>
              ) : <Spinner label={run.current_step || "Researching the product…"} />
            )}
            {def.key === "stage2" && (
              o.stage2Output ? (
                <>
                  <EditableOutput run={run} patch={patch} label="German copy kit" push={push} />
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <AIRegenerate stage="stage2" initialFeedback={run.feedback.stage2Note} onRegenerated={() => push("Stage 2 regenerated", "success")} />
                    <FeedbackButtons run={run} stage="stage2" patch={patch} />
                  </div>
                  <StageActions stage="stage2" onRestart={doRestart} restarting={restarting} />
                </>
              ) : run.status === "stage2" ? <Spinner label="Generating German copy…" />
                : <p className="text-[12.5px] text-[var(--color-text-3)]">Runs automatically after you approve the research.</p>
            )}
            {def.key === "stage3" && (
              <>
                <Stage3Panel run={run} engine={engine} push={push} />
                <StageActions stage="stage3" onRestart={doRestart} restarting={restarting} />
              </>
            )}
          </StageCard>
        ))}
      </div>

      <BottomBar run={run} engine={engine} push={push} openStage={openStage} />
    </div>
  );
}

window.RunV2 = RunV2;
