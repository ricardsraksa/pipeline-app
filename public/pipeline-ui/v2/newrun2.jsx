/* ============================================================================
   newrun2.jsx — v2 guided New Run: numbered steps, one card, one CTA.
   Exposes NewRunV2.
   ============================================================================ */

const V2_MIN_DESC = 20;
const V2_MAX_IMG = 10;
const v2input = "w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-[var(--radius-sm)] px-[13px] py-[11px] text-sm transition-all focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)] placeholder:text-[var(--color-text-4)]";

function StepNum({ n, done }) {
  return (
    <span className={window.cx("w-6 h-6 rounded-full grid place-items-center text-[11.5px] font-bold border-2 shrink-0",
      done ? "bg-[var(--color-green)] border-[var(--color-green)] text-[var(--color-on-primary)]" : "border-[var(--color-border-strong)] text-[var(--color-text-3)]")}>
      {done ? <Icon.Check className="w-3 h-3" strokeWidth={3.2} /> : n}
    </span>
  );
}

function NewRunV2({ onStart, onCancel, push }) {
  const P = window.PD.HERO_PRODUCT;
  const [desc, setDesc] = useState("");
  const [images, setImages] = useState([]);
  const [productUrl, setProductUrl] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [showUrls, setShowUrls] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const descRef = useRef(null);
  useEffect(() => { descRef.current?.focus(); }, []);

  const descOk = desc.trim().length >= V2_MIN_DESC;
  const imagesOk = images.length > 0;
  const canStart = descOk && imagesOk && !submitting;

  const addImages = (n = 3) => {
    const M = window.PD.MESH;
    setImages((prev) => {
      const next = [...prev];
      for (let i = 0; i < n && next.length < V2_MAX_IMG; i++) { const idx = next.length; next.push({ m1: M[idx % M.length][0], m2: M[idx % M.length][1] }); }
      return next;
    });
  };
  const prefill = () => {
    setDesc(P.product_description); addImages(3); setProductUrl(P.product_url); setCompetitors(P.competitorUrls.join("\n"));
    push("Demo product loaded", "success");
  };
  const start = () => { if (!canStart) return; setSubmitting(true); setTimeout(() => onStart(), 420); };
  useEffect(() => {
    const onKey = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); start(); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="px-6 py-8 max-w-[680px] mx-auto" data-screen-label="New Run">
      <button onClick={onCancel} className="cursor-pointer inline-flex items-center gap-1 text-[12px] text-[var(--color-text-3)] hover:text-[var(--color-text)] tr mb-4">
        <Icon.ArrowLeft className="w-3.5 h-3.5" /> Home
      </button>
      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div>
          <h1 className="text-[26px] leading-tight font-bold tracking-tight ff-display text-[var(--color-text)]">New run</h1>
          <p className="text-[13px] text-[var(--color-text-2)] mt-1">Two things needed. We'll pause for your review between stages.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={prefill}><Icon.Spark className="w-3.5 h-3.5 text-[var(--color-accent)]" /> Load demo</Button>
      </div>

      <Card className="divide-y divide-[var(--color-border)] overflow-hidden">
        {/* 1 — describe */}
        <div className="px-5 py-5">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2.5"><StepNum n={1} done={descOk} /><label className="text-[13.5px] font-[650] text-[var(--color-text)]">Describe the product</label></div>
            <span className="ff-mono text-[11px] text-[var(--color-text-4)]">{desc.trim().length}/{V2_MIN_DESC}+</span>
          </div>
          <textarea ref={descRef} value={desc} onChange={(e) => setDesc(e.target.value)} rows={4}
            placeholder="What it is, who it's for, key features, how it works…"
            className={window.cx(v2input, "resize-y", desc.length > 0 && !descOk && "border-[var(--color-red)] focus:border-[var(--color-red)]")} />
          {desc.length > 0 && !descOk && <p className="mt-1.5 text-[11px] text-[var(--color-red)] ff-mono">Need at least {V2_MIN_DESC} characters</p>}
        </div>

        {/* 2 — photos */}
        <div className="px-5 py-5">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2.5"><StepNum n={2} done={imagesOk} /><label className="text-[13.5px] font-[650] text-[var(--color-text)]">Add product photos</label></div>
            <span className="ff-mono text-[11px] text-[var(--color-text-4)]">{images.length}/{V2_MAX_IMG}</span>
          </div>
          <div
            onClick={() => images.length < V2_MAX_IMG && addImages(3)}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); addImages(3); }}
            className={window.cx("border-dashed border-2 rounded-[var(--radius-sm)] p-6 text-center tr",
              dragOver ? "border-[var(--color-accent)] bg-[var(--color-accent-weak)]" : "border-[var(--color-border-strong)] bg-[var(--color-surface-2)] hover:border-[var(--color-accent)]",
              images.length >= V2_MAX_IMG ? "opacity-50 cursor-not-allowed" : "cursor-pointer")}>
            <Icon.Image className="w-5 h-5 text-[var(--color-text-3)] mx-auto mb-1.5" />
            <p className="text-[13px] font-[550] text-[var(--color-text-2)]">{dragOver ? "Drop to upload" : "Drag photos here or click to add"}</p>
            <p className="ff-mono text-[10.5px] text-[var(--color-text-3)] mt-1">jpg, png, webp, heic · 8MB each</p>
          </div>
          {images.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-2 mt-3">
              {images.map((im, i) => (
                <div key={i} className="aspect-square rounded-[8px] border border-[var(--color-border)] overflow-hidden relative group pop-in">
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

        {/* optional urls */}
        <div>
          <button onClick={() => setShowUrls((v) => !v)} className="cursor-pointer w-full flex items-center gap-2 px-5 py-3 text-left hover:bg-[var(--color-surface-2)] tr">
            <Icon.ChevronRight className={window.cx("w-3.5 h-3.5 text-[var(--color-text-3)] transition-transform", showUrls && "rotate-90")} />
            <span className="text-[12.5px] font-[600] text-[var(--color-text-2)]">Optional: product &amp; competitor URLs</span>
          </button>
          {showUrls && (
            <div className="px-5 pb-5 space-y-4 fade-in">
              <div>
                <label className="eyebrow block mb-2">Product URL</label>
                <input value={productUrl} onChange={(e) => setProductUrl(e.target.value)} spellCheck={false} placeholder="https://www.aliexpress.com/item/…" className={v2input} />
              </div>
              <div>
                <label className="eyebrow block mb-2">Competitor URLs <span className="text-[var(--color-text-4)] normal-case font-normal tracking-normal ml-1.5">one per line, max 5</span></label>
                <textarea value={competitors} onChange={(e) => setCompetitors(e.target.value)} rows={3} spellCheck={false}
                  placeholder={"https://example.com/product"} className={window.cx(v2input, "ff-mono text-[12px] resize-y")} />
              </div>
            </div>
          )}
        </div>

        {/* CTA */}
        <div className="px-5 py-4 flex items-center justify-between gap-3 bg-[var(--color-surface-2)]">
          <p className="text-[12px] text-[var(--color-text-3)] hidden sm:block">Runs in background — leave anytime.</p>
          <Button onClick={start} disabled={!canStart}>
            {submitting ? (<><Icon.Loader className="w-3.5 h-3.5" /> Starting…</>)
              : (<><Icon.Play className="w-3.5 h-3.5" /> Run pipeline <span className="flex items-center gap-0.5 ml-1"><kbd className="kbd">⌘</kbd><kbd className="kbd">↵</kbd></span></>)}
          </Button>
        </div>
      </Card>
    </div>
  );
}

window.NewRunV2 = NewRunV2;
