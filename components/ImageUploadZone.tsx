"use client"
import { useCallback } from 'react'
import { useDropzone } from 'react-dropzone'

interface ImageUploadZoneProps {
  /** Base64 data URIs of already-uploaded images */
  images: string[]
  onAdd: (base64: string[]) => void
  onRemove: (index: number) => void
  label?: string
}

export default function ImageUploadZone({
  images,
  onAdd,
  onRemove,
  label = "Drop product images here or click to browse",
}: ImageUploadZoneProps) {
  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const base64s = await Promise.all(
        acceptedFiles.map(
          (file) =>
            new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => resolve(reader.result as string)
              reader.onerror = reject
              reader.readAsDataURL(file)
            }),
        ),
      )
      onAdd(base64s)
    },
    [onAdd],
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/jpeg': [],
      'image/png': [],
      'image/webp': [],
    },
  })

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        {...getRootProps()}
        className={`border-dashed border-2 rounded-lg p-[26px] text-center flex flex-col items-center gap-2 cursor-pointer transition-colors ${
          isDragActive
            ? 'border-[var(--color-accent)] bg-[var(--color-accent-weak)]'
            : 'border-[var(--color-border-strong)] bg-[var(--color-surface-2)] hover:border-[var(--color-accent)] hover:bg-[var(--color-soft)]'
        }`}
      >
        <input {...getInputProps()} />
        {/* Upload icon */}
        <svg
          className={`w-5 h-5 transition-colors ${isDragActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-3)]'}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <p className={`text-[13px] font-[500] transition-colors ${isDragActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-2)]'}`}>
          {isDragActive ? 'Drop images here…' : label}
        </p>
        <p className="font-[var(--font-ibm-plex-mono)] text-[11px] text-[var(--color-text-3)]">JPEG · PNG · WebP</p>
      </div>

      {/* Uploaded thumbnails */}
      {images.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-[10px]">
          {images.map((src, i) => (
            <div key={i} className="relative group aspect-square">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={`Upload ${i + 1}`}
                className="w-full h-full object-cover rounded-[9px] border border-[var(--color-border)]"
              />
              <button
                onClick={(e) => { e.stopPropagation(); onRemove(i) }}
                className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 text-white text-[10px] leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:bg-[var(--color-red)]"
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
