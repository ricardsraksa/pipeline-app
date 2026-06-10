/* ============================================================================
   home2.jsx — v2 inbox Home: Needs you → Running → Recent, with search.
   Exposes HomeV2.
   ============================================================================ */

const V2_ACTIVE = new Set(["pending","scraping","stage1","stage2","generating_hero","generating_remaining"]);
const V2_WAITING = new Set(["awaiting_stage2_approval","awaiting_user","awaiting_qc","awaiting_hero_qc"]);

const NEED_COPY = {
  awaiting_stage2_approval: ["Research ready for review", "Approve it to generate the German copy"],
  awaiting_user: ["Copy approved — images next", "Start Stage 3 to generate the hero shot"],
  awaiting_hero_qc: ["Hero shot needs approval", "It becomes the reference for all 8 images"],
  awaiting_qc: ["8 prompts ready to review", "Check them, then generate the images"],
  failed: ["Run failed", "Resume to pick up where it stopped"],
};

function HomeV2({ runs, onOpen, onNew, onDelete }) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const match = (r) => !query || `${r.brand_name || ""} ${r.product_name || ""} #${r.id}`.toLowerCase().includes(query);

  const needs = runs.filter((r) => (V2_WAITING.has(r.status) || r.status === "failed") && match(r));
  const running = runs.filter((r) => V2_ACTIVE.has(r.status) && match(r));
  const recent = runs.filter((r) => ["completed", "cancelled"].includes(r.status) && match(r));

  const thumb = (r, size) => (
    <div className={window.cx("rounded-[var(--radius-sm)] overflow-hidden shrink-0 border border-[var(--color-border)]", size)}>
      <MeshThumb m1={window.PD.MESH[r.id % 9][0]} m2={window.PD.MESH[r.id % 9][1]} className="w-full h-full" />
    </div>
  );

  return (
    <div className="px-6 py-8 max-w-[880px] mx-auto" data-screen-label="Home">
      {/* header row */}
      <div className="flex items-center justify-between gap-4 mb-7 flex-wrap">
        <div>
          <h1 className="text-[26px] leading-tight font-bold tracking-tight ff-display text-[var(--color-text)]">Pipeline</h1>
          <p className="text-[13px] text-[var(--color-text-2)] mt-0.5">
            {needs.length > 0 ? <><strong className="text-[var(--color-amber)]">{needs.length} run{needs.length > 1 ? "s" : ""} need{needs.length === 1 ? "s" : ""} you</strong> · {running.length} running</> : <>{running.length} running · all caught up</>}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-3)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
              className="w-[170px] pl-8 pr-3 py-[8px] text-[12.5px] rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-text-4)] focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)]" />
          </div>
          <Button onClick={onNew}><Icon.Plus className="w-3.5 h-3.5" /> New run</Button>
        </div>
      </div>

      {/* ── needs you ── */}
      {needs.length > 0 && (
        <section className="mb-7">
          <Eyebrow className="block mb-2.5 text-[var(--color-amber)]">Needs you · {needs.length}</Eyebrow>
          <div className="space-y-2.5">
            {needs.map((r) => {
              const [title, sub] = NEED_COPY[r.status] || ["Waiting", ""];
              const failed = r.status === "failed";
              return (
                <button key={r.id} onClick={() => onOpen(r.id)}
                  className="w-full text-left flex items-center gap-3.5 px-4 py-3.5 rounded-[var(--radius)] border bg-[var(--color-surface)] shadow-[var(--shadow-card)] tr cursor-pointer hover:border-[var(--color-text-3)] group"
                  style={{ borderColor: `color-mix(in srgb, ${failed ? "var(--color-red)" : "var(--color-amber)"} 35%, var(--color-border))` }}>
                  {thumb(r, "w-11 h-11")}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <p className="text-[14px] font-[650] text-[var(--color-text)] truncate">{r.brand_name || r.product_name}</p>
                      <span className="ff-mono text-[10px] text-[var(--color-text-4)]">#{r.id}</span>
                    </div>
                    <p className="text-[12.5px] truncate mt-0.5">
                      <span className={failed ? "text-[var(--color-red)] font-[600]" : "text-[var(--color-amber)] font-[600]"}>{title}</span>
                      <span className="text-[var(--color-text-3)]"> — {sub}</span>
                    </p>
                  </div>
                  <span className="ff-mono text-[10.5px] text-[var(--color-text-4)] shrink-0 hidden sm:block">{relativeTime(r.last_updated_at)}</span>
                  <span className="shrink-0 inline-flex items-center gap-1.5 px-3 py-[7px] rounded-[var(--radius-sm)] text-[12.5px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] group-hover:brightness-110 tr">
                    {failed ? "Resume" : "Review"} <Icon.ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ── running ── */}
      {running.length > 0 && (
        <section className="mb-7">
          <Eyebrow className="block mb-2.5">Running · {running.length}</Eyebrow>
          <div className="space-y-2">
            {running.map((r) => (
              <button key={r.id} onClick={() => onOpen(r.id)}
                className="w-full text-left flex items-center gap-3.5 px-4 py-3 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] tr cursor-pointer hover:border-[var(--color-text-3)]">
                {thumb(r, "w-9 h-9")}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <p className="text-[13.5px] font-[620] text-[var(--color-text)] truncate">{r.brand_name || r.product_name}</p>
                    <span className="ff-mono text-[10px] text-[var(--color-text-4)]">#{r.id}</span>
                  </div>
                  {r.current_step && (
                    <p className="text-[12px] text-[var(--color-accent-text)] truncate mt-0.5 flex items-center gap-1.5 ff-mono">
                      <span className="w-1 h-1 rounded-full bg-[var(--color-green)] pulse-dot shrink-0" />{r.current_step}
                    </p>
                  )}
                </div>
                <StatusBadge status={r.status} />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── recent ── */}
      <section>
        <Eyebrow className="block mb-2.5">Recent · {recent.length}</Eyebrow>
        {recent.length === 0 && needs.length === 0 && running.length === 0 ? (
          <Card className="px-6 py-12 text-center">
            <p className="text-[14px] font-[600] text-[var(--color-text)] mb-1">{query ? `Nothing matches "${q}"` : "No runs yet"}</p>
            {!query && <p className="text-[12.5px] text-[var(--color-text-3)] mb-4">Describe a product and drop a few photos — the pipeline does the rest.</p>}
            {!query && <Button onClick={onNew}><Icon.Plus className="w-3.5 h-3.5" /> Start your first run</Button>}
          </Card>
        ) : (
          <Card className="overflow-hidden">
            {recent.map((r) => (
              <div key={r.id} onClick={() => onOpen(r.id)}
                className="group flex items-center gap-3.5 px-4 py-3 border-b border-[var(--color-border)] last:border-0 cursor-pointer tr hover:bg-[var(--color-surface-2)]">
                {thumb(r, "w-9 h-9")}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <p className="text-[13.5px] font-[620] text-[var(--color-text)] truncate">{r.brand_name || r.product_name}</p>
                    <span className="ff-mono text-[10px] text-[var(--color-text-4)]">#{r.id}</span>
                  </div>
                  <p className="ff-mono text-[11px] text-[var(--color-text-3)] truncate">{truncateUrl(r.product_url, 44)}</p>
                </div>
                <span className="ff-mono text-[10.5px] text-[var(--color-text-4)] hidden sm:block">{relativeTime(r.last_updated_at)}</span>
                <StatusBadge status={r.status} />
                <button onClick={(e) => { e.stopPropagation(); onDelete(r.id); }} title="Delete run" aria-label={`Delete run #${r.id}`}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 grid place-items-center w-7 h-7 rounded-[var(--radius-sm)] text-[var(--color-text-3)] hover:text-[var(--color-red)] hover:bg-[var(--color-red-bg)] tr cursor-pointer shrink-0">
                  <Icon.Trash className="w-[15px] h-[15px]" />
                </button>
              </div>
            ))}
            {recent.length === 0 && <p className="px-4 py-6 text-center text-[12.5px] text-[var(--color-text-3)]">Completed runs land here.</p>}
          </Card>
        )}
      </section>
    </div>
  );
}

window.HomeV2 = HomeV2;
