"use client"
import { useState, useRef, useEffect, useCallback } from "react"

type SaveState = "idle" | "pending" | "saving" | "saved" | "error"

interface ImageReviewGridProps {
  runId: number
  scrapedUrls: string[]
  approvedUrls: string[]
  onApprovedChange: (urls: string[]) => void
  uploadedUrls?: string[]
  readOnly?: boolean
}

export default function ImageReviewGrid({
  runId,
  scrapedUrls,
  approvedUrls,
  onApprovedChange,
  uploadedUrls = [],
  readOnly = false,
}: ImageReviewGridProps) {
  const allUrls = [...scrapedUrls, ...uploadedUrls]

  const [local, setLocal] = useState<Set<string>>(() => new Set(approvedUrls))
  const [saveState, setSaveState] = useState<SaveState>("idle")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setLocal(new Set(approvedUrls))
  }, [approvedUrls.join(",")])  // eslint-disable-line react-hooks/exhaustive-deps

  const scheduleUpdate = useCallback(
    (nextSet: Set<string>) => {
      if (readOnly) return
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      setSaveState("pending")
      const urls = Array.from(nextSet)
      debounceRef.current = setTimeout(async () => {
        setSaveState("saving")
        try {
          const res = await fetch(`/api/runs/${runId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "image_approval", approved_urls: urls }),
          })
          if (!res.ok) throw new Error("Save failed")
          setSaveState("saved")
          savedTimerRef.current = setTimeout(() => setSaveState("idle"), 1500)
        } catch {
          setSaveState("error")
        }
      }, 500)
    },
    [runId, readOnly],
  )

  function toggle(url: string) {
    if (readOnly) return
    const next = new Set(local)
    if (next.has(url)) next.delete(url)
    else next.add(url)
    setLocal(next)
    onApprovedChange(Array.from(next))
    scheduleUpdate(next)
  }

  function approveAll() {
    if (readOnly) return
    const next = new Set(allUrls)
    setLocal(next)
    onApprovedChange(Array.from(next))
    scheduleUpdate(next)
  }

  function clearAll() {
    if (readOnly) return
    const next = new Set<string>()
    setLocal(next)
    onApprovedChange([])
    scheduleUpdate(next)
  }

  async function retryUpdate() {
    setSaveState("saving")
    const urls = Array.from(local)
    try {
      const res = await fetch(`/api/runs/${runId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "image_approval", approved_urls: urls }),
      })
      if (!res.ok) throw new Error("Save failed")
      setSaveState("saved")
      savedTimerRef.current = setTimeout(() => setSaveState("idle"), 1500)
    } catch {
      setSaveState("error")
    }
  }

  const approvedCount = local.size

  if (allUrls.length === 0) return null

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="space-y-0.5">
          <h3 className="text-[13px] font-[600] text-[var(--color-text)]">Product Images</h3>
          <p className="font-[var(--font-ibm-plex-mono)] text-[10px] text-[var(--color-text-3)]">
            Tick the images you want to use for Stage 3.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saveState === "pending" || saveState === "saving" ? (
            <span className="font-[var(--font-ibm-plex-mono)] text-[10px] text-[var(--color-text-3)] animate-pulse">Saving…</span>
          ) : saveState === "saved" ? (
            <span className="font-[var(--font-ibm-plex-mono)] text-[10px] text-[var(--color-green)]">Saved</span>
          ) : saveState === "error" ? (
            <span className="flex items-center gap-1.5">
              <span className="font-[var(--font-ibm-plex-mono)] text-[10px] text-[var(--color-error)]">Save failed</span>
              <button
                onClick={retryUpdate}
                className="font-[var(--font-ibm-plex-mono)] text-[10px] text-[var(--color-text-2)] underline hover:text-[var(--color-text)] cursor-pointer transition-colors"
              >
                retry
              </button>
            </span>
          ) : null}

          <span className="font-[var(--font-ibm-plex-mono)] text-[11px] text-[var(--color-text-3)]">
            {approvedCount} of {allUrls.length} approved
          </span>

          {!readOnly && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={approveAll}
                className="cursor-pointer font-[var(--font-ibm-plex-mono)] text-[10px] text-[var(--color-text-2)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)] px-2 py-0.5 rounded transition-colors"
              >
                Approve all
              </button>
              <button
                onClick={clearAll}
                className="cursor-pointer font-[var(--font-ibm-plex-mono)] text-[10px] text-[var(--color-text-2)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)] px-2 py-0.5 rounded transition-colors"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Image grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {allUrls.map((url, i) => {
          const isApproved = local.has(url)
          const isUploaded = uploadedUrls.includes(url)
          return (
            <button
              key={i}
              onClick={() => toggle(url)}
              disabled={readOnly}
              title={readOnly ? undefined : isApproved ? "Click to reject" : "Click to approve"}
              className={`relative group rounded-[9px] border p-1.5 transition-all duration-150 text-left overflow-hidden ${
                readOnly
                  ? "cursor-default"
                  : "cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
              } ${
                isApproved
                  ? "border-[var(--color-green)] ring-1 ring-[var(--color-green)]/30 bg-[var(--color-surface)]"
                  : "border-[var(--color-border)] bg-[var(--color-surface)]"
              }`}
            >
              {/* Thumbnail */}
              <div className="aspect-square w-full overflow-hidden rounded-md bg-[var(--color-surface-2)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`Image ${i + 1}`}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none"
                  }}
                />
              </div>

              {/* Checkbox — top-left */}
              <div className="absolute top-2.5 left-2.5 pointer-events-none">
                <div
                  className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                    isApproved
                      ? "border-[var(--color-green)] bg-[var(--color-green)]"
                      : "border-[var(--color-border-strong)] bg-[var(--color-surface)]/80"
                  }`}
                >
                  {isApproved && (
                    <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
              </div>

              {/* Approved badge — top-right */}
              {isApproved && (
                <span className="absolute top-2 right-2 text-[9px] bg-[var(--color-green-bg)] text-[var(--color-green)] px-1.5 py-0.5 rounded-full font-[var(--font-ibm-plex-mono)] border border-[var(--color-green)]/30">
                  Approved
                </span>
              )}

              {/* Uploaded badge */}
              {isUploaded && (
                <span className="absolute bottom-2 left-2 text-[9px] bg-[var(--color-surface-2)] text-[var(--color-text-3)] px-1.5 py-0.5 rounded font-[var(--font-ibm-plex-mono)] border border-[var(--color-border)]">
                  Uploaded
                </span>
              )}

              {/* Hover tooltip (non-readOnly only) */}
              {!readOnly && (
                <div className="absolute inset-0 flex items-end justify-center pb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  <span className="bg-black/60 text-[9px] font-[var(--font-ibm-plex-mono)] text-white px-2 py-0.5 rounded">
                    {isApproved ? "Click to reject" : "Click to approve"}
                  </span>
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
