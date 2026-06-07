/* ============================================================================
   stage3.jsx — Stage 3 hero-first flow: entry, hero QC, prompt QC, live
   generation, completed grid with per-image verdict override + regenerate +
   AI placement. Exposes Stage3Panel.
   ============================================================================ */

const CAT_LABELS = {
  hero: "Hero shot", lifestyle: "Lifestyle", problem_solution: "Problem → Solution",
  feature_callout: "Feature callout", benefit_visualization: "Benefit", before_after: "Before / After",
  comparison: "Comparison", ugc_native: "UGC / Native", review_social_proof: "Review / Social proof",
};
const catLabel = (s) => CAT_LABELS[s] || (s || "Image").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const effVerdict = (im) => (im?.user_override ?? im?.verdict) || null;

function ProductImage({ mesh, className, style, children }) {
  const M = window.PD.MESH[mesh % 9];
  return <div className={window.cx("imgmesh", className)} style={{ "--m1": M[0], "--m2": M[1], ...(style || {}) }}>{children}</div>;
}

/* ── Stage 3 root ─────────────────────────────────────────────────────────*/
function Stage3Panel({ run, engine, push }) {
  const s3 = run.stage3;
  const st = run.status;

  // entry
  const started = s3.started && (s3.heroUrl || s3.prompts || ["generating_hero", "awaiting_hero_qc", "generating_remaining"].includes(st));
  if (!started && st === "awaiting_user") {
    return <Stage3Entry run={run} engine={engine} />;
  }
  if (st === "generating_hero") return <Spinner label={run.current_step || "Generating the hero shot from your source photos…"} />;
  if (st === "awaiting_hero_qc" && s3.heroUrl) return <HeroQC run={run} engine={engine} />;
  if (st === "generating_remaining") return <Spinner label={run.current_step || "Hero approved. Writing the 8 derivative prompts…"} />;
  if (st === "awaiting_qc" && s3.prompts) return <PromptQC run={run} engine={engine} push={push} />;
  if (st === "completed") return <CompletedReview run={run} engine={engine} push={push} />;
  return <Spinner label="Loading Stage 3…" />;
}

function Stage3Entry({ run, engine }) {
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-[var(--color-text-2)] leading-relaxed max-w-[64ch]">
        Stage 3 generates a <strong className="text-[var(--color-text)]">hero shot first</strong> from your source product photos. You approve it, then the other 8 images are built using the approved hero as the reference — so the product stays consistent.
      </p>
      <div className="flex gap-3 flex-wrap items-center">
        <Button onClick={engine.generateHero}><Icon.Spark className="w-3.5 h-3.5" /> Generate Stage 3 — Hero first <Icon.ArrowRight className="w-3.5 h-3.5" /></Button>
        <Button variant="secondary" onClick={engine.skipHero}>Skip hero — use source images</Button>
      </div>
      <p className="text-[11px] text-[var(--color-text-3)] max-w-md">"Skip hero" builds the 8 images straight from your source photos as the reference, instead of generating and approving a hero shot first.</p>
    </div>
  );
}

