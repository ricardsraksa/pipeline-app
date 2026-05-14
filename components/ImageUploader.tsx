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
          "border border-dashed rounded-md p-6 text-center cursor-pointer transition-colors",
          isDragActive
            ? "border-[#2563eb] bg-[#2563eb]/5"
            : "border-[#333] hover:border-[#444]",
        ].join(" ")}
      >
        <input {...getInputProps()} />
        <p className="text-sm text-[#737373]">
          {isDragActive
            ? "Drop images here..."
            : "Drag & drop product images, or click to select"}
        </p>
        <p className="text-xs text-[#404040] mt-1">JPG, PNG, WebP — up to 8 images</p>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addUrl()}
          placeholder="Or paste an image URL..."
          className="flex-1 bg-[#111] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-[#e5e5e5] placeholder-[#404040] focus:outline-none focus:border-[#2563eb]"
        />
        <button
          onClick={addUrl}
          className="px-3 py-2 bg-[#1a1a1a] hover:bg-[#222] border border-[#2a2a2a] rounded text-sm text-[#737373] hover:text-[#e5e5e5] transition-colors"
        >
          Add
        </button>
      </div>

      {images.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {images.map((img, i) => (
            <div key={i} className="relative group aspect-square">
              <img
                src={img}
                alt={`ref ${i + 1}`}
                className="w-full h-full object-cover rounded border border-[#2a2a2a]"
              />
              <button
                onClick={() => removeImage(i)}
                className="absolute top-1 right-1 w-5 h-5 bg-black/80 rounded text-[#dc2626] text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
              >
                ×
              </button>
              <span className="absolute bottom-1 left-1 text-xs font-mono text-white/60 bg-black/60 px-1 rounded">
                {i + 1}
              </span>
            </div>
          ))}
        </div>
      )}

      {images.length < minImages && (
        <p className="text-xs text-[#b45309]">
          Add at least {minImages} reference images before running Stage 3.
        </p>
      )}
    </div>
  );
}
