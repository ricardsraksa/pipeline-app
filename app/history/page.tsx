import Link from "next/link";

interface RunSummary {
  id: number;
  created_at: string;
  product_url: string;
  product_name: string;
  brand_name: string | null;
  status: string | null;
  doc_count: number;
  feedback_stage1: string | null;
  feedback_stage2: string | null;
  feedback_stage3: string | null;
  notes: string | null;
  current_step: string | null;
  last_updated_at: string | null;
}

async function getRuns(): Promise<RunSummary[]> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/runs`, { cache: "no-store" });
    const data = await res.json();
    return data.runs ?? [];
  } catch {
    return [];
  }
}

const ACTIVE_STATUSES = new Set(["pending", "scraping", "stage1", "stage2"]);

function isStuck(run: RunSummary): boolean {
  if (!run.last_updated_at) return false;
  const ageMs = Date.now() - new Date(run.last_updated_at).getTime();
  return ageMs > 10 * 60 * 1000 && run.status !== "completed" && run.status !== "awaiting_user" && run.status !== "awaiting_qc";
}

function runAction(run: RunSummary): "view-live" | "continue" | "view" {
  if (ACTIVE_STATUSES.has(run.status ?? "")) return "view-live";
  if (run.status === "failed" || isStuck(run)) return "continue";
  return "view";
}

function StatusPill({ status }: { status: string | null }) {
  const s = status ?? "";
  if (!s) return null;
  const variants: Record<string, string> = {
    complete:      "bg-emerald-950/60 text-emerald-400 border-emerald-900/50",
    completed:     "bg-emerald-950/60 text-emerald-400 border-emerald-900/50",
    partial:       "bg-amber-950/60  text-amber-400  border-amber-900/50",
    failed:        "bg-red-950/60    text-red-400    border-red-900/50",
    scraping:      "bg-blue-950/60   text-blue-400   border-blue-900/50",
    stage1:        "bg-blue-950/60   text-blue-400   border-blue-900/50",
    stage2:        "bg-blue-950/60   text-blue-400   border-blue-900/50",
    awaiting_user: "bg-amber-950/60  text-amber-400  border-amber-900/50",
    awaiting_qc:   "bg-amber-950/60  text-amber-400  border-amber-900/50",
    pending:       "bg-zinc-900      text-zinc-500   border-zinc-800",
  };
  const isActive = ACTIVE_STATUSES.has(s);
  const cls = variants[s] ?? "bg-zinc-900 text-zinc-500 border-zinc-800";
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono border tracking-wider uppercase ${cls}`}>
      <span className={`w-1 h-1 rounded-full bg-current opacity-80 ${isActive ? "animate-pulse" : ""}`} />
      {s}
    </span>
  );
}

function truncateUrl(url: string, max = 52): string {
  try {
    const u = new URL(url);
    const d = u.hostname + u.pathname;
    return d.length > max ? d.slice(0, max) + "…" : d;
  } catch {
    return url.slice(0, max);
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("de-DE", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

export default async function HistoryPage() {
  const runs = await getRuns();

  return (
    <main className="min-h-screen bg-zinc-950 pb-24">
      <div className="max-w-3xl mx-auto px-6 pt-10">
        {/* Page header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="font-mono text-[11px] text-zinc-100 uppercase tracking-widest">Runs</h1>
            <span className="font-mono text-[10px] text-zinc-600 bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded-full">
              {runs.length}
            </span>
          </div>
          <p className="text-zinc-500 text-sm">
            {runs.length === 0 ? "No runs yet." : `${runs.length} run${runs.length !== 1 ? "s" : ""} saved.`}
          </p>
        </div>

        {/* Empty state */}
        {runs.length === 0 && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 py-20 text-center">
            <p className="font-mono text-sm text-zinc-600 mb-3">No runs yet.</p>
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 px-4 py-2 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 rounded-lg text-sm transition-colors"
            >
              Start your first run
            </Link>
          </div>
        )}

        {/* Run list */}
        {runs.length > 0 && (
          <div className="space-y-2">
            {runs.map((run) => {
              const name = run.brand_name ?? run.product_name ?? "(unnamed)";
              const action = runAction(run);
              const href = action === "view" ? `/history/${run.id}` : `/runs/${run.id}`;
              const actionLabel = action === "view-live" ? "View Live →" : action === "continue" ? "Continue →" : "View →";
              const isActive = ACTIVE_STATUSES.has(run.status ?? "");
              return (
                <Link
                  key={run.id}
                  href={href}
                  className={`group flex items-center gap-4 rounded-xl border px-5 py-3.5 transition-all duration-100 ${
                    isActive
                      ? "border-blue-900/50 bg-blue-950/20 hover:bg-blue-950/30"
                      : "border-zinc-800 bg-zinc-900/40 hover:bg-zinc-900/70 hover:border-zinc-700"
                  }`}
                >
                  {/* Identity */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className="font-mono text-[13px] text-zinc-100 truncate">{name}</span>
                      <span className="font-mono text-[9px] text-zinc-600 flex-shrink-0">#{run.id}</span>
                    </div>
                    <p className="text-zinc-500 text-[10px] font-mono truncate">{truncateUrl(run.product_url)}</p>
                    {isActive && run.current_step && (
                      <p className="text-blue-400/70 text-[10px] font-mono mt-0.5 truncate">{run.current_step}</p>
                    )}
                  </div>

                  {/* Meta */}
                  <div className="hidden sm:flex items-center gap-3 flex-shrink-0">
                    <StatusPill status={run.status} />
                    {run.doc_count > 0 && (
                      <span className="text-zinc-600 text-[10px] font-mono">
                        {run.doc_count} doc{run.doc_count !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>

                  {/* Date + action */}
                  <div className="flex-shrink-0 text-right">
                    <p className="text-zinc-500 text-[10px] font-mono">{formatDate(run.created_at)}</p>
                    <p className={`text-[10px] font-mono opacity-0 group-hover:opacity-100 transition-opacity mt-0.5 ${
                      action === "continue" ? "text-amber-400" : "text-blue-400"
                    }`}>
                      {actionLabel}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
