"use client";

// Extra Stage 4 reference images. The operator uploads scene/style references
// (same R2 upload flow as the New Run source photos); the prompt writer sees
// them and decides per image which to attach to Higgsfield. Saved on the run;
// they take effect the next time the prompts are (re)generated.

import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";

const MAX = 6;

export default function Stage3ReferenceImages({ runId, initial }: { runId: number; initial: string[] }) {
  const [urls, setUrls] = useState<string[]>(initial);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const persist = useCallback(
    async (next: string[]) => {
      await fetch(`/api/runs/${runId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage3_reference_images: JSON.stringify(next) }),
      }).catch(() => setErr("Saved locally but couldn't sync — check your connection."));
    },
    [runId],
  );

  const onDrop = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      if (urls.length + files.length > MAX) { setErr(`Max ${MAX} reference images`); return; }
      setErr(null);
      setUploading(true);
      try {
        const fd = new FormData();
        files.forEach((f) => fd.append("images", f));
        const res = await fetch("/api/upload-source-images", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok || !data.urls) { setErr(data.error ?? `Upload failed (HTTP ${res.status})`); return; }
        const next = [...urls, ...(data.urls as string[])].slice(0, MAX);
        setUrls(next);
        await persist(next);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Upload error");
      } finally {
        setUploading(false);
      }
    },
    [urls, persist],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      "image/jpeg": [".jpg", ".jpeg"], "image/png": [".png"], "image/webp": [".webp"],
      "image/gif": [".gif"], "image/avif": [".avif"], "image/heic": [".heic"], "image/heif": [".heif"],
    },
    maxFiles: MAX,
    disabled: uploading || urls.length >= MAX,
    onDrop,
  });

  async function remove(i: number) {
    const next = urls.filter((_, j) => j !== i);
    setUrls(next);
    await persist(next);
  }

  return (
    <div className="border border-[var(--color-border)] rounded-[11px] bg-[var(--color-surface)] p-3 space-y-2.5">
      <div>
        <p className="text-[13px] font-[600] text-[var(--color-text)]">
          Reference images <span className="font-normal text-[var(--color-text-4)]">· optional</span>
        </p>
        <p className="text-[11.5px] text-[var(--color-text-3)] leading-snug">Scene or style references, used when prompts are generated.</p>
      </div>

      {urls.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {urls.map((u, i) => (
            <div key={u} className="relative w-16 h-16 rounded-lg overflow-hidden border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt={`reference ${i + 1}`} className="w-full h-full object-cover" />
              <button
                onClick={() => remove(i)}
                title="Remove"
                className="absolute top-0.5 right-0.5 w-5 h-5 inline-flex items-center justify-center rounded-full bg-black/65 text-white text-[13px] leading-none cursor-pointer opacity-0 group-hover:opacity-100 tr hover:bg-black/85"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {urls.length < MAX && (
        <div
          {...getRootProps()}
          className={`cursor-pointer rounded-lg border border-dashed px-3 py-3 text-center tr ${isDragActive ? "border-[var(--color-accent)] bg-[var(--color-accent-weak)]" : "border-[var(--color-border-strong)] hover:border-[var(--color-text-3)] hover:bg-[var(--color-surface-2)]"}`}
        >
          <input {...getInputProps()} />
          <p className="text-[12px] text-[var(--color-text-3)]">
            {uploading ? "Uploading…" : isDragActive ? "Drop to upload" : "Drop images or click to upload"}
          </p>
        </div>
      )}

      {err && <p className="text-[11px] text-[var(--color-red)]">{err}</p>}
    </div>
  );
}
