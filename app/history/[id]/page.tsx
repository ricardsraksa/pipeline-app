import { notFound } from "next/navigation";
import Link from "next/link";
import { getRun } from "@/lib/db";
import { Icon } from "@/components/ui/Icon";
import RunDetailClient from "./RunDetailClient";

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("de-DE", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

type Tone = "active" | "success" | "warn" | "danger" | "muted";
const STATUS_META: Record<string, { label: string; tone: Tone }> = {
  pending:       { label: "Pending",      tone: "muted" },
  scraping:      { label: "Scraping",     tone: "active" },
  stage1:        { label: "Stage 1",      tone: "active" },
  stage2:        { label: "Stage 2",      tone: "active" },
  awaiting_user: { label: "Needs review", tone: "warn"   },
  awaiting_qc:   { label: "Awaiting QC",  tone: "warn"   },
  complete:      { label: "Complete",     tone: "success"},
  completed:     { label: "Complete",     tone: "success"},
  partial:       { label: "Partial",      tone: "warn"   },
  failed:        { label: "Failed",       tone: "danger" },
};

function StatusPill({ status }: { status: string | null }) {
  if (!status) return null;
  const meta = STATUS_META[status] ?? { label: status, tone: "muted" as Tone };
  const tones: Record<Tone, string> = {
    active:  "bg-[color:rgb(107_158_200_/_0.12)] text-[var(--color-accent)]  border-[color:rgb(107_158_200_/_0.28)]",
    success: "bg-[color:rgb(90_158_117_/_0.12)]  text-[var(--color-success)] border-[color:rgb(90_158_117_/_0.28)]",
    warn:    "bg-[color:rgb(184_144_74_/_0.12)]  text-[var(--color-warn)]    border-[color:rgb(184_144_74_/_0.28)]",
    danger:  "bg-[color:rgb(184_96_96_/_0.12)]   text-[var(--color-error)]   border-[color:rgb(184_96_96_/_0.28)]",
    muted:   "bg-[var(--color-surface-2)]         text-[var(--color-text-3)]  border-[var(--color-border)]",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 h-5 rounded-full text-[10px] font-mono uppercase tracking-[0.12em] border ${tones[meta.tone]}`}>
      <span className="w-1 h-1 rounded-full bg-current" />
      {meta.label}
    </span>
  );
}

export default async function HistoryRunPage({ params }: { params: Promise<unknown> }) {
  const { id } = (await params) as { id: string };
  const numericId = Number.parseInt(id, 10);
  if (!Number.isFinite(numericId)) notFound();

  // Server components run in the same process as the API — go straight to DB,
  // no HTTP roundtrip, no env-var dependency, much faster.
  const run = await getRun(numericId);
  if (!run) notFound();

  const displayName = run.brand_name ?? run.product_name ?? "(unnamed)";

  return (
    <main className="min-h-[calc(100vh-3rem)] pb-24">
      <div className="max-w-4xl mx-auto px-5 pt-6">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-[11px] mb-4">
          <Link href="/history" className="cursor-pointer inline-flex items-center gap-1 text-[var(--color-text-3)] hover:text-[var(--color-text-2)] transition-colors">
            <Icon.ArrowLeft className="w-3 h-3" />
            Runs
          </Link>
          <span className="text-[var(--color-text-4)]">/</span>
          <span className="text-[var(--color-text-2)] font-mono">#{run.id}</span>
        </div>

        {/* Header */}
        <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-3 mb-1.5 flex-wrap">
                <h1 className="text-[22px] font-semibold tracking-tight text-[var(--color-text)]">{displayName}</h1>
                <StatusPill status={run.status} />
              </div>
              <p className="font-mono text-[12px] text-[var(--color-text-3)] truncate max-w-lg">
                {run.product_url}
              </p>
            </div>
            <p className="font-mono text-[11px] text-[var(--color-text-4)] flex-shrink-0">
              {formatDate(run.created_at)}
            </p>
          </div>
        </div>

        <RunDetailClient run={run} />
      </div>
    </main>
  );
}
