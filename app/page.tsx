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

  const inputCls = [
    "w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)]",
    "rounded-lg px-[13px] py-[11px] text-sm font-[inherit] transition-all",
    "focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)]",
  ].join(" ");

  return (
    <main className="px-7 py-7 max-w-[720px] w-full mx-auto">
      {/* Header */}
      <div className="mb-7">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text)] mb-1.5">
          New Run
        </h1>
        <p className="text-[13px] text-[var(--color-text-2)] leading-relaxed">
          Describe the product and drop in a few reference photos. We&rsquo;ll run Stage&nbsp;1 research,
          Stage&nbsp;2 German copy, and pause before Stage&nbsp;3 (images).
        </p>
      </div>

      {/* Form card */}
      <div className="border border-[var(--color-border)] rounded-[11px] bg-[var(--color-surface)] shadow-[0_1px_2px_rgba(20,20,18,.05)] divide-y divide-[var(--color-border)] overflow-hidden">
        {/* Description */}
        <div className="px-5 py-5">
          <div className="flex items-center justify-between mb-2">
            <label htmlFor="product-desc" className="block text-[11px] font-[600] uppercase tracking-[0.1em] text-[var(--color-text-3)]">
              Product description <span className="text-[var(--color-error)] ml-0.5">*</span>
            </label>
            <span className="font-[var(--font-ibm-plex-mono)] text-[11px] text-[var(--color-text-4)]">
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
              inputCls,
              "placeholder:text-[var(--color-text-4)] resize-y disabled:opacity-40",
              productDescription.length > 0 && !descriptionOk
                ? "border-[var(--color-error)] focus:border-[var(--color-error)] focus:shadow-[0_0_0_3px_rgba(177,85,77,.15)]"
                : "",
            ].join(" ")}
          />
          {productDescription.length > 0 && !descriptionOk && (
            <p className="mt-1.5 text-[11px] text-[var(--color-error)] font-[var(--font-ibm-plex-mono)]">
              Need at least {MIN_DESCRIPTION_LEN} characters
            </p>
          )}
        </div>

        {/* Source images */}
        <div className="px-5 py-5">
          <div className="flex items-center justify-between mb-2">
            <label className="block text-[11px] font-[600] uppercase tracking-[0.1em] text-[var(--color-text-3)]">
              Source images <span className="text-[var(--color-error)] ml-0.5">*</span>
            </label>
            <span className="font-[var(--font-ibm-plex-mono)] text-[11px] text-[var(--color-text-4)]">
              {sourceImages.length}/{MAX_IMAGES}
            </span>
          </div>

          <div
            {...getRootProps()}
            className={[
              "border-dashed border-2 rounded-lg p-[26px] text-center transition-colors duration-150",
              isDragActive
                ? "border-[var(--color-accent)] bg-[var(--color-accent-weak)]"
                : "border-[var(--color-border-strong)] bg-[var(--color-surface-2)] hover:border-[var(--color-accent)] hover:bg-[var(--color-soft)]",
              sourceImages.length >= MAX_IMAGES || submitting
                ? "opacity-50 cursor-not-allowed"
                : "cursor-pointer",
            ].join(" ")}
          >
            <input {...getInputProps()} />
            <Icon.Image className="w-5 h-5 text-[var(--color-text-3)] mx-auto mb-2" />
            <p className="text-[13px] font-[500] text-[var(--color-text-2)]">
              {uploadingImages
                ? "Uploading…"
                : isDragActive
                  ? "Drop to upload"
                  : sourceImages.length >= MAX_IMAGES
                    ? "Maximum reached"
                    : "Drag images here or click to upload"}
            </p>
            <p className="font-[var(--font-ibm-plex-mono)] text-[11px] text-[var(--color-text-3)] mt-1">
              Up to {MAX_IMAGES} · jpg, png, webp · 8MB each
            </p>
          </div>

          {uploadError && (
            <p className="mt-2 text-[11px] text-[var(--color-error)] font-[var(--font-ibm-plex-mono)]">{uploadError}</p>
          )}

          {sourceImages.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-[10px] mt-[13px]">
              {sourceImages.map((url, i) => (
                <div key={url + i} className="aspect-square rounded-[9px] border border-[var(--color-border)] overflow-hidden bg-[var(--color-surface-3)] relative group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Source ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
                  <button
                    type="button"
                    onClick={() => setSourceImages((prev) => prev.filter((_, idx) => idx !== i))}
                    aria-label={`Remove image ${i + 1}`}
                    className="cursor-pointer absolute top-1 right-1 grid place-items-center w-5 h-5 rounded-full bg-[rgba(0,0,0,0.55)] text-white opacity-0 group-hover:opacity-100 transition-opacity"
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
            <span className="text-[11px] font-[600] uppercase tracking-[0.1em] text-[var(--color-text-2)]">
              Advanced
            </span>
            <span className="text-[12px] text-[var(--color-text-3)]">
              optional URLs · {(productUrl ? 1 : 0) + competitorList.length} provided
            </span>
          </button>
          {showAdvanced && (
            <div className="px-5 pb-5 space-y-4 fade-in">
              <div>
                <label htmlFor="product-url" className="block text-[11px] font-[600] uppercase tracking-[0.1em] text-[var(--color-text-3)] mb-2">
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
                    inputCls,
                    "placeholder:text-[var(--color-text-4)] disabled:opacity-40",
                    productUrl.length > 0 && !urlValid
                      ? "border-[var(--color-error)] focus:border-[var(--color-error)]"
                      : "",
                  ].join(" ")}
                />
                <p className="mt-1.5 text-[11px] text-[var(--color-text-3)]">
                  Optional. If provided, scraper attempts extra context. Description always wins on conflicts.
                </p>
              </div>
              <div>
                <label className="block text-[11px] font-[600] uppercase tracking-[0.1em] text-[var(--color-text-3)] mb-2">
                  Competitor URLs
                  <span className="text-[var(--color-text-4)] normal-case font-normal tracking-normal text-[11px] ml-1.5">
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
                    inputCls,
                    "font-[var(--font-ibm-plex-mono)] text-[12px] placeholder:text-[var(--color-text-4)] resize-y disabled:opacity-40",
                    competitorList.length > 0 && !competitorValid
                      ? "border-[var(--color-error)] focus:border-[var(--color-error)]"
                      : "",
                  ].join(" ")}
                />
              </div>
            </div>
          )}
        </div>

        {/* Submit row */}
        <div className="px-5 py-4 flex items-center justify-between gap-4 bg-[var(--color-surface-2)]">
          <div className="text-[12px] text-[var(--color-text-3)] hidden sm:block">
            Runs in background · close the tab anytime.
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/history"
              className="inline-flex items-center gap-[7px] rounded-lg px-[15px] py-[9px] text-[13.5px] font-[620] border border-transparent bg-transparent text-[var(--color-text-2)] transition-all hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)] whitespace-nowrap"
            >
              View Runs
            </Link>
            <button
              onClick={handleStart}
              disabled={!canStart}
              className={[
                "cursor-pointer inline-flex items-center gap-[7px] rounded-lg px-[15px] py-[9px] text-[13.5px] font-[620] border border-transparent transition-all whitespace-nowrap",
                canStart
                  ? "bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:brightness-105"
                  : "bg-[var(--color-surface-3)] text-[var(--color-text-4)] cursor-not-allowed",
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
      </div>

      {submitError && (
        <div className="mt-3 flex items-start gap-2 px-4 py-3 rounded-lg bg-[var(--color-red-bg)] border border-[var(--color-error)]/30 fade-in">
          <Icon.Alert className="w-4 h-4 text-[var(--color-error)] flex-shrink-0 mt-px" />
          <p className="text-[12px] text-[var(--color-error)] leading-relaxed">{submitError}</p>
        </div>
      )}

      {/* Stage explainer */}
      <div className="mt-8 grid sm:grid-cols-3 gap-3">
        {[
          { title: "Stage 1 — Research", body: "Product ID, market, avatar, offer brief, beliefs, one-pager." },
          { title: "Stage 2 — German copy", body: "Full DTC copy kit. Auto-runs after Stage 1." },
          { title: "Stage 3 — Images", body: "Pauses for approval. 11 Higgsfield product images." },
        ].map((s) => (
          <div key={s.title} className="border border-[var(--color-border)] rounded-[11px] bg-[var(--color-surface)] shadow-[0_1px_2px_rgba(20,20,18,.05)] px-4 py-3">
            <p className="text-[11px] font-[650] uppercase tracking-[0.08em] text-[var(--color-text-2)] mb-1">{s.title}</p>
            <p className="text-[12px] text-[var(--color-text-3)] leading-relaxed">{s.body}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
