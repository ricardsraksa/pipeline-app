"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";

interface ImageUploaderProps {
  images: string[];
  onImagesChange: (images: string[]) => void;
  minImages?: number;
}

export default function ImageUploader({
  images,
  onImagesChange,
  minImages = 2,
}: ImageUploaderProps) {
  const [urlInput, setUrlInput] = useState("");

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const readers = acceptedFiles.map(
        (file) =>
          new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(file);
          })
      );
      Promise.all(readers).then((base64s) => {
        onImagesChange([...images, ...base64s].slice(0, 8));
      });
    },
    [images, onImagesChange]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [".jpg", ".jpeg", ".png", ".webp"] },
    maxFiles: 8,
  });

  const addUrl = () => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    if (!images.includes(trimmed)) {
      onImagesChange([...images, trimmed]);
    }
    setUrlInput("");
  };

  const removeImage = (idx: number) => {
    onImagesChange(images.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-3">
      <div
        {...getRootProps()}
        className={[
          "border-dashed border-2 rounded-lg p-[26px] text-center cursor-pointer transition-colors",
          isDragActive
            ? "border-[var(--color-accent)] bg-[var(--color-accent-weak)]"
            : "border-[var(--color-border-strong)] bg-[var(--color-surface-2)] hover:border-[var(--color-accent)] hover:bg-[var(--color-soft)]",
        ].join(" ")}
      >
        <input {...getInputProps()} />
        <p className="text-[13px] font-[500] text-[var(--color-text-2)]">
          {isDragActive
            ? "Drop images here..."
            : "Drag & drop product images, or click to select"}
        </p>
        <p className="font-[var(--font-ibm-plex-mono)] text-[11px] text-[var(--color-text-3)] mt-1">JPG, PNG, WebP — up to 8 images</p>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addUrl()}
          placeholder="Or paste an image URL..."
          className="flex-1 border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-lg px-[13px] py-[9px] text-sm transition-all focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)] placeholder:text-[var(--color-text-4)]"
        />
        <button
          onClick={addUrl}
          className="cursor-pointer inline-flex items-center gap-[7px] rounded-lg px-[15px] py-[9px] text-[13.5px] font-[620] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] transition-all hover:border-[var(--color-text-3)] hover:bg-[var(--color-surface-2)] whitespace-nowrap"
        >
          Add
        </button>
      </div>

      {images.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-[10px]">
          {images.map((img, i) => (
            <div key={i} className="relative group aspect-square">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img}
                alt={`ref ${i + 1}`}
                className="w-full h-full object-cover rounded-[9px] border border-[var(--color-border)]"
              />
              <button
                onClick={() => removeImage(i)}
                className="cursor-pointer absolute top-1 right-1 w-5 h-5 bg-black/70 rounded text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-[var(--color-red)]"
              >
                ×
              </button>
              <span className="absolute bottom-1 left-1 text-xs font-[var(--font-ibm-plex-mono)] text-white/60 bg-black/50 px-1 rounded">
                {i + 1}
              </span>
            </div>
          ))}
        </div>
      )}

      {images.length < minImages && (
        <p className="text-xs text-[var(--color-warn)]">
          Add at least {minImages} reference images before running Stage 3.
        </p>
      )}
    </div>
  );
}
