"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

function looksLikeUrl(s: string): boolean {
  if (!s) return false;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function detectPlatform(url: string): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host.includes("aliexpress")) return "AliExpress";
    if (host.includes("alibaba")) return "Alibaba";
    if (host.includes("amazon")) return "Amazon";
    if (host.includes("temu")) return "Temu";
    if (host.includes("shopify") || host.endsWith(".myshopify.com")) return "Shopify";
    return host;
  } catch {
    return null;
  }
}

export default function Home() {
  const router = useRouter();
  const urlInputRef = useRef<HTMLInputElement>(null);

  const [url, setUrl] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [competitorUrls, setCompetitorUrls] = useState("");
  const [showCompetitors, setShowCompetitors] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { urlInputRef.current?.focus(); }, []);

  // Cmd/Ctrl-Enter to submit from anywhere on the page
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleStart();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, productDescription, competitorUrls, loading]);

  const urlIsValid = useMemo(() => looksLikeUrl(url.trim()), [url]);
  const platform = useMemo(() => detectPlatform(url.trim()), [url]);
  const canStart = urlIsValid && !loading;

  const competitorList = useMemo(
    () =>
      competitorUrls
        .split("\n")
        .map((u) => u.trim())
        .filter(Boolean),
    [competitorUrls]
  );
  const competitorValid = competitorList.every(looksLikeUrl);

  async function handleStart() {
    if (!canStart) return;
    if (!competitorValid) {
      setError("One or more competitor URLs are not valid.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/runs/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          productDescription: productDescription.trim() || undefined,
          competitorUrls: competitorList,
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
    <main className="min-h-[calc(100vh-3rem)]">
      <div className="max-w-3xl mx-auto px-5 pt-12 pb-24">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-[22px] font-semibold tracking-tight text-[var(--color-text)] mb-1.5">
            Start a research run
          </h1>
          <p className="text-[13px] text-[var(--color-text-2)] leading-relaxed">
            Paste a product URL. We&rsquo;ll scrape it, run Stage&nbsp;1 research, Stage&nbsp;2 German
            copy, and pause before Stage&nbsp;3 (images) so you can review.
          </p>
        </div>

        {/* Form card */}
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] divide-y divide-[var(--color-border)] overflow-hidden">
          {/* URL */}
          <div className="px-5 py-4">
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="product-url" className="block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--color-text-2)]">
                Product URL <span className="text-[var(--color-error)] ml-0.5">*</span>
              </label>
              {platform && (
                <span className="font-mono text-[10px] text-[var(--color-text-3)]">
                  detected: {platform}
                </span>
              )}
            </div>
            <input
              id="product-url"
              ref={urlInputRef}
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleStart();
                }
              }}
              placeholder="https://www.aliexpress.com/item/..."
              disabled={loading}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              aria-invalid={url.length > 0 && !urlIsValid}
              className={[
                "w-full bg-[var(--color-bg)] rounded-lg px-3.5 py-2.5 text-[13px]",
                "text-[var(--color-text)] placeholder-[var(--color-text-4)]",
                "focus:outline-none transition-colors duration-150",
                "border",
                url.length > 0 && !urlIsValid
                  ? "border-[var(--color-error)]/50 focus:border-[var(--color-error)]"
                  : "border-[var(--color-border)] focus:border-[var(--color-accent)]/70 focus:ring-2 focus:ring-[var(--color-accent)]/15",
                "disabled:opacity-40",
              ].join(" ")}
            />
            {url.length > 0 && !urlIsValid && (
              <p className="mt-1.5 text-[11px] text-[var(--color-error)] font-mono">
                Must start with http:// or https://
              </p>
            )}
          </div>

          {/* Description */}
          <div className="px-5 py-4">
            <label htmlFor="product-desc" className="block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--color-text-2)] mb-1.5">
              Description <span className="text-[var(--color-text-4)] normal-case font-sans tracking-normal text-[11px] ml-1">optional, helps research</span>
            </label>
            <textarea
              id="product-desc"
              value={productDescription}
              onChange={(e) => setProductDescription(e.target.value)}
              rows={2}
              placeholder="e.g. Children's swimming goggle set, soft silicone, ages 4–10."
              disabled={loading}
              className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg px-3.5 py-2.5 text-[13px] text-[var(--color-text)] placeholder-[var(--color-text-4)] focus:outline-none focus:border-[var(--color-accent)]/70 focus:ring-2 focus:ring-[var(--color-accent)]/15 transition-colors duration-150 resize-none disabled:opacity-40"
            />
          </div>

          {/* Competitors */}
          <div>
            <button
              type="button"
              onClick={() => setShowCompetitors((v) => !v)}
              className="cursor-pointer w-full flex items-center gap-2 px-5 py-3 text-left hover:bg-[var(--color-surface-2)] transition-colors duration-150"
              aria-expanded={showCompetitors}
            >
              <Icon.ChevronRight
                className={`w-3.5 h-3.5 text-[var(--color-text-3)] transition-transform duration-150 ${showCompetitors ? "rotate-90" : ""}`}
              />
              <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--color-text-2)]">
                Competitor URLs
              </span>
              <span className="text-[11px] text-[var(--color-text-3)]">
                optional &middot; {competitorList.length} listed
              </span>
            </button>
            {showCompetitors && (
              <div className="px-5 pb-4 fade-in">
                <textarea
                  value={competitorUrls}
                  onChange={(e) => setCompetitorUrls(e.target.value)}
                  placeholder={"One URL per line\nhttps://example.com/product\nhttps://other.com/item"}
                  rows={3}
                  disabled={loading}
                  spellCheck={false}
                  className={[
                    "w-full bg-[var(--color-bg)] border rounded-lg px-3.5 py-2.5",
                    "text-[12px] font-mono text-[var(--color-text-2)] placeholder-[var(--color-text-4)]",
                    "focus:outline-none transition-colors duration-150 resize-y disabled:opacity-40",
                    competitorList.length > 0 && !competitorValid
                      ? "border-[var(--color-error)]/50 focus:border-[var(--color-error)]"
                      : "border-[var(--color-border)] focus:border-[var(--color-accent)]/70 focus:ring-2 focus:ring-[var(--color-accent)]/15",
                  ].join(" ")}
                />
              </div>
            )}
          </div>

          {/* Submit row */}
          <div className="px-5 py-4 flex items-center justify-between gap-4 bg-[var(--color-surface-2)]/30">
            <div className="text-[11px] text-[var(--color-text-3)] hidden sm:block">
              Runs in background &middot; close the tab anytime.
            </div>
            <button
              onClick={handleStart}
              disabled={!canStart}
              className={[
                "cursor-pointer inline-flex items-center gap-2 px-4 h-9 rounded-md font-medium text-[13px] transition-all duration-150",
                "border",
                canStart
                  ? "bg-[var(--color-accent)] hover:bg-[var(--color-accent-dim)] text-white border-[var(--color-accent)] shadow-[0_0_0_1px_rgba(79,139,255,0.12),0_4px_12px_-2px_rgba(79,139,255,0.35)]"
                  : "bg-[var(--color-surface-3)] text-[var(--color-text-4)] border-[var(--color-border)] cursor-not-allowed",
              ].join(" ")}
            >
              {loading ? (
                <>
                  <Icon.Loader className="w-3.5 h-3.5" />
                  Starting&hellip;
                </>
              ) : (
                <>
                  <Icon.Play className="w-3.5 h-3.5" />
                  Run pipeline
                  <span className="flex items-center gap-0.5 ml-1">
                    <kbd className="kbd">⌘</kbd>
                    <kbd className="kbd">↵</kbd>
                  </span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mt-3 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-[color:rgb(138_58_58_/_0.06)] border border-[color:rgb(138_58_58_/_0.22)] fade-in">
            <Icon.Alert className="w-4 h-4 text-[var(--color-error)] flex-shrink-0 mt-px" />
            <p className="text-[12px] text-[var(--color-error)] leading-relaxed">{error}</p>
          </div>
        )}

        {/* Helpful footer */}
        <div className="mt-10 grid sm:grid-cols-3 gap-3">
          {[
            {
              title: "Stage 1 — Research",
              body: "Product identification, market overview, competitive landscape, avatar, offer brief, and beliefs.",
            },
            {
              title: "Stage 2 — German copy",
              body: "Full DTC copy kit: hero, USPs, FAQ, social proof. Auto-runs after Stage 1.",
            },
            {
              title: "Stage 3 — Images",
              body: "Pauses for your approval. Generates 11 product images via Higgsfield.",
            },
          ].map((s) => (
            <div
              key={s.title}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3"
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-2)] mb-1.5">
                {s.title}
              </p>
              <p className="text-[12px] text-[var(--color-text-3)] leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-[var(--color-text-3)]">
          <Icon.History className="w-3.5 h-3.5" />
          <Link href="/history" className="hover:text-[var(--color-text-2)] transition-colors">
            View past runs
          </Link>
        </div>
      </div>
    </main>
  );
}
