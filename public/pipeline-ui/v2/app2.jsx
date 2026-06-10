/* ============================================================================
   app2.jsx — v2 shell: top bar nav, pipeline engine, routing, settings page,
   Tweaks (stage prompts). Reuses engine.jsx atoms + data.js.
   ============================================================================ */

const rnd2 = () => Math.random().toString(36).slice(2);
const appendLog2 = (log, t) => [...(log || []), { k: rnd2(), t }];

/* ── pipeline engine (same behavior as v1) ────────────────────────────────*/
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

  const runStage = useCallback((status, steps, onDone) => {
    patch((prev) => ({ ...prev, status, current_step: steps[0], log: appendLog2(prev.log, steps[0]) }));
    let i = 1;
    const id = setInterval(() => {
      if (i < steps.length) {
        const s = steps[i]; i++;
        patch((prev) => ({ ...prev, current_step: s, log: appendLog2(prev.log, s) }));
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
    patch((prev) => ({ ...prev, status: "pending", current_step: "Queued…", log: appendLog2([], "Run accepted · id #" + prev.id) }));
    setTimeout(() => runStage("scraping", PD.STEPS.scraping, () => runStage("stage1", PD.STEPS.stage1, finishStage1)), 500);
  }, [patch, runStage, finishStage1]);

  const startStage2 = useCallback(() => {
    clearTimers();
    runStage("stage2", PD.STEPS.stage2, () => {
      patch((prev) => ({ ...prev, status: "awaiting_user", current_step: null,
        outputs: { ...prev.outputs, stage2Output: PD.GERMAN_COPY }, stage3: { ...prev.stage3, started: false } }));
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
      setTimeout(() => {
        if (!o.onePager) runStage("stage1", PD.STEPS.stage1, finishStage1);
        else if (!o.stage2Output) startStage2();
        else if (!prev.stage3.prompts) generateHero();
        else patch((p) => ({ ...p, status: "awaiting_qc" }));
      }, 300);
      return { ...prev, status: "pending", current_step: "Resuming…", log: appendLog2(prev.log, "↻ resuming pipeline…") };
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

/* ── stage prompts (tweakable) ────────────────────────────────────────────*/
const STAGE_PROMPTS = {
  "stage1Prompt": "You are a senior DTC product researcher.\n\nFrom the product description and reference photos, produce a single research one-pager:\n• Product ID — what it is and how it works\n• Market — who buys it, price tier, positioning\n• Avatar — one concrete customer, their day, their pain\n• Offer brief — price, guarantee, bundle, lead angle\n• Necessary beliefs — what they must believe to buy\n• One-pager summary\n\nBe concrete and specific. The description always wins over scraped data on conflicts.",
  "stage2Prompt": "You are a German DTC copywriter.\n\nUsing the approved research one-pager, write a full German copy kit:\nHero headline + subhead, Problem, Solution, 3 Benefits, Social proof, Offer, and CTA.\n\nUse natural du-form, warm and concrete. No English, no literal translations — write as a native marketer would.",
  "stage3Prompt": "You are an art director for DTC product imagery.\n\nGenerate a hero product shot first from the source photos, then 8 derivatives: lifestyle, problem→solution, feature callout, benefit, before/after, comparison, UGC/native, and review/social-proof.\n\nKeep the product identical to the approved hero. For each image specify scene, lighting, aspect ratio, and any German text overlay."
};

function TweakPrompt({ label, value, onChange }) {
  return (
    <div className="twk-row">
      <div className="twk-lbl"><span>{label}</span></div>
      <textarea className="twk-field" value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false}
        style={{ height: "auto", minHeight: 112, padding: "7px 8px", lineHeight: 1.5, resize: "vertical", fontFamily: "inherit" }} />
    </div>
  );
}

function SettingsV2({ prompts, onBack }) {
  const items = [
    { n: "01", title: "Stage 1 · Research prompt", body: prompts.stage1Prompt },
    { n: "02", title: "Stage 2 · German copy prompt", body: prompts.stage2Prompt },
    { n: "03", title: "Stage 3 · Image prompt", body: prompts.stage3Prompt },
  ];
  return (
    <div className="px-6 py-8 max-w-[760px] mx-auto" data-screen-label="Settings">
      <button onClick={onBack} className="cursor-pointer inline-flex items-center gap-1 text-[12px] text-[var(--color-text-3)] hover:text-[var(--color-text)] tr mb-4">
        <Icon.ArrowLeft className="w-3.5 h-3.5" /> Home
      </button>
      <h1 className="text-[26px] font-bold tracking-tight ff-display text-[var(--color-text)] mb-1">Settings</h1>
      <p className="text-[13px] text-[var(--color-text-2)] mb-6">The system prompts that drive each stage. Edit them in the <strong className="text-[var(--color-text)]">Tweaks</strong> panel.</p>
      <div className="space-y-3">
        {items.map((it) => (
          <Card key={it.n} className="overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
              <span className="ff-mono text-[11px] text-[var(--color-accent-text)] font-[600]">{it.n}</span>
              <Eyebrow className="text-[var(--color-text-2)]">{it.title}</Eyebrow>
            </div>
            <p className="px-5 py-4 text-[13px] leading-relaxed text-[var(--color-text-2)] whitespace-pre-wrap">{it.body}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ── top bar ──────────────────────────────────────────────────────────────*/
function TopBar({ route, go, theme, setTheme, needsCount }) {
  const tab = (id, label) => (
    <button onClick={() => go(id)} className={window.cx("relative px-3 py-1.5 rounded-[var(--radius-sm)] text-[13px] font-[600] tr cursor-pointer whitespace-nowrap",
      route === id ? "bg-[var(--color-accent-weak)] text-[var(--color-accent-text)]" : "text-[var(--color-text-2)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]")}>
      {label}
      {id === "home" && needsCount > 0 && route !== "home" && (
        <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[var(--color-amber)] text-white text-[9.5px] font-bold grid place-items-center">{needsCount}</span>
      )}
    </button>
  );
  return (
    <header className="sticky top-0 z-40 h-[54px] border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-surface)_90%,transparent)] backdrop-blur-md">
      <div className="max-w-[880px] mx-auto h-full px-6 flex items-center justify-between gap-4">
        <button onClick={() => go("home")} className="flex items-center gap-2.5 cursor-pointer">
          <span className="w-[28px] h-[28px] rounded-[var(--radius-sm)] bg-[var(--color-primary)] text-[var(--color-on-primary)] grid place-items-center shrink-0"><Icon.Logo className="w-4 h-4" /></span>
          <span className="font-bold tracking-tight text-[15px] ff-display text-[var(--color-text)]">Pipeline <span className="ff-mono text-[10px] text-[var(--color-text-4)] font-medium align-top">v2</span></span>
        </button>
        <nav className="flex items-center gap-1">
          {tab("home", "Home")}
          {tab("new", "New run")}
          {tab("settings", "Settings")}
          <div className="w-px h-5 bg-[var(--color-border)] mx-2" />
          <button onClick={() => setTheme(theme === "light" ? "dark" : "light")} title="Toggle theme"
            className="w-8 h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-2)] grid place-items-center tr hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)] cursor-pointer">
            {theme === "light" ? <Icon.Moon className="w-4 h-4" /> : <Icon.Sun className="w-4 h-4" />}
          </button>
        </nav>
      </div>
    </header>
  );
}

/* ── App ──────────────────────────────────────────────────────────────────*/
function AppV2() {
  const [theme, setTheme] = useState(() => localStorage.getItem("pl2_theme") || "light");
  const [route, setRoute] = useState("home");
  const [runs, setRuns] = useState(() => window.PD.SEED_RUNS.map((r) => ({ ...r })));
  const [currentRun, setCurrentRun] = useState(null);
  const { toasts, push } = window.useToasts();
  const [tw, setTweak] = useTweaks(STAGE_PROMPTS);

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("pl2_theme", theme); }, [theme]);

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

  const needsCount = runs.filter((r) => ["awaiting_stage2_approval","awaiting_user","awaiting_qc","awaiting_hero_qc","failed"].includes(r.status)).length;

  return (
    <div className="min-h-screen">
      <TopBar route={route} go={setRoute} theme={theme} setTheme={setTheme} needsCount={needsCount} />
      <main>
        {route === "home" && <HomeV2 runs={runs} onOpen={openRun} onNew={() => setRoute("new")} onDelete={deleteRun} />}
        {route === "new" && <NewRunV2 onStart={startNewRun} onCancel={() => setRoute("home")} push={push} />}
        {route === "settings" && <SettingsV2 prompts={tw} onBack={() => setRoute("home")} />}
        {route === "run" && currentRun && <RunV2 run={currentRun} engine={engine} patch={engine.patch} push={push} onBack={() => setRoute("home")} />}
        {route === "run" && !currentRun && <HomeV2 runs={runs} onOpen={openRun} onNew={() => setRoute("new")} onDelete={deleteRun} />}
      </main>
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

ReactDOM.createRoot(document.getElementById("root")).render(<AppV2 />);
