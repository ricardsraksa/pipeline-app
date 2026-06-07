/* ============================================================================
   app.jsx — shell, routing, the prototype pipeline engine, render.
   ============================================================================ */

const DIRECTIONS = [
  { id: "signal", name: "Signal", tag: "Command-center" },
  { id: "atelier", name: "Atelier", tag: "Editorial" },
  { id: "grid", name: "Grid", tag: "Pro-tool" },
];
const rnd = () => Math.random().toString(36).slice(2);
const appendLog = (log, t) => [...(log || []), { k: rnd(), t }];

/* ── pipeline engine hook ─────────────────────────────────────────────────*/
function usePipelineEngine(setCurrentRun, syncList) {
  const timers = useRef([]);
  const clearTimers = () => { timers.current.forEach((id) => { clearInterval(id); clearTimeout(id); }); timers.current = []; };
  useEffect(() => () => clearTimers(), []);

  const patch = useCallback((p) => {
    setCurrentRun((prev) => {
      if (!prev) return prev;
      const np = typeof p === "function" ? p(prev) : { ...prev, ...p };
      syncList(np);
      return np;
    });
  }, [setCurrentRun, syncList]);

  // run a stage: tick steps, append to log, then onDone
  const runStage = useCallback((status, steps, onDone) => {
    patch((prev) => ({ ...prev, status, current_step: steps[0], log: appendLog(prev.log, steps[0]) }));
    let i = 1;
    const id = setInterval(() => {
      if (i < steps.length) {
        const s = steps[i]; i++;
        patch((prev) => ({ ...prev, current_step: s, log: appendLog(prev.log, s) }));
      } else { clearInterval(id); setTimeout(onDone, 520); }
    }, 760);
    timers.current.push(id);
  }, [patch]);

  const PD = window.PD;

  const finishStage1 = useCallback(() => {
    patch((prev) => ({ ...prev, status: "awaiting_stage2_approval", current_step: null, brand_name: "NackenFlow",
      outputs: { ...prev.outputs, onePager: PD.ONE_PAGER } }));
  }, [patch]);

  const startLive = useCallback(() => {
    clearTimers();
    patch((prev) => ({ ...prev, status: "pending", current_step: "Queued…", log: appendLog([], "Run accepted · id #" + prev.id) }));
    setTimeout(() => runStage("scraping", PD.STEPS.scraping, () => runStage("stage1", PD.STEPS.stage1, finishStage1)), 500);
  }, [patch, runStage, finishStage1]);

  const startStage2 = useCallback(() => {
    clearTimers();
    runStage("stage2", PD.STEPS.stage2, () => {
      patch((prev) => ({ ...prev, status: "awaiting_user", current_step: null,
        outputs: { ...prev.outputs, stage2Output: PD.GERMAN_COPY },
        stage3: { ...prev.stage3, started: false } }));
    });
  }, [patch, runStage]);

  const generateHero = useCallback(() => {
    clearTimers();
    patch((prev) => ({ ...prev, stage3: { ...prev.stage3, started: true, usedHero: true } }));
    runStage("generating_hero", PD.STEPS.generating_hero, () => {
      patch((prev) => ({ ...prev, status: "awaiting_hero_qc", current_step: null, stage3: { ...prev.stage3, heroUrl: "hero" } }));
    });
  }, [patch, runStage]);

  const regenerateHero = useCallback(() => {
    clearTimers();
    runStage("generating_hero", PD.STEPS.generating_hero.slice(1), () => {
      patch((prev) => ({ ...prev, status: "awaiting_hero_qc", current_step: null, stage3: { ...prev.stage3, heroUrl: "hero" } }));
    });
  }, [patch, runStage]);

  const buildPrompts = useCallback((onDone) => {
    runStage("generating_remaining", PD.STEPS.generating_remaining, () => {
      patch((prev) => ({ ...prev, status: "awaiting_qc", current_step: null, stage3: { ...prev.stage3, prompts: PD.REMAINING_PROMPTS } }));
      onDone && onDone();
    });
  }, [patch, runStage]);

  const approveHero = useCallback(() => { clearTimers(); buildPrompts(); }, [buildPrompts]);
  const skipHero = useCallback(() => {
    clearTimers();
    patch((prev) => ({ ...prev, stage3: { ...prev.stage3, started: true, usedHero: false } }));
    buildPrompts();
  }, [patch, buildPrompts]);

  const completeStage3 = useCallback((images, prompts) => {
    const withMesh = images.map((im) => ({ ...im, mesh: im.index }));
    // place one passing image per body section (problem→solution, benefit, review)
    const pass = (idx) => withMesh.find((im) => im.index === idx && (im.user_override ?? im.verdict) === "pass");
    const sec1 = pass(3) ? 3 : (withMesh.find((im) => im.verdict === "pass")?.index ?? 2);
    const sec2 = pass(5) ? 5 : 2;
    const sec3 = pass(9) ? 9 : 4;
    patch((prev) => ({ ...prev, status: "completed", current_step: null, completedAt: new Date().toISOString(),
      stage3: { ...prev.stage3, images: withMesh, prompts, placement: { section_1: sec1, section_2: sec2, section_3: sec3, reasons: {} } } }));
  }, [patch]);

  const kill = useCallback(() => {
    if (!window.confirm("Kill this run? It stops at the next stage boundary. You can Resume it later.")) return;
    clearTimers();
    patch((prev) => ({ ...prev, status: "cancelled" }));
  }, [patch]);

  const resume = useCallback(() => {
    clearTimers();
    patch((prev) => {
      const o = prev.outputs;
      let next = prev;
      setTimeout(() => {
        if (!o.onePager) runStage("stage1", PD.STEPS.stage1, finishStage1);
        else if (!o.stage2Output) startStage2();
        else if (!prev.stage3.prompts) generateHero();
        else patch((p) => ({ ...p, status: "awaiting_qc" }));
      }, 300);
      return { ...next, status: "pending", current_step: "Resuming…", log: appendLog(prev.log, "↻ resuming pipeline…") };
    });
  }, [patch, runStage, finishStage1, startStage2, generateHero]);

  const restartStage = useCallback((stage) => {
    const isS3 = stage === "stage3";
    if (!window.confirm(isS3 ? "Restart Stage 3 from scratch? This deletes the hero, all images, and the placement." : `Restart ${stage === "stage1" ? "Stage 1" : "Stage 2"}? This clears that stage's output and re-runs it.`)) return;
    clearTimers();
    if (stage === "stage1") {
      patch((prev) => ({ ...prev, outputs: { onePager: null, onePagerEdited: null, stage2Output: null, stage2OutputEdited: null, stage2EditedAt: null }, stage3: { started: false, heroUrl: null, prompts: null, images: [], placement: null, usedHero: true }, log: [] }));
      setTimeout(() => runStage("scraping", PD.STEPS.scraping, () => runStage("stage1", PD.STEPS.stage1, finishStage1)), 250);
    } else if (stage === "stage2") {
      patch((prev) => ({ ...prev, outputs: { ...prev.outputs, stage2Output: null, stage2OutputEdited: null, stage2EditedAt: null }, stage3: { started: false, heroUrl: null, prompts: null, images: [], placement: null, usedHero: true } }));
      setTimeout(() => startStage2(), 250);
    } else {
      patch((prev) => ({ ...prev, status: "awaiting_user", stage3: { started: false, heroUrl: null, prompts: null, images: [], placement: null, usedHero: true } }));
    }
  }, [patch, runStage, finishStage1, startStage2]);

  return useMemo(() => ({ patch, startLive, startStage2, generateHero, regenerateHero, approveHero, skipHero, completeStage3, kill, resume, restartStage, clearTimers }),
    [patch, startLive, startStage2, generateHero, regenerateHero, approveHero, skipHero, completeStage3, kill, resume, restartStage]);
}

