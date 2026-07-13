/* ============================================================================
   engine.jsx — icons, helpers, shared UI atoms, and the prototype run engine.
   Exposes everything on window for the other babel scripts.
   ============================================================================ */
const { useState, useEffect, useRef, useCallback, useMemo } = React;

/* ───────────────────────────── Icons ─────────────────────────────────────*/
const ib = (cn) => ({ className: cn || "w-4 h-4", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" });
const Icon = {
  Plus:    (p) => <svg {...ib(p.className)}><path d="M12 5v14M5 12h14"/></svg>,
  Runs:    (p) => <svg {...ib(p.className)}><path d="M4 6h16M4 12h16M4 18h16"/></svg>,
  Settings:(p) => <svg {...ib(p.className)}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  ArrowRight:(p)=> <svg {...ib(p.className)}><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>,
  ArrowLeft:(p) => <svg {...ib(p.className)}><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>,
  ChevronRight:(p)=> <svg {...ib(p.className)}><path d="m9 18 6-6-6-6"/></svg>,
  Check:   (p) => <svg {...ib(p.className)} strokeWidth={p.strokeWidth||1.6}><path d="M20 6 9 17l-5-5"/></svg>,
  X:       (p) => <svg {...ib(p.className)} strokeWidth={p.strokeWidth||1.6}><path d="M18 6 6 18M6 6l12 12"/></svg>,
  Download:(p) => <svg {...ib(p.className)}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>,
  Play:    (p) => <svg {...ib(p.className)} fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg>,
  Refresh: (p) => <svg {...ib(p.className)}><path d="M3 12a9 9 0 0 1 15.5-6.4L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.4L3 16"/><path d="M3 21v-5h5"/></svg>,
  Alert:   (p) => <svg {...ib(p.className)}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>,
  Loader:  (p) => <svg {...ib((p.className||"w-4 h-4")+" spin")}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>,
  ExternalLink:(p)=> <svg {...ib(p.className)}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg>,
  Spark:   (p) => <svg {...ib(p.className)}><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>,
  Image:   (p) => <svg {...ib(p.className)}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>,
  ThumbsUp:(p) => <svg {...ib(p.className)} strokeWidth="2"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H7V10l5-8 2 1.06A2 2 0 0 1 15 5.88z"/></svg>,
  ThumbsDown:(p)=> <svg {...ib(p.className)} strokeWidth="2"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H17v12l-5 8-2-1.06A2 2 0 0 1 9 18.12z"/></svg>,
  Pencil:  (p) => <svg {...ib(p.className)} strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  Sun:     (p) => <svg {...ib(p.className)}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/></svg>,
  Moon:    (p) => <svg {...ib(p.className)}><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>,
  Stop:    (p) => <svg {...ib(p.className)} fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>,
  Trash:   (p) => <svg {...ib(p.className)}><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>,
  Dot:     (p) => <svg {...ib(p.className)} fill="currentColor" stroke="none"><circle cx="12" cy="12" r="5"/></svg>,
  Logo:    (p) => <svg className={p.className||"w-4 h-4"} viewBox="0 0 24 24" fill="none"><path d="M4 18V6l7 5-7 5z" fill="currentColor"/><path d="M12 18V6l8 6-8 6z" fill="currentColor" opacity="0.45"/></svg>,
};

/* ─────────────────────────── Helpers ─────────────────────────────────────*/
const STATUS_LABEL = {
  pending:"Starting…", scraping:"Stage 1 · Research", stage1:"Stage 1 · Research",
  awaiting_stage2_approval:"Awaiting your review", stage2:"Stage 2 · Copy",
  awaiting_user:"Awaiting review", awaiting_qc:"Awaiting QC",
  generating_hero:"Stage 3 · Hero", awaiting_hero_qc:"Stage 3 · Review hero",
  generating_remaining:"Stage 3 · Prompts", completed:"Complete", failed:"Failed", cancelled:"Cancelled",
};
const statusLabel = (s) => STATUS_LABEL[s] || s;

function elapsedTime(startedAt, finishedAt) {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const sec = Math.max(0, Math.round((end - start) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}
function relativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60); if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60); if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24); if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}
function truncateUrl(url, max = 52) {
  if (!url) return "Description-only run";
  try { const u = new URL(url); const d = u.hostname.replace(/^www\./, "") + u.pathname;
    return d.length > max ? d.slice(0, max) + "…" : d; } catch { return url.slice(0, max); }
}

