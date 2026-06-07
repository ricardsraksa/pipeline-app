/* ============================================================================
   screens.jsx — New Run + Runs list. Exposes NewRun, RunsList on window.
   ============================================================================ */

const MIN_DESC = 20;
const MAX_IMAGES = 10;
const inputCls = "w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-[var(--radius-sm)] px-[13px] py-[11px] text-sm transition-all focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)] placeholder:text-[var(--color-text-4)]";

/* small mesh used as an uploaded-image thumb */
function MeshThumb({ m1, m2, className }) {
  return <div className={window.cx("imgmesh", className)} style={{ "--m1": m1, "--m2": m2 }} />;
}

/* ─────────────────────────────── New Run ─────────────────────────────────*/
function NewRun({ onStart, push }) {
  const P = window.PD.HERO_PRODUCT;
  const [desc, setDesc] = useState("");
  const [images, setImages] = useState([]);
  const [showAdv, setShowAdv] = useState(false);
  const [productUrl, setProductUrl] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const descRef = useRef(null);

  useEffect(() => { descRef.current?.focus(); }, []);

  const descOk = desc.trim().length >= MIN_DESC;
  const imagesOk = images.length > 0;
  const canStart = descOk && imagesOk && !submitting;

  const addImages = (n = 3) => {
    const M = window.PD.MESH;
    setImages((prev) => {
      const next = [...prev];
      for (let i = 0; i < n && next.length < MAX_IMAGES; i++) {
        const idx = next.length;
        next.push({ m1: M[idx % M.length][0], m2: M[idx % M.length][1] });
      }
      return next;
    });
  };

  const prefill = () => {
    setDesc(P.product_description);
    addImages(3);
    setProductUrl(P.product_url);
    setCompetitors(P.competitorUrls.join("\n"));
    push("Demo product loaded — hit Run pipeline", "success");
  };

  const start = () => {
    if (!canStart) return;
    setSubmitting(true);
    setTimeout(() => onStart(), 420);
  };

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); start(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const advCount = (productUrl ? 1 : 0) + competitors.split("\n").map((s) => s.trim()).filter(Boolean).length;

  return (
    <div className="px-7 py-7 max-w-[760px] w-full mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5">
            <Eyebrow>Pipeline</Eyebrow>
            <span className="w-1 h-1 rounded-full bg-[var(--color-text-4)]" />
            <Eyebrow>New run</Eyebrow>
          </div>
          <h1 className="text-[28px] leading-tight font-bold tracking-tight ff-display text-[var(--color-text)]">
            Brief the pipeline.
          </h1>
          <p className="text-[13px] text-[var(--color-text-2)] leading-relaxed mt-1.5 max-w-[52ch]">
            Describe the product and drop a few reference photos. We run Stage&nbsp;1 research,
            Stage&nbsp;2 German copy, then pause before Stage&nbsp;3 images.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={prefill}>
          <Icon.Spark className="w-3.5 h-3.5 text-[var(--color-accent)]" /> Load demo product
        </Button>
      </div>

      <Card className="overflow-hidden divide-y divide-[var(--color-border)]">
        {/* description */}
        <div className="px-5 py-5">
          <div className="flex items-center justify-between mb-2">
            <label className="eyebrow">Product description <span className="text-[var(--color-red)]">*</span></label>
            <span className="ff-mono text-[11px] text-[var(--color-text-4)]">{desc.trim().length}/{MIN_DESC}+</span>
          </div>
          <textarea ref={descRef} value={desc} onChange={(e) => setDesc(e.target.value)} rows={5}
            placeholder="Describe the product: what it is, who it's for, key features, materials, how it works…"
            className={window.cx(inputCls, "resize-y", desc.length > 0 && !descOk && "border-[var(--color-red)] focus:border-[var(--color-red)]")} />
          {desc.length > 0 && !descOk && (
            <p className="mt-1.5 text-[11px] text-[var(--color-red)] ff-mono">Need at least {MIN_DESC} characters</p>
          )}
        </div>

        {/* source images */}
        <div className="px-5 py-5">
          <div className="flex items-center justify-between mb-2">
            <label className="eyebrow">Source images <span className="text-[var(--color-red)]">*</span></label>
            <span className="ff-mono text-[11px] text-[var(--color-text-4)]">{images.length}/{MAX_IMAGES}</span>
          </div>
          <div
            onClick={() => images.length < MAX_IMAGES && addImages(3)}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); addImages(3); }}
            className={window.cx(
              "border-dashed border-2 rounded-[var(--radius-sm)] p-[26px] text-center tr",
              dragOver ? "border-[var(--color-accent)] bg-[var(--color-accent-weak)]" : "border-[var(--color-border-strong)] bg-[var(--color-surface-2)] hover:border-[var(--color-accent)] hover:bg-[var(--color-soft)]",
              images.length >= MAX_IMAGES ? "opacity-50 cursor-not-allowed" : "cursor-pointer")}>
            <Icon.Image className="w-5 h-5 text-[var(--color-text-3)] mx-auto mb-2" />
            <p className="text-[13px] font-[550] text-[var(--color-text-2)]">
              {dragOver ? "Drop to upload" : images.length >= MAX_IMAGES ? "Maximum reached" : "Drag images here or click to add"}
            </p>
            <p className="ff-mono text-[11px] text-[var(--color-text-3)] mt-1">Up to {MAX_IMAGES} · jpg, png, webp, heic · 8MB each</p>
          </div>
          {images.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-[10px] mt-[13px]">
              {images.map((im, i) => (
                <div key={i} className="aspect-square rounded-[9px] border border-[var(--color-border)] overflow-hidden relative group pop-in">
                  <MeshThumb m1={im.m1} m2={im.m2} className="w-full h-full" />
                  <button onClick={() => setImages((p) => p.filter((_, idx) => idx !== i))}
                    className="cursor-pointer absolute top-1 right-1 grid place-items-center w-5 h-5 rounded-full bg-black/55 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                    <Icon.X className="w-3 h-3" strokeWidth={2.6} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* advanced */}
        <div>
          <button onClick={() => setShowAdv((v) => !v)} className="cursor-pointer w-full flex items-center gap-2 px-5 py-3 text-left hover:bg-[var(--color-surface-2)] tr">
            <Icon.ChevronRight className={window.cx("w-3.5 h-3.5 text-[var(--color-text-3)] transition-transform", showAdv && "rotate-90")} />
            <span className="eyebrow text-[var(--color-text-2)]">Advanced</span>
            <span className="text-[12px] text-[var(--color-text-3)]">optional URLs · {advCount} provided</span>
          </button>
          {showAdv && (
            <div className="px-5 pb-5 space-y-4 fade-in">
              <div>
                <label className="eyebrow block mb-2">Product URL</label>
                <input value={productUrl} onChange={(e) => setProductUrl(e.target.value)} spellCheck={false}
                  placeholder="https://www.aliexpress.com/item/…" className={inputCls} />
                <p className="mt-1.5 text-[11px] text-[var(--color-text-3)]">Optional. Scraper attempts extra context. Description always wins on conflicts.</p>
              </div>
              <div>
                <label className="eyebrow block mb-2">Competitor URLs <span className="text-[var(--color-text-4)] normal-case font-normal tracking-normal ml-1.5">one per line, max 5</span></label>
                <textarea value={competitors} onChange={(e) => setCompetitors(e.target.value)} rows={3} spellCheck={false}
                  placeholder={"https://example.com/product\nhttps://other.com/item"}
                  className={window.cx(inputCls, "ff-mono text-[12px] resize-y")} />
              </div>
            </div>
          )}
        </div>

        {/* submit row */}
        <div className="px-5 py-4 flex items-center justify-between gap-4 bg-[var(--color-surface-2)]">
          <div className="text-[12px] text-[var(--color-text-3)] hidden sm:block">Runs in background · close the tab anytime.</div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => onStart(null, "history")}>View Runs</Button>
            <Button onClick={start} disabled={!canStart}>
              {submitting ? (<><Icon.Loader className="w-3.5 h-3.5" /> Starting…</>)
                : (<><Icon.Play className="w-3.5 h-3.5" /> Run pipeline
                    <span className="flex items-center gap-0.5 ml-1"><kbd className="kbd">⌘</kbd><kbd className="kbd">↵</kbd></span></>)}
            </Button>
          </div>
        </div>
      </Card>

      {/* stage explainer */}
      <div className="mt-7 grid sm:grid-cols-3 gap-3">
        {[
          { n: "01", title: "Research", body: "Product ID, market, avatar, offer brief, beliefs, one-pager." },
          { n: "02", title: "German copy", body: "Full DTC copy kit. Auto-runs after you approve Stage 1." },
          { n: "03", title: "Images", body: "Pauses for approval. Hero shot first, then 8 derivatives." },
        ].map((s) => (
          <Card key={s.n} className="px-4 py-3.5">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="ff-mono text-[11px] text-[var(--color-accent)] font-[600]">{s.n}</span>
              <p className="eyebrow text-[var(--color-text-2)]">{s.title}</p>
            </div>
            <p className="text-[12px] text-[var(--color-text-3)] leading-relaxed">{s.body}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────── Runs list ───────────────────────────────*/
const ACTIVE = new Set(["pending","scraping","stage1","stage2","generating_hero","generating_remaining"]);
const WAITING = new Set(["awaiting_stage2_approval","awaiting_user","awaiting_qc","awaiting_hero_qc"]);

function RunsList({ runs, onOpen, onNew, onDelete }) {
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const counts = runs.reduce((a, r) => {
    if (ACTIVE.has(r.status)) a.active++;
    else if (r.status === "completed") a.completed++;
    else if (r.status === "failed") a.failed++;
    else if (WAITING.has(r.status)) a.waiting++;
    return a;
  }, { active: 0, completed: 0, failed: 0, waiting: 0 });
  const needsYou = counts.waiting + counts.failed;

  const matchFilter = (r) => {
    if (filter === "all") return true;
    if (filter === "needs") return WAITING.has(r.status) || r.status === "failed";
    if (filter === "running") return ACTIVE.has(r.status);
    if (filter === "complete") return r.status === "completed";
    if (filter === "failed") return r.status === "failed" || r.status === "cancelled";
    return true;
  };
  const query = q.trim().toLowerCase();
  const filtered = runs.filter(matchFilter).filter((r) =>
    !query || `${r.brand_name || ""} ${r.product_name || ""} ${r.product_url || ""} #${r.id}`.toLowerCase().includes(query));

  const tabs = [
    { id: "all", label: "All", n: runs.length },
    { id: "needs", label: "Needs you", n: needsYou },
    { id: "running", label: "Running", n: counts.active },
    { id: "complete", label: "Complete", n: counts.completed },
    { id: "failed", label: "Failed", n: counts.failed },
  ];

  return (
    <div className="px-7 py-7 max-w-[1080px] mx-auto">
      <div className="flex items-end justify-between mb-5 gap-4 flex-wrap">
        <div>
          <h1 className="text-[28px] leading-tight font-bold tracking-tight ff-display text-[var(--color-text)] mb-1">Runs</h1>
          <p className="text-[13px] text-[var(--color-text-2)]">
            {runs.length} total · <span className="text-[var(--color-accent)]">{counts.active} running</span> · {needsYou} need you · {counts.completed} complete
          </p>
        </div>
        <Button onClick={onNew}><Icon.Spark className="w-3.5 h-3.5" /> New run</Button>
      </div>

      {/* needs-you callout */}
      {needsYou > 0 && filter === "all" && !query && (
        <button onClick={() => setFilter("needs")}
          className="w-full mb-4 flex items-center gap-3 px-4 py-3 rounded-[var(--radius)] border border-[color-mix(in_srgb,var(--color-amber)_35%,transparent)] bg-[var(--color-amber-bg)] text-left cursor-pointer tr hover:brightness-[.98] fade-in">
          <span className="grid place-items-center w-7 h-7 rounded-full bg-[var(--color-amber)] text-white shrink-0"><Icon.Alert className="w-4 h-4" /></span>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-[620] text-[var(--color-text)]">{needsYou} run{needsYou > 1 ? "s" : ""} waiting on you</p>
            <p className="text-[12px] text-[var(--color-text-2)]">Approvals and failed runs that need a decision to move forward.</p>
          </div>
          <span className="text-[12px] font-[600] text-[var(--color-amber)] inline-flex items-center gap-1 shrink-0">Show <Icon.ArrowRight className="w-3.5 h-3.5" /></span>
        </button>
      )}

      {/* filter tabs + search */}
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-1 p-0.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-2)] border border-[var(--color-border)]">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setFilter(t.id)}
              className={window.cx("px-3 py-1.5 rounded-[calc(var(--radius-sm)-2px)] text-[12.5px] font-[600] tr cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap",
                filter === t.id ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-[var(--shadow-card)]" : "text-[var(--color-text-3)] hover:text-[var(--color-text)]")}>
              {t.label}
              <span className={window.cx("ff-mono text-[10px]", filter === t.id ? "text-[var(--color-accent)]" : "text-[var(--color-text-4)]")}>{t.n}</span>
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[180px] max-w-[300px]">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-3)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search runs…"
            className="w-full pl-8 pr-3 py-[7px] text-[12.5px] rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-text-4)] focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)]" />
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-4 py-[11px] bg-[var(--color-surface-2)] border-b border-[var(--color-border)]">
          <span className="eyebrow text-[var(--color-text-3)]">Run</span>
          <span className="eyebrow text-[var(--color-text-3)] hidden sm:block">Status</span>
          <span className="eyebrow text-[var(--color-text-3)] hidden md:block">Updated</span>
          <span className="eyebrow text-[var(--color-text-3)] text-right">Action</span>
        </div>
        {filtered.length === 0 && (
          <div className="px-4 py-14 text-center">
            <p className="text-[13px] text-[var(--color-text-3)]">No runs match{query ? ` "${q}"` : " this filter"}.</p>
          </div>
        )}
        {filtered.map((r, i) => {
          const isActive = ACTIVE.has(r.status);
          const waiting = WAITING.has(r.status) || r.status === "failed";
          const action = isActive ? "View live" : waiting ? "Continue" : "View";
          return (
            <div key={r.id} onClick={() => onOpen(r.id)}
              className="group grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-4 py-[13px] border-b border-[var(--color-border)] last:border-0 cursor-pointer tr hover:bg-[var(--color-surface-2)] fade-in"
              style={{ animationDelay: `${i * 22}ms` }}>
              <div className="min-w-0 flex items-center gap-3">
                <div className="w-9 h-9 rounded-[var(--radius-sm)] overflow-hidden shrink-0 border border-[var(--color-border)]">
                  <MeshThumb m1={window.PD.MESH[r.id % 9][0]} m2={window.PD.MESH[r.id % 9][1]} className="w-full h-full" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <p className="font-[600] text-[13.5px] text-[var(--color-text)] truncate">{r.brand_name || r.product_name}</p>
                    <span className="ff-mono text-[10px] text-[var(--color-text-4)] shrink-0">#{r.id}</span>
                  </div>
                  <p className="ff-mono text-[11px] text-[var(--color-text-3)] truncate">{truncateUrl(r.product_url)}</p>
                  {isActive && r.current_step && (
                    <p className="text-[11px] text-[var(--color-accent)] truncate mt-0.5 flex items-center gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-current pulse-dot" />{r.current_step}
                    </p>
                  )}
                </div>
              </div>
              <div className="hidden sm:block"><StatusBadge status={r.status} /></div>
              <div className="hidden md:block ff-mono text-[11px] text-[var(--color-text-3)] whitespace-nowrap">{relativeTime(r.last_updated_at)}</div>
              <div className="flex items-center justify-end gap-1">
                <button onClick={(e) => { e.stopPropagation(); onDelete(r.id); }} title="Delete run" aria-label={`Delete run #${r.id}`}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 grid place-items-center w-7 h-7 rounded-[var(--radius-sm)] text-[var(--color-text-3)] hover:text-[var(--color-red)] hover:bg-[var(--color-red-bg)] tr cursor-pointer">
                  <Icon.Trash className="w-[15px] h-[15px]" />
                </button>
                <span className={window.cx("inline-flex items-center gap-1 text-[12px] font-[550] min-w-[58px] justify-end", waiting ? "text-[var(--color-amber)]" : "text-[var(--color-text-2)]")}>
                  {action}<Icon.ArrowRight className="w-3.5 h-3.5" />
                </span>
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}

Object.assign(window, { NewRun, RunsList, MeshThumb });
