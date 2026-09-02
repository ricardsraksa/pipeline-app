"use client";

// New Run: paste the product link (and any competitor / brand links), add your
// own photos if you have them, go. Stage 1 scrapes the pages and writes the
// product description; you review it before research starts.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useDropzone } from "react-dropzone";
import { Icon } from "@/components/ui/Icon";

const MAX_IMG = 10;
const inputCls = "w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-[var(--radius-sm)] px-[13px] py-[11px] text-sm transition-all focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)] placeholder:text-[var(--color-text-4)]";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

function looksLikeUrl(s: string): boolean {
  if (!s) return false;
  try { const u = new URL(s); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; }
}

function StepNum({ n, done }: { n: number; done: boolean }) {
  return (
    <span className={cx("w-6 h-6 rounded-full grid place-items-center text-[11.5px] font-bold border-2 shrink-0",
      done ? "bg-[var(--color-green)] border-[var(--color-green)] text-[var(--color-on-primary)]" : "border-[var(--color-border-strong)] text-[var(--color-text-3)]")}>
      {done ? <Icon.Check className="w-3 h-3" strokeWidth={3.2} /> : n}
    </span>
  );
}

export default function NewRunPage() {
  const router = useRouter();
  const urlRef = useRef<HTMLInputElement>(null);

  const [productUrl, setProductUrl] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [sourceImages, setSourceImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => { urlRef.current?.focus(); }, []);

  const competitorList = useMemo(
    () => competitors.split("\n").map((u) => u.trim()).filter(Boolean),
    [competitors]
  );
  const urlOk = looksLikeUrl(productUrl.trim());
  const competitorsValid = competitorList.every(looksLikeUrl) && competitorList.length <= 5;
  const canStart = urlOk && competitorsValid && !submitting && !uploading;

  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    if (sourceImages.length + files.length > MAX_IMG) { setUploadError(`Max ${MAX_IMG} images total`); return; }
    setUploadError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      files.forEach((f) => formData.append("images", f));
      const res = await fetch("/api/upload-source-images", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok || !data.urls) { setUploadError(data.error ?? `Upload failed (HTTP ${res.status})`); return; }
      setSourceImages((prev) => [...prev, ...(data.urls as string[])].slice(0, MAX_IMG));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload error");
    } finally { setUploading(false); }
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      "image/jpeg": [".jpg", ".jpeg"], "image/png": [".png"], "image/webp": [".webp"],
      "image/gif": [".gif"], "image/avif": [".avif"], "image/heic": [".heic"], "image/heif": [".heif"],
    },
    maxFiles: MAX_IMG,
    disabled: submitting || uploading || sourceImages.length >= MAX_IMG,
    onDrop: uploadFiles,
  });

  async function start() {
    if (!canStart) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/runs/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productUrl: productUrl.trim(),
          competitorUrls: competitorList.length ? competitorList.slice(0, 5) : undefined,
          sourceImages,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.runId) throw new Error(data.error ?? "Failed to start pipeline");
      router.push(`/runs/${data.runId}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Unexpected error");
      setSubmitting(false);
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); start(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productUrl, competitors, sourceImages, submitting, uploading]);

  return (
    <div className="px-6 py-8 max-w-[680px] mx-auto" data-screen-label="New Run">
      <Link href="/" className="cursor-pointer inline-flex items-center gap-1 text-[12px] text-[var(--color-text-3)] hover:text-[var(--color-text)] tr mb-4">
        <Icon.ArrowLeft className="w-3.5 h-3.5" /> Home
      </Link>
      <div className="mb-5">
        <h1 className="text-[26px] leading-tight font-bold tracking-tight ff-display text-[var(--color-text)]">New run</h1>
        <p className="text-[13px] text-[var(--color-text-2)] mt-1">Paste the product link. You review the description before research starts.</p>
      </div>

      <div className="border border-[var(--color-border)] rounded-[var(--radius)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] divide-y divide-[var(--color-border)] overflow-hidden">
        {/* 1 — product link */}
        <div className="px-5 py-5">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2.5"><StepNum n={1} done={urlOk} /><label className="text-[13.5px] font-[650] text-[var(--color-text)]">Product link</label></div>
            <span className="ff-mono text-[11px] text-[var(--color-text-4)]">AliExpress, Alibaba, Shopify…</span>
          </div>
          <input ref={urlRef} value={productUrl} onChange={(e) => setProductUrl(e.target.value)} spellCheck={false} disabled={submitting}
            placeholder="https://www.aliexpress.com/item/…"
            className={cx(inputCls, "ff-mono text-[12.5px] disabled:opacity-40", productUrl.length > 0 && !urlOk && "border-[var(--color-red)] focus:border-[var(--color-red)]")} />
          {productUrl.length > 0 && !urlOk && <p className="mt-1.5 text-[11px] text-[var(--color-red)] ff-mono">Needs a full https:// link</p>}
        </div>

        {/* 2 — competitors */}
        <div className="px-5 py-5">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2.5"><StepNum n={2} done={competitorList.length > 0 && competitorsValid} /><label className="text-[13.5px] font-[650] text-[var(--color-text)]">Competitor / brand links <span className="text-[var(--color-text-4)] font-normal">optional</span></label></div>
            <span className="ff-mono text-[11px] text-[var(--color-text-4)]">{competitorList.length}/5 · one per line</span>
          </div>
          <textarea value={competitors} onChange={(e) => setCompetitors(e.target.value)} rows={3} spellCheck={false} disabled={submitting}
            placeholder="https://brand.com/products/…"
            className={cx(inputCls, "ff-mono text-[12px] resize-y disabled:opacity-40", competitorList.length > 0 && !competitorsValid && "border-[var(--color-red)] focus:border-[var(--color-red)]")} />
          <p className="mt-2 text-[11.5px] text-[var(--color-text-3)]">Read for positioning only.</p>
        </div>

        {/* 3 — own photos */}
        <div className="px-5 py-5">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2.5"><StepNum n={3} done={sourceImages.length > 0} /><label className="text-[13.5px] font-[650] text-[var(--color-text)]">Your own photos <span className="text-[var(--color-text-4)] font-normal">optional</span></label></div>
            <span className="ff-mono text-[11px] text-[var(--color-text-4)]">{sourceImages.length}/{MAX_IMG}</span>
          </div>
          <div {...getRootProps()}
            className={cx("border-dashed border-2 rounded-[var(--radius-sm)] p-5 text-center tr",
              isDragActive ? "border-[var(--color-accent)] bg-[var(--color-accent-weak)]" : "border-[var(--color-border-strong)] bg-[var(--color-surface-2)] hover:border-[var(--color-accent)]",
              sourceImages.length >= MAX_IMG || submitting ? "opacity-50 cursor-not-allowed" : "cursor-pointer")}>
            <input {...getInputProps()} />
            <Icon.Image className="w-5 h-5 text-[var(--color-text-3)] mx-auto mb-1.5" />
            <p className="text-[13px] font-[550] text-[var(--color-text-2)]">
              {uploading ? "Uploading…" : isDragActive ? "Drop to upload" : sourceImages.length >= MAX_IMG ? "Maximum reached" : "Drag photos here or click to add"}
            </p>
            <p className="ff-mono text-[10.5px] text-[var(--color-text-3)] mt-1">Listing photos are added automatically.</p>
          </div>
          {uploadError && <p className="mt-2 text-[11px] text-[var(--color-red)] ff-mono">{uploadError}</p>}
          {sourceImages.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-2 mt-3">
              {sourceImages.map((url, i) => (
                <div key={url + i} className="aspect-square rounded-[8px] border border-[var(--color-border)] overflow-hidden relative group pop-in bg-[var(--color-surface-3)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Source ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
                  <button onClick={() => setSourceImages((p) => p.filter((_, idx) => idx !== i))}
                    aria-label={`Remove image ${i + 1}`}
                    className="cursor-pointer absolute top-1 right-1 grid place-items-center w-5 h-5 rounded-full bg-black/55 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                    <Icon.X className="w-3 h-3" strokeWidth={2.6} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* CTA */}
        <div className="px-5 py-4 flex items-center justify-between gap-3 bg-[var(--color-surface-2)]">
          <span />
          <button onClick={start} disabled={!canStart}
            className={cx("cursor-pointer inline-flex items-center gap-[7px] rounded-[var(--radius-sm)] px-[15px] py-[9px] text-[13.5px] font-[620] border border-transparent tr whitespace-nowrap",
              canStart ? "bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:brightness-110" : "bg-[var(--color-surface-3)] text-[var(--color-text-4)] cursor-not-allowed")}>
            {submitting
              ? (<><Icon.Loader className="w-3.5 h-3.5" /> Starting…</>)
              : (<><Icon.Play className="w-3.5 h-3.5" /> Run pipeline <span className="flex items-center gap-0.5 ml-1"><kbd className="kbd">⌘</kbd><kbd className="kbd">↵</kbd></span></>)}
          </button>
        </div>
      </div>

      {submitError && (
        <div className="mt-3 flex items-start gap-2 px-4 py-3 rounded-[var(--radius-sm)] bg-[var(--color-red-bg)] border fade-in" style={{ borderColor: "color-mix(in srgb, var(--color-red) 30%, transparent)" }}>
          <Icon.Alert className="w-4 h-4 text-[var(--color-red)] flex-shrink-0 mt-px" />
          <p className="text-[12px] text-[var(--color-red)] leading-relaxed">{submitError}</p>
        </div>
      )}
    </div>
  );
}