function HeroQC({ run, engine }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("A clean studio hero of the product on a warm neutral seamless, soft directional key light from upper-left, gentle falloff, subtle shadow, premium e-commerce styling, true-to-source materials and colour.");
  const [ai, setAi] = useState("");
  return (
    <div className="space-y-4">
      <h3 className="text-[15px] font-[600] text-[var(--color-text)]">Review the hero shot</h3>
      <ProductImage mesh={0} className="rounded-[var(--radius)] border border-[var(--color-border)] pop-in" style={{ width: "min(440px, 100%)", aspectRatio: "1 / 1" }}>
        <span className="absolute top-2.5 left-2.5 text-[9px] font-[700] uppercase tracking-wide bg-[var(--color-accent)] text-[var(--color-on-primary)] px-2 py-0.5 rounded-full">Hero · candidate</span>
      </ProductImage>
      <p className="text-[13px] text-[var(--color-text-2)] max-w-md">This hero becomes the reference for all other images. Make sure it matches the real product before continuing.</p>
      <div className="flex gap-3 flex-wrap">
        <Button onClick={engine.approveHero}>Approve hero — generate rest <Icon.ArrowRight className="w-3.5 h-3.5" /></Button>
        <Button variant="secondary" onClick={() => setEditing((v) => !v)}>{editing ? "Cancel edit" : "Regenerate hero"}</Button>
      </div>
      {editing && (
        <div className="space-y-3 max-w-2xl fade-in">
          <div className="border border-[var(--color-border)] rounded-[var(--radius-sm)] bg-[var(--color-accent-weak)] p-3 space-y-2">
            <label className="ff-mono text-[10px] uppercase tracking-widest text-[var(--color-accent-text)]">Edit with AI</label>
            <textarea value={ai} onChange={(e) => setAi(e.target.value)} rows={2} placeholder="e.g. warmer lighting, darker background, slight three-quarter angle"
              className="w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-md px-3 py-2 text-[12px] resize-y focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)]" />
            <Button size="sm" onClick={() => { if (ai.trim().length >= 5) { setDraft(draft + "\n\n[adjusted: " + ai.trim() + "]"); setAi(""); } }}>Rewrite prompt</Button>
          </div>
          <label className="ff-mono text-[10px] uppercase tracking-widest text-[var(--color-text-3)] block">Hero prompt (scene / lighting only)</label>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={7}
            className="w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-[var(--radius-sm)] px-3 py-2 text-[11px] ff-mono resize-y focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)]" />
          <Button onClick={() => { setEditing(false); engine.regenerateHero(); }}>Regenerate with this prompt</Button>
        </div>
      )}
    </div>
  );
}

