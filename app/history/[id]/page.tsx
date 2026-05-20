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

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const meta = STATUS_META[status] ?? { label: status, tone: "muted" as Tone };
  const toneMap: Record<Tone, { bg: string; text: string }> = {
    active:  { bg: "var(--color-accent-weak)", text: "var(--color-accent)" },
    success: { bg: "var(--color-green-bg)",    text: "var(--color-green)" },
    warn:    { bg: "var(--color-amber-bg)",     text: "var(--color-amber)" },
    danger:  { bg: "var(--color-red-bg)",       text: "var(--color-red)" },
    muted:   { bg: "var(--color-gray-bg)",      text: "var(--color-gray)" },
  };
  const { bg, text } = toneMap[meta.tone];
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-[620] px-2.5 py-1 rounded-full whitespace-nowrap"
      style={{ background: bg, color: text }}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />
      {meta.label}
    </span>
  );
}

export default async function HistoryRunPage({ params }: { params: Promise<unknown> }) {
  const { id } = (await params) as { id: string };
  const numericId = Number.parseInt(id, 10);
  if (!Number.isFinite(numericId)) notFound();

  const run = await getRun(numericId);
  if (!run) notFound();

  const displayName = run.brand_name ?? run.product_name ?? "(unnamed)";

  return (
    <main className="px-7 py-7 max-w-[1080px] mx-auto pb-24">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[11px] mb-4">
        <Link href="/history" className="cursor-pointer inline-flex items-center gap-1 text-[var(--color-text-3)] hover:text-[var(--color-text-2)] transition-colors">
          <Icon.ArrowLeft className="w-3 h-3" />
          Runs
        </Link>
        <span className="text-[var(--color-text-4)]">/</span>
        <span className="text-[var(--color-text-2)] font-[var(--font-ibm-plex-mono)]">#{run.id}</span>
      </div>

      {/* Header */}
      <div className="mb-7 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-3 mb-1.5 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text)]">{displayName}</h1>
              <StatusBadge status={run.status} />
            </div>
            <p className="font-[var(--font-ibm-plex-mono)] text-[12px] text-[var(--color-text-3)] truncate max-w-lg">
              {run.product_url}
            </p>
          </div>
          <p className="font-[var(--font-ibm-plex-mono)] text-[11px] text-[var(--color-text-4)] flex-shrink-0">
            {formatDate(run.created_at)}
          </p>
        </div>
      </div>

      <RunDetailClient run={run} />
    </main>
  );
}
