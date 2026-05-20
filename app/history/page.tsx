import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { listRuns, type RunSummary } from "@/lib/db";

// Server components run in the same process as the API. Skip the HTTP roundtrip
// and read from the DB directly — much faster, doesn't depend on INTERNAL_API_URL.
async function getRuns(): Promise<RunSummary[]> {
  try {
    return await listRuns();
  } catch (err) {
    console.error("Failed to load runs:", err);
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

function StatusBadge({ status, stuck }: { status: string | null; stuck?: boolean }) {
  if (!status) return null;
  const meta = STATUS_META[status] ?? { label: status, tone: "muted" as Tone };
  const tone: Tone = stuck ? "warn" : meta.tone;

  const toneMap: Record<Tone, { bg: string; text: string }> = {
    active:  { bg: "var(--color-accent-weak)", text: "var(--color-accent)" },
    success: { bg: "var(--color-green-bg)",    text: "var(--color-green)" },
    warn:    { bg: "var(--color-amber-bg)",     text: "var(--color-amber)" },
    danger:  { bg: "var(--color-red-bg)",       text: "var(--color-red)" },
    muted:   { bg: "var(--color-gray-bg)",      text: "var(--color-gray)" },
  };

  const { bg, text } = toneMap[tone];

  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-[620] px-2.5 py-1 rounded-full whitespace-nowrap"
      style={{ background: `var(--color-${tone === "active" ? "accent-weak" : tone === "success" ? "green-bg" : tone === "warn" ? "amber-bg" : tone === "danger" ? "red-bg" : "gray-bg"})`, color: `var(--color-${tone === "active" ? "accent" : tone === "success" ? "green" : tone === "warn" ? "amber" : tone === "danger" ? "red" : "gray"})` }}
    >
      <span className={`w-1.5 h-1.5 rounded-full bg-current shrink-0 ${tone === "active" ? "pulse-dot" : ""}`} />
      {stuck ? "Stuck" : meta.label}
    </span>
  );
}

function truncateUrl(url: string | null | undefined, max = 56): string {
  if (!url) return "(no URL — uploaded images)";
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
    <main className="px-7 py-7 max-w-[1080px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text)] mb-1">
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
          className="inline-flex items-center gap-[7px] rounded-lg px-[15px] py-[9px] text-[13.5px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] border border-transparent transition-all hover:brightness-105 whitespace-nowrap"
        >
          <Icon.Spark className="w-3.5 h-3.5" />
          New run
        </Link>
      </div>

      {/* Empty state */}
      {runs.length === 0 && (
        <div className="border border-dashed border-[var(--color-border)] rounded-[11px] bg-[var(--color-surface)] py-16 px-6 text-center">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-[var(--color-surface-2)] mb-3">
            <Icon.History className="w-5 h-5 text-[var(--color-text-3)]" />
          </div>
          <p className="text-[13px] text-[var(--color-text-2)] mb-4">No runs yet — start your first pipeline.</p>
          <Link
            href="/"
            className="inline-flex items-center gap-[7px] rounded-lg px-[15px] py-[9px] text-[13.5px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] border border-transparent transition-all hover:brightness-105 whitespace-nowrap"
          >
            <Icon.Play className="w-3.5 h-3.5" />
            Start your first run
          </Link>
        </div>
      )}

      {/* Table */}
      {runs.length > 0 && (
        <div className="border border-[var(--color-border)] rounded-[11px] overflow-hidden bg-[var(--color-surface)]">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-text-3)] font-[680] text-left px-4 py-[11px] bg-[var(--color-surface-2)] border-b border-[var(--color-border)]">
                  Run
                </th>
                <th className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-text-3)] font-[680] text-left px-4 py-[11px] bg-[var(--color-surface-2)] border-b border-[var(--color-border)]">
                  Status
                </th>
                <th className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-text-3)] font-[680] text-left px-4 py-[11px] bg-[var(--color-surface-2)] border-b border-[var(--color-border)] hidden md:table-cell">
                  Updated
                </th>
                <th className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-text-3)] font-[680] text-right px-4 py-[11px] bg-[var(--color-surface-2)] border-b border-[var(--color-border)]">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
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
                  <tr
                    key={run.id}
                    className="cursor-pointer transition-colors hover:bg-[var(--color-surface-2)]"
                  >
                    <td className="px-4 py-[13px] border-b border-[var(--color-border)] align-middle">
                      <Link href={href} className="block min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-[13px] text-[var(--color-text)] font-[550] truncate">{name}</span>
                          <span className="font-[var(--font-ibm-plex-mono)] text-[10px] text-[var(--color-text-4)] shrink-0">#{run.id}</span>
                        </div>
                        <p className="font-[var(--font-ibm-plex-mono)] text-[11px] text-[var(--color-text-3)] truncate">
                          {truncateUrl(run.product_url)}
                        </p>
                        {isActive && run.current_step && (
                          <p className="text-[11px] text-[var(--color-accent)] truncate mt-0.5">
                            {run.current_step}
                          </p>
                        )}
                      </Link>
                    </td>
                    <td className="px-4 py-[13px] border-b border-[var(--color-border)] align-middle">
                      <Link href={href} className="block">
                        <StatusBadge status={run.status} stuck={stuck} />
                      </Link>
                    </td>
                    <td className="px-4 py-[13px] border-b border-[var(--color-border)] align-middle font-[var(--font-ibm-plex-mono)] text-[11px] text-[var(--color-text-3)] hidden md:table-cell">
                      <Link href={href} className="block">
                        {relativeTime(updatedIso)}
                      </Link>
                    </td>
                    <td className="px-4 py-[13px] border-b border-[var(--color-border)] align-middle text-right">
                      <Link
                        href={href}
                        className={[
                          "inline-flex items-center gap-1 text-[12px] font-[550]",
                          action === "continue" ? "text-[var(--color-amber)]" : "text-[var(--color-text-2)]",
                        ].join(" ")}
                      >
                        {actionLabel}
                        <Icon.ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