function PromptQC({ run, engine, push }) {
  const [drafts, setDrafts] = useState(run.stage3.prompts.map((p) => ({ ...p })));
  const [gen, setGen] = useState(null); // {images:[], index}
  const stopRef = useRef(false);

  const setDraft = (i, prompt) => setDrafts((d) => d.map((p, j) => (j === i ? { ...p, prompt } : p)));

  const generateAll = async () => {
    stopRef.current = false;
    const results = drafts.map(() => null);
    setGen({ images: results, index: 0 });
    for (let i = 0; i < drafts.length; i++) {
      if (stopRef.current) break;
      setGen((g) => ({ ...g, index: i }));
      await new Promise((r) => setTimeout(r, 680));
      const fail = drafts[i].category === "before_after"; // one demo failure
      results[i] = {
        index: drafts[i].index, category: drafts[i].category, image_url: fail ? "" : "img",
        status: fail ? "failed" : "done", verdict: fail ? "fail" : "pass",
        issues: fail ? ["Before/after framing inconsistent with the hero — product angle drifted."] : [],
        user_override: null, mesh: drafts[i].index,
      };
      setGen({ images: [...results], index: i });
    }
    engine.completeStage3(results.filter(Boolean), drafts);
    setGen(null);
  };

  if (gen) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-[15px] font-[600] text-[var(--color-text)]">Generating the 8 images…</h3>
          <Button variant="danger" size="sm" onClick={() => { stopRef.current = true; }}><Icon.Stop className="w-3 h-3" /> Stop after current</Button>
        </div>
        <p className="ff-mono text-[11px] text-[var(--color-text-3)]">Image {Math.min(gen.index + 2, 9)} of 9 · all referencing the approved hero</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <ProductImage mesh={0} className="aspect-square rounded-[var(--radius)] border-2 border-[var(--color-green)]"><span className="absolute top-2 left-2 text-[9px] font-[700] uppercase bg-[var(--color-green)] text-[var(--color-on-primary)] px-2 py-0.5 rounded-full">Hero</span></ProductImage>
          {gen.images.map((im, i) => (
            <div key={i} className="aspect-square rounded-[var(--radius)] border border-[var(--color-border)] overflow-hidden relative">
              {im ? (im.status === "failed"
                ? <div className="w-full h-full grid place-items-center bg-[var(--color-red-bg)] text-[var(--color-red)] text-[10px] font-[700] uppercase">Failed</div>
                : <ProductImage mesh={im.mesh} className="w-full h-full pop-in" />)
                : (i === gen.index
                  ? <div className="w-full h-full grid place-items-center bg-[var(--color-surface-2)]"><Icon.Loader className="w-4 h-4 text-[var(--color-accent)]" /></div>
                  : <div className="w-full h-full shimmer bg-[var(--color-surface-2)]" />)}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[15px] font-[600] text-[var(--color-text)]">Review the 8 prompts</h3>
        <p className="text-[12px] text-[var(--color-text-3)]">Edit any prompt before generating. Each references the approved hero — they handle scene, lighting, and text only.</p>
      </div>
      <div className="space-y-3">
        {drafts.map((p, i) => (
          <Card key={i} className="p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[12px] font-[600] text-[var(--color-text)]">#{p.index} {p.image_type}</span>
              <span className="ff-mono text-[9px] bg-[var(--color-surface-2)] text-[var(--color-text-2)] border border-[var(--color-border)] px-2 py-0.5 rounded">{p.model}</span>
              {p.german_text && <span className="ff-mono text-[9px] text-[var(--color-text-3)] truncate max-w-xs">DE: {p.german_text}</span>}
            </div>
            <textarea value={p.prompt} onChange={(e) => setDraft(i, e.target.value)} rows={4}
              className="w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-[var(--radius-sm)] px-3 py-2 text-[11px] ff-mono resize-y focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)]" />
          </Card>
        ))}
      </div>
      <Button onClick={generateAll}>Generate 8 images <Icon.ArrowRight className="w-3.5 h-3.5" /></Button>
    </div>
  );
}

/* ── completed review ─────────────────────────────────────────────────────*/
function CompletedReview({ run, engine, push }) {
  const images = run.stage3.images;
  const placement = run.stage3.placement;
  const prompts = run.stage3.prompts || [];
  const heroUrl = run.stage3.heroUrl;
  const [regenIdx, setRegenIdx] = useState(null);
  const [busyIdx, setBusyIdx] = useState(null);
  const [placing, setPlacing] = useState(false);

  const promptFor = (im) => prompts.find((p) => p.index === im.index) || null;
  const setImages = (next) => engine.patch({ stage3: { ...run.stage3, images: next } });

  const toggleVerdict = (i) => {
    const im = images[i]; const cur = im.user_override ?? null; const auto = im.verdict ?? "pass";
    let nx; if (cur === null) nx = auto === "pass" ? "fail" : "pass"; else { const flip = cur === "pass" ? "fail" : "pass"; nx = flip === auto ? null : flip; }
    setImages(images.map((x, j) => (j === i ? { ...x, user_override: nx } : x)));
  };
  const regenerate = (i) => {
    setRegenIdx(null); setBusyIdx(i);
    setTimeout(() => {
      setImages(images.map((x, j) => (j === i ? { ...x, image_url: "img", status: "done", verdict: "pass", issues: [], user_override: null, mesh: x.index } : x)));
      setBusyIdx(null); push("Image regenerated", "success");
    }, 1500);
  };
  const replace = () => { setPlacing(true); setTimeout(() => setPlacing(false), 1100); };

  const passed = images.filter((im) => effVerdict(im) === "pass").length;
  const failed = images.filter((im) => effVerdict(im) === "fail").length;
  const fixable = images.map((im, i) => ({ im, i })).filter(({ im }) => im.status === "failed" || effVerdict(im) === "fail");

  const picks = placement ? [{ s: 1, idx: placement.section_1 }, { s: 2, idx: placement.section_2 }, { s: 3, idx: placement.section_3 }] : [];
  const pickedIdx = new Set(picks.map((p) => p.idx));
  const entries = images.map((im, i) => ({ im, i }));
  const sectionEntries = picks.map((p) => ({ ...p, entry: entries.find((e) => e.im.index === p.idx) })).filter((p) => p.entry);
  const productEntries = entries.filter((e) => !pickedIdx.has(e.im.index));

  const tile = (im, i) => {
    const v = effVerdict(im); const overridden = im.user_override != null; const regenerating = busyIdx === i;
    const failReason = im.status === "failed" ? (im.error || "generation failed") : (im.issues?.[0] || "");
    return (
      <div className={window.cx("aspect-square rounded-[var(--radius)] border overflow-hidden relative group", (v === "fail" || im.status === "failed") ? "border-[color-mix(in_srgb,var(--color-red)_60%,transparent)]" : "border-[var(--color-border)]")}>
        {regenerating && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-black/65 backdrop-blur-[2px]">
            <Icon.Loader className="w-4 h-4 text-white" /><span className="text-[10px] text-white ff-mono uppercase tracking-wide">Generating…</span>
          </div>
        )}
        {im.image_url ? (
          <>
            <ProductImage mesh={im.mesh ?? im.index} className={window.cx("w-full h-full", v === "fail" && "opacity-80")} />
            {v && (
              <button onClick={() => toggleVerdict(i)} title={overridden ? `Overridden — auditor said ${im.verdict}` : `Auditor: ${im.verdict}. Click to override.`}
                className={window.cx("absolute top-2 left-2 text-[9px] font-[700] uppercase tracking-wide px-2 py-0.5 rounded-full text-white cursor-pointer", v === "pass" ? "bg-[var(--color-green)]" : "bg-[var(--color-red)]", overridden && "ring-1 ring-white/60")}>
                {v}{overridden ? "•" : ""}
              </button>
            )}
            <div className="absolute bottom-0 left-0 right-0 z-20 p-2 flex items-center justify-end gap-1 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => setRegenIdx(i)} className="px-2 py-1 bg-white/15 hover:bg-white/25 text-white text-[10px] ff-mono rounded cursor-pointer">Regenerate</button>
              <button onClick={() => push("Image downloaded", "success")} className="px-2 py-1 bg-white/15 hover:bg-white/25 text-white text-[10px] ff-mono rounded cursor-pointer">↓</button>
            </div>
            {v === "fail" && failReason && (
              <button onClick={() => setRegenIdx(i)} className="absolute bottom-0 left-0 right-0 z-10 text-left px-2 py-1.5 bg-[color-mix(in_srgb,var(--color-red)_90%,transparent)] text-white cursor-pointer">
                <span className="block text-[8.5px] font-[700] uppercase tracking-wide">Failed · tap to fix</span>
                <span className="block text-[9px] opacity-90 leading-snug line-clamp-2">{failReason}</span>
              </button>
            )}
          </>
        ) : (
          <button onClick={() => setRegenIdx(i)} className="absolute inset-0 flex flex-col items-center justify-center p-3 gap-1.5 cursor-pointer bg-[var(--color-red-bg)] text-center">
            <span className="text-[var(--color-red)] font-[700] text-[11px]">Failed</span>
            <span className="text-[var(--color-text-2)] text-[10px] line-clamp-3">{failReason}</span>
            <span className="mt-1 text-[9px] font-[700] uppercase tracking-wide text-[var(--color-red)]">Tap to regenerate</span>
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h3 className="text-[15px] font-[600] text-[var(--color-text)]">{heroUrl ? "Stage 3 complete · hero + 8" : "Stage 3 images"}</h3>
        <span className="text-[11px] text-[var(--color-green)]">{passed} pass</span>
        {failed > 0 && <span className="text-[11px] text-[var(--color-red)]">{failed} fail</span>}
        {fixable.length > 0 && (
          <Button variant="danger" size="sm" onClick={() => fixable.forEach(({ i }) => regenerate(i))}>Fix all {fixable.length} failed <Icon.ArrowRight className="w-3 h-3" /></Button>
        )}
        <Button variant="secondary" size="sm" onClick={() => push("Bundled hero + 8 → .zip", "success")}>↓ Download all (.zip)</Button>
      </div>
      <div className="flex items-center justify-between gap-3 flex-wrap -mt-1">
        <p className="text-[11px] text-[var(--color-text-3)] max-w-xl">The AI looked at the images and placed one lifestyle/benefit shot into each of the 3 body sections (hook → solution → reassurance). Everything else is a product shot for the top of the page.</p>
        <Button variant="secondary" size="sm" onClick={replace} disabled={placing}>{placing ? <><Icon.Loader className="w-3.5 h-3.5" /> Placing…</> : "↺ Re-run auto-placement"}</Button>
      </div>

      {/* product shots */}
      <div className="space-y-2">
        <p className="eyebrow text-[var(--color-text-2)]">Top of page · product shots <span className="text-[var(--color-text-4)] font-[500] normal-case tracking-normal">— {productEntries.length + (heroUrl ? 1 : 0)} images</span></p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {heroUrl && (
            <div className="flex flex-col gap-1.5">
              <ProductImage mesh={0} className="aspect-square rounded-[var(--radius)] border-2 border-[var(--color-green)] group">
                <span className="absolute top-2 left-2 text-[9px] font-[700] uppercase tracking-wide bg-[var(--color-green)] text-[var(--color-on-primary)] px-2 py-0.5 rounded-full">Hero</span>
              </ProductImage>
              <div className="px-0.5"><p className="text-[10px] font-[680] uppercase tracking-wide text-[var(--color-green)]">Hero shot</p><p className="text-[10px] text-[var(--color-text-3)]">Main product image</p></div>
            </div>
          )}
          {productEntries.map(({ im, i }) => (
            <div key={i} className="flex flex-col gap-1.5">
              {tile(im, i)}
              <div className="px-0.5"><p className="text-[10px] font-[680] uppercase tracking-wide text-[var(--color-text-2)]">{catLabel(im.category)}</p><p className="text-[10px] text-[var(--color-text-3)]">Product shot</p></div>
            </div>
          ))}
        </div>
      </div>

      {/* body sections */}
      {sectionEntries.length > 0 && (
        <div className="space-y-2">
          <p className="eyebrow text-[var(--color-text-2)]">Body sections · one image each <span className="text-[var(--color-text-4)] font-[500] normal-case tracking-normal">— problem → solution → proof</span></p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {sectionEntries.map(({ s, entry }) => {
              const { im, i } = entry; const copy = (promptFor(im)?.german_text || "").trim();
              return (
                <div key={i} className="flex flex-col gap-1.5">
                  {tile(im, i)}
                  <div className="px-0.5">
                    <p className="text-[10px] font-[680] uppercase tracking-wide text-[var(--color-accent-text)]">Section {s} · {catLabel(im.category)}</p>
                    {copy && <p className="text-[10px] text-[var(--color-text-3)] leading-snug line-clamp-2">Goes with: "{copy}"</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {regenIdx != null && images[regenIdx] && (
        <RegenModal image={images[regenIdx]} prompt={promptFor(images[regenIdx])} onClose={() => setRegenIdx(null)} onRegenerate={() => regenerate(regenIdx)} />
      )}
    </div>
  );
}

function RegenModal({ image, prompt, onClose, onRegenerate }) {
  const issues = image.issues?.filter(Boolean) || [];
  const [draft, setDraft] = useState(prompt?.prompt || "");
  const [ai, setAi] = useState(issues.length ? "Fix the audit issues:\n- " + issues.join("\n- ") : "");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm fade-in-soft" onClick={onClose} />
      <Card className="relative shadow-[var(--shadow-pop)] p-6 max-w-2xl w-full space-y-4 max-h-[90vh] overflow-y-auto rise">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-[640] text-[var(--color-text)]">Regenerate #{image.index} · {catLabel(image.category)}</h3>
            {issues.length > 0 && <p className="text-[11px] text-[var(--color-red)] mt-1">Auditor flagged: {issues[0]}</p>}
          </div>
          <button onClick={onClose} className="cursor-pointer text-[var(--color-text-3)] hover:text-[var(--color-text)]"><Icon.X className="w-4 h-4" /></button>
        </div>
        <ProductImage mesh={image.mesh ?? image.index} className="rounded-[var(--radius-sm)] border border-[var(--color-border)]" style={{ width: "100%", aspectRatio: "4 / 3" }} />
        <div className="border border-[var(--color-border)] rounded-[var(--radius-sm)] bg-[var(--color-accent-weak)] p-3 space-y-2">
          <label className="ff-mono text-[10px] uppercase tracking-widest text-[var(--color-accent-text)]">Edit with AI</label>
          <textarea value={ai} onChange={(e) => setAi(e.target.value)} rows={2}
            className="w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-md px-3 py-2 text-[12px] resize-y focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)]" />
          <Button size="sm" onClick={() => { if (ai.trim().length >= 5) setDraft(draft + "\n\n[adjusted: " + ai.trim() + "]"); }}>Rewrite prompt</Button>
        </div>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={5}
          className="w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-[var(--radius-sm)] px-3 py-2 text-[11px] ff-mono resize-y focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)]" />
        <div className="flex items-center gap-2">
          <Button onClick={onRegenerate}><Icon.Refresh className="w-3.5 h-3.5" /> Regenerate image</Button>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </Card>
    </div>
  );
}

window.Stage3Panel = Stage3Panel;