/* ── Sidebar ──────────────────────────────────────────────────────────────*/
/* ── Sidebar ────────────────────────────────────────────────────────────*/
const CollapseIcon = ({ collapsed }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
    {collapsed
      ? <g><path d="m9 6 6 6-6 6" /><path d="m4 6 6 6-6 6" opacity="0.45" /></g>
      : <g><path d="m15 6-6 6 6 6" /><path d="m20 6-6 6 6 6" opacity="0.45" /></g>}
  </svg>
);

function Sidebar({ route, go, runsCount, collapsed, onToggle }) {
  const item = (id, label, icon, badge) => {
    const active = route === id || (id === "run" && route === "run");
    return (
      <button onClick={() => go(id)} title={collapsed ? label : undefined} className={window.cx(
        "relative flex items-center rounded-[var(--radius-sm)] text-[13.5px] tr text-left w-full",
        collapsed ? "justify-center px-0 py-[10px]" : "gap-[11px] px-[11px] py-[9px]",
        active ? "bg-[var(--color-accent-weak)] text-[var(--color-accent-text)] font-[650]" : "text-[var(--color-text-2)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] font-[550]")}>
        {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[18px] rounded-full bg-[var(--color-accent)]" />}
        <span className="opacity-90 shrink-0">{icon}</span>
        {!collapsed && <span className="truncate">{label}</span>}
        {!collapsed && badge != null && <span className="ml-auto ff-mono text-[10px] text-[var(--color-text-3)]">{badge}</span>}
      </button>
    );
  };
  return (
    <aside style={{ width: "100%" }} className="relative sticky top-0 h-screen border-r border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col px-3 py-4 gap-1 shrink-0">
      <button onClick={onToggle} title={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        style={{ position: "absolute", right: 0, top: "50%", transform: "translate(50%, -50%)", zIndex: 50 }}
        className="w-[22px] h-[22px] grid place-items-center rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text-3)] hover:text-[var(--color-text)] hover:border-[var(--color-text-3)] shadow-[var(--shadow-card)] tr cursor-pointer">
        <Icon.ChevronRight className={window.cx("w-3.5 h-3.5", !collapsed && "rotate-180")} />
      </button>
      <div className={window.cx("flex items-center pb-[14px] pt-[6px]", collapsed ? "justify-center px-0" : "gap-[10px] px-2")}>
        <span className="w-[30px] h-[30px] rounded-[var(--radius-sm)] bg-[var(--color-primary)] text-[var(--color-on-primary)] grid place-items-center shrink-0"><Icon.Logo className="w-4 h-4" /></span>
        {!collapsed && <span className="font-bold tracking-tight text-[15.5px] ff-display text-[var(--color-text)]">Pipeline</span>}
      </div>
      <nav className="flex flex-col gap-0.5">
        {item("new", "New Run", <Icon.Plus className="w-[17px] h-[17px]" />)}
        {item("history", "Runs", <Icon.Runs className="w-[17px] h-[17px]" />, runsCount)}
        {item("settings", "Settings", <Icon.Settings className="w-[17px] h-[17px]" />)}
      </nav>
      <div className="flex-1" />
      <div className="border-t border-[var(--color-border)] pt-3 flex flex-col gap-2.5">
        {!collapsed && <p className="ff-mono text-[10px] text-[var(--color-text-3)]">v4.2.0 · prototype</p>}
        <div className={window.cx("flex items-center text-xs text-[var(--color-text-2)]", collapsed ? "justify-center" : "gap-2")}>
          <span className="w-[7px] h-[7px] rounded-full bg-[var(--color-green)] shrink-0 pulse-dot" title="Higgsfield connected" />
          {!collapsed && <span className="truncate">Higgsfield connected</span>}
        </div>
      </div>
    </aside>
  );
}

/* ── Top command bar with the Direction switcher ──────────────────────────*/
function CommandBar({ route, dir, setDir, theme, setTheme }) {
  const title = { new: "New Run", history: "Runs", run: "Run detail", settings: "Settings" }[route] || "Pipeline";
  return (
    <div className="sticky top-0 z-40 h-[52px] border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-surface)_88%,transparent)] backdrop-blur-md flex items-center justify-between gap-4 px-5">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="ff-mono text-[10px] tracking-[0.16em] uppercase text-[var(--color-accent)] border border-[color-mix(in_srgb,var(--color-accent)_30%,transparent)] rounded px-1.5 py-0.5">Proto</span>
        <span className="text-[13px] font-[600] text-[var(--color-text)] whitespace-nowrap">{title}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="eyebrow text-[var(--color-text-3)] hidden md:block">Direction</span>
        <div className="flex items-center gap-0.5 p-0.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-2)] border border-[var(--color-border)]">
          {DIRECTIONS.map((d) => (
            <button key={d.id} onClick={() => setDir(d.id)} title={d.tag}
              className={window.cx("px-2.5 py-1 rounded-[calc(var(--radius-sm)-2px)] text-[12px] font-[600] cursor-pointer",
                dir === d.id ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-[var(--shadow-card)]" : "text-[var(--color-text-3)] hover:text-[var(--color-text)]")}>
              {d.name}
            </button>
          ))}
        </div>
        <div className="w-px h-5 bg-[var(--color-border)]" />
        <button onClick={() => setTheme(theme === "light" ? "dark" : "light")} title="Toggle theme"
          className="w-8 h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-2)] grid place-items-center tr hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)] cursor-pointer">
          {theme === "light" ? <Icon.Moon className="w-4 h-4" /> : <Icon.Sun className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

/* ── pipeline prompts (tweakable) ─────────────────────────────────────────*/
const STAGE_PROMPTS = /*EDITMODE-BEGIN*/{
  "stage1Prompt": "You are a senior DTC product researcher.\n\nFrom the product description and reference photos, produce a single research one-pager:\n• Product ID — what it is and how it works\n• Market — who buys it, price tier, positioning\n• Avatar — one concrete customer, their day, their pain\n• Offer brief — price, guarantee, bundle, lead angle\n• Necessary beliefs — what they must believe to buy\n• One-pager summary\n\nBe concrete and specific. The description always wins over scraped data on conflicts.",
  "stage2Prompt": "You are a German DTC copywriter.\n\nUsing the approved research one-pager, write a full German copy kit:\nHero headline + subhead, Problem, Solution, 3 Benefits, Social proof, Offer, and CTA.\n\nUse natural du-form, warm and concrete. No English, no literal translations — write as a native marketer would.",
  "stage3Prompt": "You are an art director for DTC product imagery.\n\nGenerate a hero product shot first from the source photos, then 8 derivatives: lifestyle, problem→solution, feature callout, benefit, before/after, comparison, UGC/native, and review/social-proof.\n\nKeep the product identical to the approved hero. For each image specify scene, lighting, aspect ratio, and any German text overlay."
}/*EDITMODE-END*/;

// multiline prompt control for the Tweaks panel
function TweakPrompt({ label, value, onChange }) {
  return (
    <div className="twk-row">
      <div className="twk-lbl"><span>{label}</span></div>
      <textarea className="twk-field" value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false}
        style={{ height: "auto", minHeight: 112, padding: "7px 8px", lineHeight: 1.5, resize: "vertical", fontFamily: "inherit" }} />
    </div>
  );
}

function SettingsPage({ prompts }) {
  const items = [
    { n: "01", title: "Stage 1 · Research prompt", body: prompts.stage1Prompt },
    { n: "02", title: "Stage 2 · German copy prompt", body: prompts.stage2Prompt },
    { n: "03", title: "Stage 3 · Image prompt", body: prompts.stage3Prompt },
  ];
  return (
    <div className="px-7 py-7 max-w-[820px] mx-auto">
      <h1 className="text-[28px] font-bold tracking-tight ff-display text-[var(--color-text)] mb-1">Settings</h1>
      <p className="text-[13px] text-[var(--color-text-2)] mb-6">The system prompts that drive each stage. Edit them in the <strong className="text-[var(--color-text)]">Tweaks</strong> panel — changes appear here.</p>
      <div className="space-y-3">
        {items.map((it) => (
          <Card key={it.n} className="overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
              <span className="ff-mono text-[11px] text-[var(--color-accent)] font-[600]">{it.n}</span>
              <Eyebrow className="text-[var(--color-text-2)]">{it.title}</Eyebrow>
            </div>
            <p className="px-5 py-4 text-[13px] leading-relaxed text-[var(--color-text-2)] whitespace-pre-wrap">{it.body}</p>
          </Card>
        ))}
      </div>
      <p className="ff-mono text-[11px] text-[var(--color-text-3)] mt-4">Open <strong>Tweaks</strong> in the toolbar to edit these prompts.</p>
    </div>
  );
}

/* ── App ──────────────────────────────────────────────────────────────────*/
function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem("pl_theme") || "light");
  const [dir, setDir] = useState(() => localStorage.getItem("pl_dir") || "signal");
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("pl_sidebar") === "1");
  const [route, setRoute] = useState("new");
  const [runs, setRuns] = useState(() => window.PD.SEED_RUNS.map((r) => ({ ...r })));
  const [currentRun, setCurrentRun] = useState(null);
  const { toasts, push } = window.useToasts();
  const [tw, setTweak] = useTweaks(STAGE_PROMPTS);

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("pl_theme", theme); }, [theme]);
  useEffect(() => { document.documentElement.dataset.dir = dir; localStorage.setItem("pl_dir", dir); }, [dir]);
  useEffect(() => { localStorage.setItem("pl_sidebar", collapsed ? "1" : "0"); }, [collapsed]);

  // keep runs list summary in sync with the active run
  const syncList = useCallback((run) => {
    if (!run) return;
    setRuns((prev) => {
      const exists = prev.some((r) => r.id === run.id);
      const summary = { id: run.id, brand_name: run.brand_name, product_name: run.product_name, product_url: run.product_url, status: run.status, current_step: run.current_step, last_updated_at: new Date().toISOString(), created_at: run.startedAt };
      if (exists) return prev.map((r) => (r.id === run.id ? { ...r, ...summary } : r));
      return [summary, ...prev];
    });
  }, []);

  const engine = usePipelineEngine(setCurrentRun, syncList);

  const go = (r) => { if (r === "run" && !currentRun) r = "history"; setRoute(r); };

  const startNewRun = () => {
    const run = window.makeLiveRun();
    setCurrentRun(run);
    setRuns((prev) => [{ id: run.id, brand_name: run.brand_name, product_name: run.product_name, product_url: run.product_url, status: "pending", current_step: "Queued…", last_updated_at: new Date().toISOString(), created_at: run.startedAt }, ...prev]);
    setRoute("run");
    setTimeout(() => engine.startLive(), 60);
  };

  const openRun = (id) => {
    if (currentRun && currentRun.id === id) { setRoute("run"); return; }
    const seed = runs.find((r) => r.id === id);
    const run = window.buildRunFromSeed(seed);
    engine.clearTimers();
    setCurrentRun(run);
    setRoute("run");
  };

  const deleteRun = (id) => {
    const r = runs.find((x) => x.id === id);
    const name = r?.brand_name || r?.product_name || `#${id}`;
    if (!window.confirm(`Delete run "${name}"? This removes it and its outputs. This can't be undone.`)) return;
    if (currentRun && currentRun.id === id) { engine.clearTimers(); setCurrentRun(null); }
    setRuns((prev) => prev.filter((x) => x.id !== id));
    push("Run deleted", "success");
  };

  const patch = engine.patch;

  return (
    <div style={{ display: "grid", gridTemplateColumns: collapsed ? "64px 1fr" : "232px 1fr", minHeight: "100vh" }}>
      <Sidebar route={route} go={go} runsCount={runs.length} collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
        <CommandBar route={route} dir={dir} setDir={setDir} theme={theme} setTheme={setTheme} />
        <main className="flex-1 min-w-0">
          {route === "new" && <NewRun onStart={(a, nav) => (nav === "history" ? setRoute("history") : startNewRun())} push={push} />}
          {route === "history" && <RunsList runs={runs} onOpen={openRun} onNew={() => setRoute("new")} onDelete={deleteRun} />}
          {route === "settings" && <SettingsPage prompts={tw} />}
          {route === "run" && currentRun && (
            <RunDetail run={currentRun} engine={engine} patch={patch} push={push} onBack={() => setRoute("history")} />
          )}
        </main>
      </div>
      <Toasts toasts={toasts} />
      <TweaksPanel title="Prompts">
        <TweakSection label="Pipeline prompts" />
        <TweakPrompt label="Stage 1 · Research" value={tw.stage1Prompt} onChange={(v) => setTweak("stage1Prompt", v)} />
        <TweakPrompt label="Stage 2 · German copy" value={tw.stage2Prompt} onChange={(v) => setTweak("stage2Prompt", v)} />
        <TweakPrompt label="Stage 3 · Images" value={tw.stage3Prompt} onChange={(v) => setTweak("stage3Prompt", v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
