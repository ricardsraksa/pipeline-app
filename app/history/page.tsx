import Link from "next/link";

interface RunSummary {
  id: number;
  created_at: string;
  product_url: string;
  product_name: string;
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

function FeedbackChip({ value }: { value: string | null }) {
  if (!value) return <span className="text-[#333]">—</span>;
  return (
    <span className={value === "up" ? "text-[#16a34a]" : "text-[#dc2626]"}>
      {value === "up" ? "↑" : "↓"}
    </span>
  );
}

function truncateUrl(url: string, max = 40): string {
  try {
    const u = new URL(url);
    const display = u.hostname + u.pathname;
    return display.length > max ? display.slice(0, max) + "…" : display;
  } catch {
    return url.slice(0, max);
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default async function HistoryPage() {
  const runs = await getRuns();

  return (
    <main className="min-h-screen bg-[#0a0a0a] pb-16">
      <div className="max-w-2xl mx-auto px-4 pt-8">
        <div className="mb-7">
          <h1 className="font-mono text-xs text-[#2563eb] tracking-[0.2em] uppercase mb-2">
            Run History
          </h1>
          <p className="text-[#404040] text-sm">
            Completed pipeline runs, newest first.
          </p>
        </div>

        {runs.length === 0 ? (
          <p className="text-[#404040] text-sm font-mono">No completed runs yet.</p>
        ) : (
          <div className="space-y-2">
            {runs.map((run) => (
              <Link
                key={run.id}
                href={`/history/${run.id}`}
                className="block bg-[#0d0d0d] border border-[#1e1e1e] hover:border-[#2a2a2a] rounded-lg px-5 py-4 transition-colors group"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="font-mono text-sm text-[#e5e5e5] group-hover:text-white transition-colors">
                        {run.product_name || "(unnamed)"}
                      </span>
                      <span className="font-mono text-xs text-[#2563eb]">#{run.id}</span>
                    </div>
                    <p className="text-xs text-[#404040] font-mono truncate">
                      {truncateUrl(run.product_url)}
                    </p>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className="text-xs text-[#404040] font-mono mb-1">
                      {formatDate(run.created_at)}
                    </p>
                    <div className="flex items-center gap-2 justify-end text-sm">
                      <FeedbackChip value={run.feedback_stage1} />
                      <FeedbackChip value={run.feedback_stage2} />
                      <FeedbackChip value={run.feedback_stage3} />
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