// stage state for the 3-node pipeline
function getStageState(run, stage) {
  const o = run.outputs;
  const failedAt = run.status !== "failed" ? null : (o.stage2Output ? "stage3" : o.onePager ? "stage2" : "stage1");
  if (failedAt === stage) return "error";
  if (stage === "stage1") {
    if (o.onePager) return "complete";
    if (["stage1","scraping","pending"].includes(run.status)) return "running";
    return "pending";
  }
  if (stage === "stage2") {
    if (o.stage2Output) return "complete";
    if (run.status === "stage2") return "running";
    if (run.status === "awaiting_stage2_approval") return "waiting";
    return "pending";
  }
  // stage3
  if (run.status === "completed") return "complete";
  if (["awaiting_user","awaiting_qc","awaiting_hero_qc"].includes(run.status)) return "waiting";
  if (["generating_hero","generating_remaining"].includes(run.status)) return "running";
  if (o.stage2Output && run.status !== "awaiting_stage2_approval") return run.status==="stage2"?"pending":"pending";
  return "pending";
}

/* ─────────────────────────── UI atoms ────────────────────────────────────*/
const cx = (...a) => a.filter(Boolean).join(" ");

function Button({ variant = "primary", size = "md", className, children, ...rest }) {
  const sz = size === "sm" ? "px-3 py-[7px] text-[12.5px]" : "px-[15px] py-[9px] text-[13.5px]";
  const variants = {
    primary: "bg-[var(--color-primary)] text-[var(--color-on-primary)] border-transparent hover:brightness-110 disabled:opacity-40",
    secondary: "border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] hover:border-[var(--color-text-3)] hover:bg-[var(--color-surface-2)] disabled:opacity-50",
    ghost: "border-transparent bg-transparent text-[var(--color-text-2)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
    danger: "border-[color-mix(in_srgb,var(--color-red)_50%,transparent)] bg-[var(--color-red-bg)] text-[var(--color-red)] hover:brightness-95 disabled:opacity-50",
  };
  return (
    <button {...rest} className={cx("cursor-pointer inline-flex items-center gap-[7px] rounded-[var(--radius-sm)] font-[620] border tr whitespace-nowrap disabled:cursor-not-allowed", sz, variants[variant], className)}>
      {children}
    </button>
  );
}

function Card({ className, children, hover, ...rest }) {
  return (
    <div {...rest} className={cx("border border-[var(--color-border)] rounded-[var(--radius)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]", hover && "tr hover:border-[var(--color-border-strong)]", className)}>
      {children}
    </div>
  );
}

function StatusBadge({ status, stuck }) {
  let tone = "accent", label = statusLabel(status), pulse = false;
  if (stuck) { tone = "amber"; label = "Stuck"; }
  else if (status === "completed") { tone = "green"; label = "Complete"; }
  else if (status === "failed") { tone = "red"; }
  else if (status === "cancelled") { tone = "gray"; }
  else if (["awaiting_user","awaiting_qc","awaiting_stage2_approval","awaiting_hero_qc"].includes(status)) { tone = "amber"; }
  else { pulse = true; }
  const map = {
    accent: ["var(--color-accent-weak)","var(--color-accent)"],
    green: ["var(--color-green-bg)","var(--color-green)"],
    amber: ["var(--color-amber-bg)","var(--color-amber)"],
    red: ["var(--color-red-bg)","var(--color-red)"],
    gray: ["var(--color-gray-bg)","var(--color-gray)"],
  };
  const [bg, fg] = map[tone];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-[620] px-2.5 py-1 rounded-full whitespace-nowrap" style={{ background: bg, color: fg }}>
      <span className={cx("w-1.5 h-1.5 rounded-full bg-current shrink-0", pulse && "pulse-dot")} />
      {label}
    </span>
  );
}

function Eyebrow({ children, className }) {
  return <span className={cx("eyebrow whitespace-nowrap", className)}>{children}</span>;
}

function Spinner({ label }) {
  return (
    <div className="border border-dashed border-[var(--color-border)] rounded-[var(--radius)] px-4 py-9 text-center bg-[var(--color-surface)] fade-in">
      <Icon.Loader className="w-4 h-4 text-[var(--color-accent)] mx-auto mb-2.5" />
      <p className="text-[12.5px] text-[var(--color-text-2)] ff-mono">{label}</p>
    </div>
  );
}

