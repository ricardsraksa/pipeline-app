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

function StatusPill({ status }: { status: string | null }) {
  const s = status ?? "";
  if (!s) return null;
  const variants: Record<string, string> = {
    complete: "bg-emerald-950/60 text-emerald-400 border-emerald-900/50",
    partial:  "bg-amber-950/60  text-amber-400  border-amber-900/50",
    failed:   "bg-red-950/60    text-red-400    border-red-900/50",
  };
  const cls = variants[s] ?? "bg-[#111] text-[#737373] border-[#222]";
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-mono border tracking-wider uppercase ${cls}`}>
      <span className="w-1 h-1 rounded-full bg-current opacity-80" />
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
    <main className="min-h-screen bg-black pb-24">
      <div className="max-w-3xl mx-auto px-4 pt-10">
        {/* Page header */}
        <div className="mb-8">
          <h1 className="font-mono text-base text-[#d4d4d4] mb-1">Run History</h1>
          <p className="font-mono text-[11px] text-[#333]">
            {runs.length === 0 ? "No runs yet" : `${runs.length} run${runs.length !== 1 ? "s" : ""} saved`}
          </p>
        </div>

        {/* Empty state */}
        {runs.length === 0 && (
          <div className="border border-dashed border-[#1a1a1a] rounded-xl py-20 text-center">
            <p className="font-mono text-sm text-[#222]">No completed runs yet.</p>
            <Link href="/" className="font-mono text-xs text-[#2563eb] hover:underline mt-2 block">
              Start a run →
            </Link>
          </div>
        )}

        {/* Run list */}
        {runs.length > 0 && (
          <div className="space-y-1">
            {runs.map((run) => {
              const name = run.brand_name ?? run.product_name ?? "(unnamed)";
              return (
                <Link
                  key={run.id}
                  href={`/history/${run.id}`}
                  className="group flex items-center gap-4 rounded-lg border border-[#111] hover:border-[#222] bg-[#050505] hover:bg-[#0a0a0a] px-5 py-3.5 transition-all duration-100"
                >
                  {/* Identity */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className="font-mono text-[13px] text-[#c8c8c8] group-hover:text-white transition-colors truncate">
                        {name}
                      </span>
                      <span className="font-mono text-[9px] text-[#252525] group-hover:text-[#333] flex-shrink-0">
                        #{run.id}
                      </span>
                    </div>
                    <p className="font-mono text-[10px] text-[#252525] group-hover:text-[#2a2a2a] transition-colors truncate">
                      {truncateUrl(run.product_url)}
                    </p>
                  </div>

                  {/* Meta */}
                  <div className="hidden sm:flex items-center gap-3 flex-shrink-0">
                    <StatusPill status={run.status} />
                    {run.doc_count > 0 && (
                      <span className="font-mono text-[10px] text-[#2a2a2a] group-hover:text-[#333] transition-colors">
                        {run.doc_count} doc{run.doc_count !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>

                  {/* Date */}
                  <div className="flex-shrink-0 text-right">
                    <p className="font-mono text-[10px] text-[#2e2e2e] group-hover:text-[#404040] transition-colors">
                      {formatDate(run.created_at)}
                    </p>
                    <p className="font-mono text-[9px] text-[#2563eb] opacity-0 group-hover:opacity-70 transition-opacity mt-0.5">
                      View →
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
