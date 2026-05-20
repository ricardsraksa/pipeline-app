import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

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
    const baseUrl = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/runs`, { cache: "no-store" });
    if (!res.ok) return [];
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
  return (
    ageMs > 10 * 60 * 1000 &&
    run.status !== "completed" &&
    run.status !== "awaiting_user" &&
    run.status !== "awaiting_qc" &&
    run.status !== "failed"
  );
}

type RunAction = "view-live" | "continue" | "view";

function runAction(run: RunSummary): RunAction {
  if (ACTIVE_STATUSES.has(run.status ?? "")) return "view-live";
  if (run.status === "failed" || isStuck(run)) return "continue";
  return "view";
}

type Tone = "active" | "success" | "warn" | "danger" | "muted";

const STATUS_META: Record<string, { label: string; tone: Tone }> = {
  pending:       { label: "Pending",       tone: "muted" },
  scraping:      { label: "Scraping",      tone: "active" },
  stage1:        { label: "Stage 1",       tone: "active" },
  stage2:        { label: "Stage 2",       tone: "active" },
  awaiting_user: { label: "Needs review",  tone: "warn"   },
  awaiting_qc:   { label: "Awaiting QC",   tone: "warn"   },
  complete:      { label: "Complete",      tone: "success"},
  completed:     { label: "Complete",      tone: "success"},
  partial:       { label: "Partial",       tone: "warn"   },
  failed:        { label: "Failed",        tone: "danger" },
};

function StatusPill({ status, stuck }: { status: string | null; stuck?: boolean }) {
  if (!status) return null;
  const meta = STATUS_META[status] ?? { label: status, tone: "muted" as Tone };
  const tone: Tone = stuck ? "warn" : meta.tone;

  const tones: Record<Tone, string> = {
    active:  "bg-[color:rgb(107_158_200_/_0.12)] text-[var(--color-accent)]  border-[color:rgb(107_158_200_/_0.28)]",
    success: "bg-[color:rgb(90_158_117_/_0.12)]  text-[var(--color-success)] border-[color:rgb(90_158_117_/_0.28)]",
    warn:    "bg-[color:rgb(184_144_74_/_0.12)]  text-[var(--color-warn)]    border-[color:rgb(184_144_74_/_0.28)]",
    danger:  "bg-[color:rgb(184_96_96_/_0.12)]   text-[var(--color-error)]   border-[color:rgb(184_96_96_/_0.28)]",
    muted:   "bg-[var(--color-surface-2)]         text-[var(--color-text-3)]  border-[var(--color-border)]",
  };

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 h-5 rounded-full text-[10px] font-mono uppercase tracking-[0.12em] border ${tones[tone]}`}>
      <span className={`w-1 h-1 rounded-full bg-current ${tone === "active" ? "pulse-dot" : ""}`} />
      {stuck ? "Stuck" : meta.label}
    </span>
  );
}

function truncateUrl(url: string, max = 56): string {
  try {
    const u = new URL(url);
    const d = u.hostname.replace(/^www\./, "") + u.pathname;
    return d.length > max ? d.slice(0, max) + "…" : d;
  } catch {
    return url.slice(0, max);
  }
}

