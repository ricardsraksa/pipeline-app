"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useDropzone } from "react-dropzone";
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

const MIN_DESCRIPTION_LEN = 20;
const MAX_IMAGES = 10;

export default function Home() {
  const router = useRouter();
  const descRef = useRef<HTMLTextAreaElement>(null);

  const [productDescription, setProductDescription] = useState("");
  const [sourceImages, setSourceImages] = useState<string[]>([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [productUrl, setProductUrl] = useState("");
  const [competitorUrls, setCompetitorUrls] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    descRef.current?.focus();
  }, []);

  const urlValid = useMemo(() => !productUrl.trim() || looksLikeUrl(productUrl.trim()), [productUrl]);

  const competitorList = useMemo(
    () =>
      competitorUrls
        .split("\n")
        .map((u) => u.trim())
        .filter(Boolean),
    [competitorUrls]
  );
  const competitorValid = competitorList.every(looksLikeUrl);

  const descriptionOk = productDescription.trim().length >= MIN_DESCRIPTION_LEN;
  const imagesOk = sourceImages.length > 0;
  const canStart = descriptionOk && imagesOk && urlValid && competitorValid && !submitting && !uploadingImages;

  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    if (sourceImages.length + files.length > MAX_IMAGES) {
      setUploadError(`Max ${MAX_IMAGES} images total`);
      return;
    }
    setUploadError(null);
    setUploadingImages(true);
    try {
      const formData = new FormData();
      files.forEach((f) => formData.append("images", f));
      const res = await fetch("/api/upload-source-images", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok || !data.urls) {
        setUploadError(data.error ?? `Upload failed (HTTP ${res.status})`);
        return;
      }
      setSourceImages((prev) => [...prev, ...(data.urls as string[])].slice(0, MAX_IMAGES));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload error");
    } finally {
      setUploadingImages(false);
    }
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { "image/*": [] },
    maxFiles: MAX_IMAGES,
    disabled: submitting || uploadingImages || sourceImages.length >= MAX_IMAGES,
    onDrop: uploadFiles,
  });

  async function handleStart() {
    if (!canStart) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/runs/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productDescription: productDescription.trim(),
          sourceImages,
          productUrl: productUrl.trim() || undefined,
          competitorUrls: competitorList.length ? competitorList : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.runId) {
        throw new Error(data.error ?? "Failed to start pipeline");
      }
      router.push(`/runs/${data.runId}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Unexpected error");
      setSubmitting(false);
    }
  }

  // Cmd/Ctrl-Enter to submit
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
  }, [productDescription, sourceImages, productUrl, competitorUrls, submitting, uploadingImages]);

  return (
    <main className="min-h-[calc(100vh-3rem)]">
      <div className="max-w-3xl mx-auto px-5 pt-12 pb-24">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-[22px] font-semibold tracking-tight text-[var(--color-text)] mb-1.5">
            Start a research run
          </h1>
          <p className="text-[13px] text-[var(--color-text-2)] leading-relaxed">
            Describe the product and drop in a few reference photos. We&rsquo;ll run Stage&nbsp;1 research,
            Stage&nbsp;2 German copy, and pause before Stage&nbsp;3 (images). URLs are optional &mdash;
            paste them only if you have them.
          </p>
        </div>

        {/* Form card */}
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] divide-y divide-[var(--color-border)] overflow-hidden">
          {/* Description */}
          <div className="px-5 py-4">
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="product-desc" className="block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--color-text-2)]">
                Product description <span className="text-[var(--color-error)] ml-0.5">*</span>
              </label>
              <span className="font-mono text-[10px] text-[var(--color-text-4)]">
                {productDescription.trim().length}/{MIN_DESCRIPTION_LEN}+
              </span>
            </div>
            <textarea
              id="product-desc"
              ref={descRef}
              value={productDescription}
              onChange={(e) => setProductDescription(e.target.value)}
              rows={5}
              placeholder="Describe the product: what it is, who it's for, key features, materials, how it works…"
              disabled={submitting}
              className={[
                "w-full bg-[var(--color-bg)] border rounded-lg px-3.5 py-2.5 text-[13px]",
                "text-[var(--color-text)] placeholder-[var(--color-text-4)]",
                "focus:outline-none transition-colors duration-150 resize-y disabled:opacity-40",
                productDescription.length > 0 && !descriptionOk
                  ? "border-[var(--color-error)]/50 focus:border-[var(--color-error)]"
                  : "border-[var(--color-border)] focus:border-[var(--color-accent)]/70 focus:ring-2 focus:ring-[var(--color-accent)]/15",
              ].join(" ")}
            />
            {productDescription.length > 0 && !descriptionOk && (
              <p className="mt-1.5 text-[11px] text-[var(--color-error)] font-mono">
                Need at least {MIN_DESCRIPTION_LEN} characters
              </p>
            )}
          </div>

          {/* Source images */}
          <div className="px-5 py-4">
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--color-text-2)]">
                Source images <span className="text-[var(--color-error)] ml-0.5">*</span>
              </label>
              <span className="font-mono text-[10px] text-[var(--color-text-4)]">
                {sourceImages.length}/{MAX_IMAGES}
              </span>
            </div>

            <div
              {...getRootProps()}
              className={[
                "rounded-lg border border-dashed px-4 py-6 text-center transition-colors duration-150",
                isDragActive
                  ? "border-[var(--color-accent)] bg-[color:rgb(107_158_200_/_0.06)]"
                  : "border-[var(--color-border)] hover:border-[var(--color-border-hover)] bg-[var(--color-bg)]/40",
                sourceImages.length >= MAX_IMAGES || submitting
                  ? "opacity-50 cursor-not-allowed"
                  : "cursor-pointer",
              ].join(" ")}
            >
              <input {...getInputProps()} />
              <Icon.Image className="w-5 h-5 text-[var(--color-text-3)] mx-auto mb-2" />
              <p className="text-[12px] text-[var(--color-text-2)]">
                {uploadingImages
                  ? "Uploading…"
                  : isDragActive
                    ? "Drop to upload"
                    : sourceImages.length >= MAX_IMAGES
                      ? "Maximum reached"
                      : "Drag images here or click to upload"}
              </p>
              <p className="font-mono text-[10px] text-[var(--color-text-4)] mt-1">
                Up to {MAX_IMAGES} · jpg, png, webp · 8MB each
              </p>
            </div>

            {uploadError && (
              <p className="mt-2 text-[11px] text-[var(--color-error)] font-mono">{uploadError}</p>
            )}

            {sourceImages.length > 0 && (
              <div className="grid grid-cols-5 gap-2 mt-3">
                {sourceImages.map((url, i) => (
                  <div key={url + i} className="relative aspect-square rounded-md overflow-hidden border border-[var(--color-border)] bg-[var(--color-bg)] group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`Source ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
                    <button
                      type="button"
                      onClick={() => setSourceImages((prev) => prev.filter((_, idx) => idx !== i))}
                      aria-label={`Remove image ${i + 1}`}
                      className="cursor-pointer absolute top-1 right-1 grid place-items-center w-5 h-5 rounded-full bg-[color:rgb(0_0_0_/_0.55)] text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Icon.X className="w-3 h-3" strokeWidth={2.6} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Advanced: URLs */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="cursor-pointer w-full flex items-center gap-2 px-5 py-3 text-left hover:bg-[var(--color-surface-2)] transition-colors duration-150"
              aria-expanded={showAdvanced}
            >
              <Icon.ChevronRight
                className={`w-3.5 h-3.5 text-[var(--color-text-3)] transition-transform duration-150 ${showAdvanced ? "rotate-90" : ""}`}
              />
              <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--color-text-2)]">
                Advanced
              </span>
              <span className="text-[11px] text-[var(--color-text-3)]">
                optional URLs · {(productUrl ? 1 : 0) + competitorList.length} provided
              </span>
            </button>
            {showAdvanced && (
              <div className="px-5 pb-4 space-y-4 fade-in">
                <div>
                  <label htmlFor="product-url" className="block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--color-text-2)] mb-1.5">
                    Product URL
                  </label>
                  <input
                    id="product-url"
                    type="url"
                    value={productUrl}
                    onChange={(e) => setProductUrl(e.target.value)}
                    placeholder="https://www.aliexpress.com/item/…"
                    disabled={submitting}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoComplete="off"
                    aria-invalid={productUrl.length > 0 && !urlValid}
                    className={[
                      "w-full bg-[var(--color-bg)] rounded-lg px-3.5 py-2.5 text-[13px]",
                      "text-[var(--color-text)] placeholder-[var(--color-text-4)]",
                      "focus:outline-none transition-colors duration-150 border disabled:opacity-40",
                      productUrl.length > 0 && !urlValid
                        ? "border-[var(--color-error)]/50 focus:border-[var(--color-error)]"
                        : "border-[var(--color-border)] focus:border-[var(--color-accent)]/70 focus:ring-2 focus:ring-[var(--color-accent)]/15",
                    ].join(" ")}
                  />
                  <p className="mt-1.5 text-[11px] text-[var(--color-text-3)]">
                    Optional. If provided, scraper attempts extra context. Description always wins on conflicts.
                  </p>
                </div>
                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--color-text-2)] mb-1.5">
                    Competitor URLs
                    <span className="text-[var(--color-text-4)] normal-case font-sans tracking-normal text-[11px] ml-1">
                      one per line, max 5
                    </span>
                  </label>
                  <textarea
                    value={competitorUrls}
                    onChange={(e) => setCompetitorUrls(e.target.value)}
                    placeholder={"https://example.com/product\nhttps://other.com/item"}
                    rows={3}
                    disabled={submitting}
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
              </div>
            )}
          </div>

          {/* Submit row */}
          <div className="px-5 py-4 flex items-center justify-between gap-4 bg-[var(--color-surface-2)]/30">
            <div className="text-[11px] text-[var(--color-text-3)] hidden sm:block">
              Runs in background · close the tab anytime.
            </div>
            <button
              onClick={handleStart}
              disabled={!canStart}
              className={[
                "cursor-pointer inline-flex items-center gap-2 px-4 h-9 rounded-md font-medium text-[13px] transition-all duration-150 border",
                canStart
                  ? "bg-[var(--color-accent)] hover:bg-[var(--color-accent-dim)] text-white border-[var(--color-accent)]"
                  : "bg-[var(--color-surface-3)] text-[var(--color-text-4)] border-[var(--color-border)] cursor-not-allowed",
              ].join(" ")}
            >
              {submitting ? (
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

        {submitError && (
          <div className="mt-3 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-[color:rgb(184_96_96_/_0.10)] border border-[color:rgb(184_96_96_/_0.28)] fade-in">
            <Icon.Alert className="w-4 h-4 text-[var(--color-error)] flex-shrink-0 mt-px" />
            <p className="text-[12px] text-[var(--color-error)] leading-relaxed">{submitError}</p>
          </div>
        )}

        {/* Stage explainer */}
        <div className="mt-10 grid sm:grid-cols-3 gap-3">
          {[
            { title: "Stage 1 — Research", body: "Product ID, market, avatar, offer brief, beliefs, one-pager." },
            { title: "Stage 2 — German copy", body: "Full DTC copy kit. Auto-runs after Stage 1." },
            { title: "Stage 3 — Images", body: "Pauses for approval. 11 Higgsfield product images." },
          ].map((s) => (
            <div key={s.title} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-2)] mb-1.5">{s.title}</p>
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
