"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function Home() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [competitorUrls, setCompetitorUrls] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canStart = url.trim().length > 0 && !loading;

  async function handleStart() {
    if (!canStart) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/runs/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          productDescription: productDescription.trim() || undefined,
          competitorUrls: competitorUrls
            .split("\n")
            .map((u) => u.trim())
            .filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.runId) {
        throw new Error(data.error ?? "Failed to start pipeline");
      }
      router.push(`/runs/${data.runId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 selection:bg-blue-500/30">

      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-5 h-12 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-5 h-5 rounded-md bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center flex-shrink-0">
              <svg viewBox="0 0 24 24" className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 6h16M4 12h10M4 18h7" />
              </svg>
            </div>
            <h1 className="text-[13px] font-semibold text-zinc-100 tracking-tight">Pipeline</h1>
          </div>
          <nav className="flex items-center gap-4">
            <Link href="/history" className="text-[12px] font-mono text-zinc-500 hover:text-zinc-200 transition-colors">
              History
            </Link>
          </nav>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-5 py-10">
        <div className="mb-6">
          <h2 className="text-[14px] font-semibold text-zinc-100 tracking-tight mb-1">New research run</h2>
          <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">Scrape → Stage 1 → Stage 2 · runs in background</span>
        </div>

        <div className="border border-zinc-700/60 rounded-xl bg-zinc-900 p-5 space-y-4">
          {/* URL */}
          <div className="space-y-1.5">
            <label className="block text-[10px] font-mono text-zinc-400 uppercase tracking-widest">Product URL</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleStart()}
              placeholder="https://www.aliexpress.com/item/..."
              disabled={loading}
              className="w-full bg-zinc-950 border border-zinc-700/60 rounded-lg px-3.5 py-2.5 text-[13px] text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/10 transition-colors disabled:opacity-40"
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="block text-[10px] font-mono text-zinc-400 uppercase tracking-widest">
              Description
              <span className="ml-2 normal-case tracking-normal font-sans text-[11px] text-zinc-600">optional</span>
            </label>
            <textarea
              value={productDescription}
              onChange={(e) => setProductDescription(e.target.value)}
              rows={2}
              placeholder="e.g. Children's swimming goggle set, soft silicone, ages 4–10."
              disabled={loading}
              className="w-full bg-zinc-950 border border-zinc-700/60 rounded-lg px-3.5 py-2.5 text-[13px] text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/10 transition-colors resize-none disabled:opacity-40"
            />
          </div>

          {/* Competitors */}
          <details className="group">
            <summary className="cursor-pointer select-none list-none flex items-center gap-2">
              <span className="text-[9px] text-zinc-500 group-open:rotate-90 transition-transform inline-block">▶</span>
              <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest">Competitor URLs</span>
              <span className="text-[10px] text-zinc-600">optional</span>
            </summary>
            <div className="mt-2">
              <textarea
                value={competitorUrls}
                onChange={(e) => setCompetitorUrls(e.target.value)}
                placeholder="One URL per line"
                rows={2}
                disabled={loading}
                className="w-full bg-zinc-950 border border-zinc-700/60 rounded-lg px-3.5 py-2.5 text-[12px] font-mono text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/10 transition-colors resize-none disabled:opacity-40"
              />
            </div>
          </details>

          {/* Submit */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <button
              onClick={handleStart}
              disabled={!canStart}
              className="cursor-pointer px-4 py-2 bg-blue-600 hover:bg-blue-500 active:scale-95 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed text-white font-medium text-[13px] rounded-md transition-all duration-150 flex items-center gap-2"
            >
              {loading ? (
                <>
                  <span className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" />
                  Starting…
                </>
              ) : (
                <>
                  Run Pipeline
                  <kbd className="text-[10px] font-mono bg-blue-700/60 px-1 py-0.5 rounded">↵</kbd>
                </>
              )}
            </button>
            <span className="text-[11px] text-zinc-500 hidden sm:inline">Runs in background — navigate freely</span>
          </div>
        </div>

        {error && (
          <div className="mt-3 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-950/40 border border-red-900/50">
            <span className="text-red-400 text-sm mt-px flex-shrink-0">!</span>
            <p className="font-mono text-[11px] text-red-400 leading-relaxed">{error}</p>
          </div>
        )}
      </div>
    </main>
  );
}
