"use client";

// New run: the product link, optional competitor links, optional photos.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";

const MAX_IMG = 10;
const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");
const inputCls = "px-[11px] bg-[var(--color-surface)] border border-[var(--color-border-strong)] rounded-[6px] outline-none text-[13px] text-[var(--color-text)] placeholder:text-[var(--color-text-3)] focus:border-[var(--color-accent)] tr";

function looksLikeUrl(s: string): boolean {
  try { const u = new URL(s); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; }
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

  const competitorList = useMemo(() => competitors.split("\n").map((u) => u.trim()).filter(Boolean), [competitors]);
  const urlOk = looksLikeUrl(productUrl.trim());
  const competitorsValid = competitorList.every(looksLikeUrl) && competitorList.length <= 5;
  const canStart = urlOk && competitorsValid && !submitting && !uploading;

  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    if (sourceImages.length + files.length > MAX_IMG) { setUploadError(`Max ${MAX_IMG} photos`); return; }
    setUploadError(null); setUploading(true);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("images", f));
      const res = await fetch("/api/upload-source-images", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.urls) { setUploadError(data.error ?? `Upload failed (HTTP ${res.status})`); return; }
      setSourceImages((p) => [...p, ...(data.urls as string[])].slice(0, MAX_IMG));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload error");
    } finally { setUploading(false); }
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { "image/jpeg": [".jpg", ".jpeg"], "image/png": [".png"], "image/webp": [".webp"], "image/gif": [".gif"], "image/avif": [".avif"], "image/heic": [".heic"], "image/heif": [".heif"] },
    maxFiles: MAX_IMG,
    disabled: submitting || uploading || sourceImages.length >= MAX_IMG,
    onDrop: uploadFiles,
  });

  async function start() {
    if (!canStart) return;
    setSubmitError(null); setSubmitting(true);
    try {
      const res = await fetch("/api/runs/start", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productUrl: productUrl.trim(), competitorUrls: competitorList.length ? competitorList.slice(0, 5) : undefined, sourceImages }),
      });
      const data = await res.json();
      if (!res.ok || !data.runId) throw new Error(data.error ?? "Failed to start");
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

  const Label = ({ children, hint }: { children: React.ReactNode; hint: string }) => (
    <div className="flex items-baseline gap-2">
      <label className="text-[13px] font-[500] text-[var(--color-text)]">{children}</label>
      <span className="text-[11.5px] text-[var(--color-text-3)]">{hint}</span>
    </div>
  );

  return (
    <div style={{ maxWidth: 620, margin: "0 auto", padding: "44px 22px 80px" }} data-screen-label="New Run">
      <h1 className="text-[19px] font-[600] tracking-[-0.02em] mb-[26px] text-[var(--color-text)]">New run</h1>
      <div className="flex flex-col gap-[22px]">
        <div className="flex flex-col gap-1.5">
          <Label hint="AliExpress, Alibaba, Shopify">Product link</Label>
          <input ref={urlRef} value={productUrl} onChange={(e) => setProductUrl(e.target.value)} spellCheck={false} disabled={submitting}
            placeholder="https://" className={cx(inputCls, "h-[38px] ff-mono", productUrl && !urlOk && "border-[var(--color-red)]")} />
          {productUrl && !urlOk && <span className="text-[11.5px] text-[var(--color-red)]">Needs a full https:// link</span>}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label hint="Optional · up to 5, one per line · positioning only">Competitor links</Label>
          <textarea value={competitors} onChange={(e) => setCompetitors(e.target.value)} rows={4} spellCheck={false} disabled={submitting}
            className={cx(inputCls, "py-[9px] ff-mono resize-y", competitorList.length > 0 && !competitorsValid && "border-[var(--color-red)]")} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label hint="Optional · listing photos are added automatically">Your photos</Label>
          <div {...getRootProps()}
            className={cx("h-[84px] rounded-[6px] border border-dashed grid place-items-center text-[12.5px] bg-[var(--color-surface)] tr",
              isDragActive ? "border-[var(--color-accent)] text-[var(--color-text)]" : "border-[var(--color-border-strong)] text-[var(--color-text-2)]",
              sourceImages.length >= MAX_IMG || submitting ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:border-[var(--color-accent)] hover:text-[var(--color-text)]")}>
            <input {...getInputProps()} />
            {uploading ? "Uploading…" : isDragActive ? "Drop to upload" : sourceImages.length ? `${sourceImages.length} added — drop more, or click` : "Drop up to 10 files, or click"}
          </div>
          {uploadError && <span className="text-[11.5px] text-[var(--color-red)]">{uploadError}</span>}
          {sourceImages.length > 0 && (
            <div className="grid gap-2 mt-1" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(72px,1fr))" }}>
              {sourceImages.map((url, i) => (
                <div key={url + i} className="relative aspect-square rounded-[6px] overflow-hidden border border-[var(--color-border)] group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
                  <button onClick={() => setSourceImages((p) => p.filter((_, idx) => idx !== i))} aria-label="Remove"
                    className="cursor-pointer absolute top-1 right-1 w-4 h-4 rounded-full bg-black/60 text-white text-[10px] grid place-items-center opacity-0 group-hover:opacity-100 tr">×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 pt-0.5">
          <button onClick={start} disabled={!canStart}
            className={cx("cursor-pointer h-[38px] px-4 rounded-[6px] text-[13.5px] font-[500] tr",
              canStart ? "bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:opacity-90" : "bg-[var(--color-surface-2)] text-[var(--color-text-3)] cursor-not-allowed")}>
            {submitting ? "Starting…" : "Run pipeline"}
          </button>
          <span className="ff-mono text-[11px] text-[var(--color-text-3)]">⌘↵</span>
        </div>

        {submitError && <p className="text-[12.5px] text-[var(--color-red)]">{submitError}</p>}
      </div>
    </div>
  );
}
