import { notFound } from "next/navigation";
import Link from "next/link";
import type { Run } from "@/lib/db";
import RunDetailClient from "./RunDetailClient";

async function getRun(id: string): Promise<Run | null> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/runs/${id}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return data.run ?? null;
  } catch {
    return null;
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

export default async function RunPage({ params }: { params: Promise<unknown> }) {
  const { id } = (await params) as { id: string };
  const run = await getRun(id);
  if (!run) notFound();

  const displayName = run.brand_name ?? run.product_name ?? "(unnamed)";

  return (
    <main className="min-h-screen bg-black pb-24">
      <div className="max-w-4xl mx-auto px-4 pt-8">
        {/* Page header */}
        <div className="mb-8 pb-8 border-b border-[#111]">
          <Link href="/history" className="font-mono text-[10px] text-[#333] hover:text-[#666] transition-colors mb-4 block">
            ← History
          </Link>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <h1 className="font-mono text-base text-white">{displayName}</h1>
                <span className="font-mono text-[10px] text-[#333]">#{run.id}</span>
                <StatusPill status={run.status} />
              </div>
              <p className="font-mono text-[11px] text-[#333] truncate max-w-lg">
                {run.product_url}
              </p>
            </div>
            <p className="font-mono text-[10px] text-[#333] flex-shrink-0">{formatDate(run.created_at)}</p>
          </div>
        </div>

        {/* All interactive content handled client-side */}
        <RunDetailClient run={run} />
      </div>
    </main>
  );
}