function relativeTime(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day}d ago`;
    return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

export default async function HistoryPage() {
  const runs = await getRuns();

  // Counts for header
  const counts = runs.reduce(
    (acc, r) => {
      const s = r.status ?? "";
      if (ACTIVE_STATUSES.has(s)) acc.active++;
      else if (s === "completed") acc.completed++;
      else if (s === "failed" || isStuck(r)) acc.failed++;
      else if (s === "awaiting_user" || s === "awaiting_qc") acc.waiting++;
      return acc;
    },
    { active: 0, completed: 0, failed: 0, waiting: 0 }
  );

  return (
    <main className="min-h-[calc(100vh-3rem)] pb-24">
      <div className="max-w-5xl mx-auto px-5 pt-10">
        {/* Header */}
        <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight text-[var(--color-text)] mb-1">
              Runs
            </h1>
            <p className="text-[13px] text-[var(--color-text-2)]">
              {runs.length === 0
                ? "No runs yet."
                : `${runs.length} total · ${counts.active} running · ${counts.completed} complete · ${counts.failed} failed`}
            </p>
          </div>
          <Link
            href="/"
            className="cursor-pointer inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)] hover:border-[var(--color-border-hover)] text-[12px] text-[var(--color-text)] transition-colors duration-150"
          >
            <Icon.Spark className="w-3.5 h-3.5 text-[var(--color-accent)]" />
            New run
          </Link>
        </div>

        {/* Empty state */}
        {runs.length === 0 && (
          <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)]/40 py-16 px-6 text-center">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-[var(--color-surface-2)] mb-3">
              <Icon.History className="w-5 h-5 text-[var(--color-text-3)]" />
            </div>
            <p className="text-[13px] text-[var(--color-text-2)] mb-4">No runs yet — start your first pipeline.</p>
            <Link
              href="/"
              className="cursor-pointer inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-[var(--color-accent)] hover:bg-[var(--color-accent-dim)] text-white text-[12px] font-medium transition-colors duration-150"
            >
              <Icon.Play className="w-3.5 h-3.5" />
              Start your first run
            </Link>
          </div>
        )}

        {/* List */}
        {runs.length > 0 && (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden divide-y divide-[var(--color-border)]">
            {/* Table header */}
            <div className="hidden md:grid grid-cols-[1fr_140px_120px_100px] gap-4 px-5 py-2.5 bg-[var(--color-surface-2)]/40 text-[10px] font-mono uppercase tracking-[0.14em] text-[var(--color-text-3)]">
              <span>Run</span>
              <span>Status</span>
              <span>Updated</span>
              <span className="text-right">Action</span>
            </div>

            {runs.map((run) => {
              const name = run.brand_name ?? run.product_name ?? "(unnamed)";
              const stuck = isStuck(run);
              const action = runAction(run);
              const href = action === "view" ? `/history/${run.id}` : `/runs/${run.id}`;
              const actionLabel =
                action === "view-live" ? "View live" : action === "continue" ? "Continue" : "View";
              const isActive = ACTIVE_STATUSES.has(run.status ?? "");
              const updatedIso = run.last_updated_at ?? run.created_at;
              return (
                <Link
                  key={run.id}
                  href={href}
                  className={[
                    "cursor-pointer grid md:grid-cols-[1fr_140px_120px_100px] grid-cols-1 gap-2 md:gap-4 px-5 py-3 transition-colors duration-150",
                    isActive
                      ? "bg-[color:rgb(107_158_200_/_0.05)] hover:bg-[color:rgb(107_158_200_/_0.09)]"
                      : "hover:bg-[var(--color-surface-2)]",
                  ].join(" ")}
                >
                  {/* Run identity */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[13px] text-[var(--color-text)] truncate font-medium">{name}</span>
                      <span className="font-mono text-[10px] text-[var(--color-text-4)] flex-shrink-0">#{run.id}</span>
                    </div>
                    <p className="font-mono text-[11px] text-[var(--color-text-3)] truncate">
                      {truncateUrl(run.product_url)}
                    </p>
                    {isActive && run.current_step && (
                      <p className="text-[11px] text-[var(--color-accent)] truncate mt-0.5">
                        {run.current_step}
                      </p>
                    )}
                  </div>

                  {/* Status */}
                  <div className="flex md:items-center">
                    <StatusPill status={run.status} stuck={stuck} />
                  </div>

                  {/* Updated */}
                  <div className="flex md:items-center font-mono text-[11px] text-[var(--color-text-3)]">
                    {relativeTime(updatedIso)}
                  </div>

                  {/* Action */}
                  <div className="flex md:items-center md:justify-end">
                    <span
                      className={[
                        "inline-flex items-center gap-1 text-[12px]",
                        action === "continue" ? "text-[var(--color-warn)]" : "text-[var(--color-text-2)]",
                      ].join(" ")}
                    >
                      {actionLabel}
                      <Icon.ArrowRight className="w-3.5 h-3.5" />
                    </span>
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