function ErrBox({ msg }) {
  return (
    <div className="flex items-start gap-2 px-4 py-3 rounded-[var(--radius-sm)] bg-[var(--color-red-bg)] border border-[color-mix(in_srgb,var(--color-red)_30%,transparent)] fade-in">
      <Icon.Alert className="w-4 h-4 text-[var(--color-red)] flex-shrink-0 mt-px" />
      <p className="text-[12px] text-[var(--color-red)] leading-relaxed">{msg}</p>
    </div>
  );
}

// tiny toast system
function useToasts() {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, tone = "default") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, msg, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);
  return { toasts, push };
}
function Toasts({ toasts }) {
  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 items-end pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="rise pointer-events-auto flex items-center gap-2.5 px-4 py-2.5 rounded-[var(--radius-sm)] bg-[var(--color-surface)] border border-[var(--color-border-strong)] shadow-[var(--shadow-pop)]">
          {t.tone === "success"
            ? <span className="grid place-items-center w-4 h-4 rounded-full bg-[var(--color-green)] text-[var(--color-on-primary)]"><Icon.Check className="w-3 h-3" strokeWidth={3}/></span>
            : <Icon.Spark className="w-4 h-4 text-[var(--color-accent)]"/>}
          <span className="text-[12.5px] font-[550] text-[var(--color-text)]">{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────── Run engine / builders ───────────────────────────*/
let RUN_SEQ = 249;
function newSources(n) {
  const M = window.PD.MESH;
  return Array.from({ length: n }, (_, i) => ({ m1: M[i % M.length][0], m2: M[i % M.length][1] }));
}

function makeLiveRun() {
  const P = window.PD.HERO_PRODUCT;
  return {
    id: RUN_SEQ++,
    brand_name: null, // discovered during stage 1
    product_name: P.product_name,
    product_url: P.product_url,
    product_description: P.product_description,
    sources: newSources(P.sources),
    status: "pending",
    current_step: "Queued…",
    startedAt: new Date().toISOString(),
    completedAt: null,
    scrapeErrors: [{ url: "https://www.walmart.com/ip/neck-traction.html", error: "403 — blocked by site" }],
    outputs: { onePager: null, onePagerEdited: null, stage2Output: null, stage2OutputEdited: null, stage2EditedAt: null },
    feedback: { stage1: null, stage1Note: "", stage2: null, stage2Note: "" },
    stage3: { started: false, heroUrl: null, prompts: null, images: [], placement: null, usedHero: true },
    live: true,
  };
}

// Build a fully-shaped run object from a Runs-list seed, populated to match status.
function buildRunFromSeed(seed) {
  const PD = window.PD;
  const done = seed.status === "completed";
  const hasCopy = done || ["awaiting_qc","awaiting_user","awaiting_hero_qc","generating_hero","generating_remaining"].includes(seed.status);
  const hasResearch = hasCopy || ["awaiting_stage2_approval","stage2"].includes(seed.status);
  const run = {
    id: seed.id, brand_name: seed.brand_name, product_name: seed.product_name,
    product_url: seed.product_url,
    product_description: PD.HERO_PRODUCT.product_description,
    sources: newSources(3),
    status: seed.status, current_step: seed.current_step,
    startedAt: seed.created_at, completedAt: done ? seed.last_updated_at : null,
    scrapeErrors: [],
    outputs: {
      onePager: hasResearch ? PD.ONE_PAGER : null, onePagerEdited: null,
      stage2Output: hasCopy ? PD.SAMPLE_COPY : null, stage2OutputEdited: null, stage2EditedAt: null,
    },
    feedback: { stage1: done ? "up" : null, stage1Note: "", stage2: null, stage2Note: "" },
    stage3: { started: hasCopy, heroUrl: null, prompts: null, images: [], placement: null, usedHero: true },
    live: false,
  };
  if (seed.status === "awaiting_qc") { run.stage3.heroUrl = "hero"; run.stage3.prompts = PD.REMAINING_PROMPTS; }
  if (done) {
    run.stage3.heroUrl = "hero";
    run.stage3.prompts = PD.REMAINING_PROMPTS;
    run.stage3.images = PD.REMAINING_PROMPTS.map((p, i) => ({
      index: p.index, category: p.category, image_url: "img", status: "done",
      verdict: "pass", issues: [], user_override: null, mesh: i,
    }));
    run.stage3.placement = { section_1: 3, section_2: 5, section_3: 9, reasons: {} };
  }
  return run;
}

/* expose */
Object.assign(window, {
  Icon, Button, Card, StatusBadge, Eyebrow, Spinner, ErrBox, Toasts, useToasts,
  cx, statusLabel, elapsedTime, relativeTime, truncateUrl, getStageState,
  makeLiveRun, buildRunFromSeed,
});
