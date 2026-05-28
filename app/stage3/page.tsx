"use client"
import { useEffect, useState, useCallback, useMemo, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { IMAGE_CATEGORIES } from '@/lib/stage3/categories'
import { Icon } from '@/components/ui/Icon'
import type { ImagePrompt, AuditResult, Stage3Phase, Verdict } from '@/lib/stage3/types'
import { effectiveVerdict } from '@/lib/stage3/types'
import type { Run } from '@/lib/db'
import FeedbackButtons from '@/components/FeedbackButtons'
import FeedbackAppliedChip from '@/components/FeedbackAppliedChip'

// Cap total reference images per generation. Higgsfield accepts multiple refs;
// pushing beyond ~4 doesn't materially improve fidelity and slows submission.
const MAX_REFS = 4

/**
 * Build the reference-image set for ONE Stage 3 generation.
 *
 * Order matters — most image models weight the first refs more heavily.
 * Operator-uploaded source photos go first (they are the ground truth for
 * "what does the product actually look like"), then any prompt-specific refs
 * Claude picked out of the scraped product images. Duplicates are removed.
 *
 * If the operator never uploaded sources, we fall back to the prompt-specific
 * refs / scraped image at the chosen index, matching legacy behaviour.
 */
function buildReferenceImages(
  uploadedSources: string[],
  promptRefs: string[],
  scrapedImages: string[],
  promptRefIndex: number | undefined,
): string[] {
  const fallback = promptRefIndex != null
    ? [scrapedImages[promptRefIndex]].filter(Boolean)
    : scrapedImages.slice(0, 1)
  const ordered: string[] = []
  for (const u of uploadedSources) if (u) ordered.push(u)
  for (const r of promptRefs ?? []) if (r) ordered.push(r)
  if (ordered.length === 0) for (const f of fallback) if (f) ordered.push(f)
  const seen = new Set<string>()
  const deduped: string[] = []
  for (const u of ordered) {
    if (seen.has(u)) continue
    seen.add(u)
    deduped.push(u)
    if (deduped.length >= MAX_REFS) break
  }
  return deduped
}

// ─── Sub-components ──────────────────────────────────────────────────────────

// Cycle order when the user clicks the badge to override:
//   pass → fail → (clear override, revert to audit) → ...
function nextOverride(current: Verdict | null, autoVerdict: Verdict): Verdict | null {
  // Three logical states for the click cycle: pass, fail, no-override.
  // If we're on no-override, flip to the OPPOSITE of the auditor's verdict.
  // If we're already overriding, flip to the auditor's verdict — but if that
  // would just match what they said anyway, clear the override instead.
  if (current === null) return autoVerdict === 'pass' ? 'fail' : 'pass'
  const flipped: Verdict = current === 'pass' ? 'fail' : 'pass'
  return flipped === autoVerdict ? null : flipped
}

function VerdictBadge({
  verdict,
  overridden = false,
  onClick,
  title,
}: {
  verdict: Verdict
  overridden?: boolean
  onClick?: () => void
  title?: string
}) {
  const tone =
    verdict === 'pass'
      ? { bg: 'var(--color-green-bg)', fg: 'var(--color-green)', label: 'Pass' }
      : { bg: 'var(--color-red-bg)', fg: 'var(--color-red)', label: 'Fail' }

  // Append the manual-override hint to the label so it's visible even on small chips.
  const labelText = overridden ? `${tone.label} (manual)` : tone.label

  const baseCls = `inline-flex items-center gap-1.5 text-xs font-[620] px-2.5 py-1 rounded-full whitespace-nowrap ${overridden ? 'ring-1 ring-[var(--color-text)]/30 ring-offset-1 ring-offset-[var(--color-surface)]' : ''}`

  if (!onClick) {
    return (
      <span className={baseCls} style={{ background: tone.bg, color: tone.fg }} title={title}>
        <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />{labelText}
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? 'Click to flip pass ↔ fail. Click again to clear override.'}
      className={`${baseCls} cursor-pointer transition-all hover:brightness-95`}
      style={{ background: tone.bg, color: tone.fg }}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />{labelText}
    </button>
  )
}

interface ImageSlot {
  url: string | null
  status: 'pending' | 'generating' | 'done' | 'error'
  error?: string
}

// Download a generated image. Tries a blob download (forces a real "Save");
// falls back to opening the image in a new tab if the CDN blocks cross-origin
// fetches.
async function downloadImage(url: string, filename: string) {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error('fetch failed')
    const blob = await res.blob()
    const objUrl = URL.createObjectURL(blob)
    const a = Object.assign(document.createElement('a'), { href: objUrl, download: filename })
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(objUrl)
  } catch {
    window.open(url, '_blank', 'noopener')
  }
}

function ImageCell({
  image,
  prompt,
  auditResult,
  onRegenerate,
  onOverrideVerdict,
  onSaveNote,
  regenCount,
}: {
  image: ImageSlot
  prompt: ImagePrompt
  auditResult: AuditResult | null
  onRegenerate: () => void
  onOverrideVerdict?: () => void
  /** Persist the operator's note onto auditResult.user_note (drives the next
   *  regen's prompt rewrite). Distinct from the stage3 learning store. */
  onSaveNote?: (note: string) => void
  regenCount: number
}) {
  const [showDetails, setShowDetails] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackVote, setFeedbackVote] = useState<'up' | 'down' | null>(null)
  const [feedbackNote, setFeedbackNote] = useState(auditResult?.user_note ?? '')
  const [feedbackSaved, setFeedbackSaved] = useState(false)
  const cat = IMAGE_CATEGORIES.find(c => c.id === prompt.category)
  const catIndex = IMAGE_CATEGORIES.findIndex(c => c.id === prompt.category)
  const hasNote = (auditResult?.user_note ?? '').trim().length > 0

  async function saveImageFeedback() {
    if (!feedbackVote && !feedbackNote.trim()) {
      setFeedbackOpen(false)
      return
    }
    // Persist the note to auditResult.user_note so the next regen of THIS
    // image picks it up as additional rewrite instructions. (The vote+note
    // also still go to the stage3 learning store below for future runs.)
    if (onSaveNote) onSaveNote(feedbackNote.trim())
    try {
      await fetch('/api/stage3/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_feedback: [{
            category: prompt.category,
            vote: feedbackVote ?? 'down',
            note: feedbackNote.trim() || undefined,
            prompt_used: prompt.prompt.slice(0, 300),
            timestamp: new Date().toISOString(),
          }],
        }),
      })
      setFeedbackSaved(true)
      setTimeout(() => { setFeedbackOpen(false); setFeedbackSaved(false) }, 800)
    } catch { /* informational only */ }
  }

  return (
    <div className="aspect-square rounded-[11px] border border-[var(--color-border)] overflow-hidden relative bg-[var(--color-surface)] group shadow-[0_1px_2px_rgba(20,20,18,.05)]">
      {image.status === 'done' && image.url ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.url} alt={cat?.label ?? prompt.category} className="w-full h-full object-cover" />
          {auditResult && (
            <div className="absolute top-2 left-2">
              <VerdictBadge
                verdict={effectiveVerdict(auditResult) ?? auditResult.verdict}
                overridden={auditResult.user_override != null}
                onClick={onOverrideVerdict}
                title={
                  auditResult.user_override != null
                    ? `Overridden — auditor said ${auditResult.verdict}. Click to cycle.`
                    : `Auditor: ${auditResult.verdict}. Click to override.`
                }
              />
            </div>
          )}
          {auditResult && auditResult.issues.length > 0 && (
            <button
              onClick={() => setShowDetails(v => !v)}
              className="absolute top-2 right-2 w-5 h-5 rounded-full bg-black/60 text-white text-[9px] font-[var(--font-ibm-plex-mono)] flex items-center justify-center cursor-pointer hover:bg-black/80"
            >
              i
            </button>
          )}
          {hasNote && (
            <button
              onClick={() => setFeedbackOpen(true)}
              title={`Your note: "${auditResult?.user_note ?? ''}". Click to edit. Applied on next regenerate.`}
              className={`absolute top-2 ${auditResult && auditResult.issues.length > 0 ? 'right-9' : 'right-2'} w-5 h-5 rounded-full bg-[var(--color-accent)] text-white text-[10px] flex items-center justify-center cursor-pointer hover:brightness-110`}
              aria-label="Your note (applied on next regenerate)"
            >
              💬
            </button>
          )}
          {/* Action bar — Download + Rate + Regenerate, revealed on hover */}
          <div className="absolute bottom-0 left-0 right-0 p-2 flex items-center justify-between gap-1 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => downloadImage(image.url as string, `${prompt.category || 'image'}_${catIndex + 1}.png`)}
              className="px-2 py-1 bg-white/15 hover:bg-white/25 text-white text-[10px] font-[var(--font-ibm-plex-mono)] rounded cursor-pointer transition-colors"
            >
              Download
            </button>
            <button
              onClick={() => setFeedbackOpen(v => !v)}
              title="Rate this image"
              className="px-2 py-1 bg-white/15 hover:bg-white/25 text-white text-[10px] font-[var(--font-ibm-plex-mono)] rounded cursor-pointer transition-colors"
            >
              Rate
            </button>
            {regenCount < 3 ? (
              <button
                onClick={onRegenerate}
                className="px-2 py-1 bg-white/15 hover:bg-white/25 text-white text-[10px] font-[var(--font-ibm-plex-mono)] rounded cursor-pointer transition-colors"
              >
                Regenerate
              </button>
            ) : (
              <span className="px-2 py-1 text-white/50 text-[9px] font-[var(--font-ibm-plex-mono)]">Max retries</span>
            )}
          </div>
          {feedbackOpen && (
            <div className="absolute inset-0 bg-black/85 p-3 flex flex-col gap-2">
              <p className="font-[var(--font-ibm-plex-mono)] text-[9px] text-white/60 uppercase tracking-wider">
                Rate this image ({cat?.label})
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setFeedbackVote(v => v === 'up' ? null : 'up')}
                  className={`px-2 py-1 rounded text-[11px] font-[var(--font-ibm-plex-mono)] cursor-pointer transition-colors ${feedbackVote === 'up' ? 'bg-[var(--color-green)] text-white' : 'bg-white/15 text-white hover:bg-white/25'}`}
                >
                  👍
                </button>
                <button
                  onClick={() => setFeedbackVote(v => v === 'down' ? null : 'down')}
                  className={`px-2 py-1 rounded text-[11px] font-[var(--font-ibm-plex-mono)] cursor-pointer transition-colors ${feedbackVote === 'down' ? 'bg-[var(--color-red)] text-white' : 'bg-white/15 text-white hover:bg-white/25'}`}
                >
                  👎
                </button>
              </div>
              <textarea
                value={feedbackNote}
                onChange={(e) => setFeedbackNote(e.target.value)}
                placeholder="What to change (e.g. warmer lighting, brushed steel more visible). Applied to THIS image's prompt on the next regenerate, and saved as feedback for future runs."
                rows={3}
                className="w-full text-[10px] text-white bg-white/10 border border-white/20 rounded p-1.5 placeholder:text-white/40 focus:outline-none focus:border-white/60 resize-none"
              />
              <div className="flex items-center justify-between gap-2 mt-auto">
                <button
                  onClick={() => { setFeedbackOpen(false); setFeedbackVote(null); setFeedbackNote('') }}
                  className="text-[9px] text-white/40 hover:text-white/70 font-[var(--font-ibm-plex-mono)] cursor-pointer"
                >
                  cancel
                </button>
                <button
                  onClick={saveImageFeedback}
                  className="px-2 py-1 bg-[var(--color-primary)] text-[var(--color-on-primary)] text-[10px] font-[620] rounded cursor-pointer hover:brightness-105"
                >
                  {feedbackSaved ? 'Saved ✓' : 'Save'}
                </button>
              </div>
            </div>
          )}
          {showDetails && auditResult && (
            <div className="absolute inset-0 bg-black/85 p-3 flex flex-col gap-1 overflow-y-auto">
              <p className="font-[var(--font-ibm-plex-mono)] text-[9px] text-white/60 uppercase tracking-wider mb-1">Issues</p>
              {auditResult.issues.map((issue, i) => (
                <p key={i} className="text-[10px] text-white/80 font-[var(--font-ibm-plex-mono)] leading-relaxed">• {issue}</p>
              ))}
              <button onClick={() => setShowDetails(false)} className="mt-auto text-[9px] text-white/40 hover:text-white/60 font-[var(--font-ibm-plex-mono)] cursor-pointer">close</button>
            </div>
          )}
        </>
      ) : image.status === 'generating' ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-2 h-2 rounded-full bg-[var(--color-accent)] animate-pulse" />
        </div>
      ) : image.status === 'error' ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-3 gap-1">
          <span className="text-[var(--color-error)] font-[var(--font-ibm-plex-mono)] text-[10px]">Failed</span>
          <span className="text-[var(--color-text-3)] text-[9px] text-center font-[var(--font-ibm-plex-mono)]">{image.error?.slice(0, 60)}</span>
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
          <span className="font-[var(--font-ibm-plex-mono)] text-[var(--color-text-4)] text-lg">{catIndex + 1}</span>
          <span className="font-[var(--font-ibm-plex-mono)] text-[var(--color-text-4)] text-[9px] text-center px-2">{cat?.label}</span>
        </div>
      )}
    </div>
  )
}

function PhaseIndicator({ phase }: { phase: Stage3Phase }) {
  const steps = [
    { id: 'A_generating', label: 'Prompts' },
    { id: 'B_qc_gate', label: 'QC Gate' },
    { id: 'C_generating', label: 'Generate' },
    { id: 'D_auditing', label: 'Audit' },
    { id: 'E_complete', label: 'Complete' },
  ]
  const phaseOrder: Stage3Phase[] = ['loading', 'A_generating', 'B_qc_gate', 'C_generating', 'D_auditing', 'E_complete', 'error']
  const currentIdx = phaseOrder.indexOf(phase)

  return (
    <div className="flex items-center gap-2 mb-8">
      {steps.map((step, i) => {
        const stepOrder = i + 1
        const isActive = phase === step.id
        const isDone = currentIdx > stepOrder
        return (
          <div key={step.id} className="flex items-center gap-2">
            {i > 0 && <div className="w-6 h-px bg-[var(--color-border-strong)]" />}
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isActive ? 'bg-[var(--color-accent)]' : isDone ? 'bg-[var(--color-green)]' : 'bg-[var(--color-border-strong)]'}`} />
              <span className={`text-[11px] font-[550] ${isActive ? 'text-[var(--color-accent)]' : isDone ? 'text-[var(--color-green)]' : 'text-[var(--color-text-3)]'}`}>
                {step.label}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function LoadingState({ message, subtitle }: { message: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <div className="w-3 h-3 rounded-full bg-[var(--color-accent)] animate-pulse" />
      <p className="text-sm text-[var(--color-text-2)] font-[500]">{message}</p>
      {subtitle && <p className="font-[var(--font-ibm-plex-mono)] text-[11px] text-[var(--color-text-3)] max-w-sm text-center">{subtitle}</p>}
    </div>
  )
}

function ErrorState({ message, runId }: { message: string; runId: string | null }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <p className="text-sm text-[var(--color-error)] font-[600]">Error</p>
      <p className="font-[var(--font-ibm-plex-mono)] text-[11px] text-[var(--color-text-3)] max-w-md text-center">{message}</p>
      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={() => window.location.reload()}
          className="cursor-pointer inline-flex items-center rounded-lg px-4 py-2 text-[13px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] border border-transparent transition-all hover:brightness-105"
        >
          Retry Stage 3
        </button>
        {runId && (
          <Link
            href={`/runs/${runId}#stage-2-section`}
            className="cursor-pointer inline-flex items-center rounded-lg px-4 py-2 text-[13px] font-[550] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text-2)] transition-all hover:border-[var(--color-text-3)] hover:bg-[var(--color-surface-2)]"
          >
            Back to Stage 2
          </Link>
        )}
        {runId && (
          <Link
            href={`/runs/${runId}`}
            className="cursor-pointer inline-flex items-center rounded-lg px-4 py-2 text-[13px] font-[550] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text-2)] transition-all hover:border-[var(--color-text-3)] hover:bg-[var(--color-surface-2)]"
          >
            Back to run
          </Link>
        )}
      </div>
    </div>
  )
}

/**
 * "Edit with AI" affordance for a single prompt — shared between the QC gate
 * and the per-image regen modal. Collapsed by default; opens an inline textarea
 * for instructions, calls /api/stage3/edit-prompt, then hands the rewrite back
 * to the parent via onResult.
 */
function PromptAiEditor({
  prompt,
  category,
  initialInstructions = '',
  onResult,
  disabled = false,
}: {
  prompt: string
  category: string | null
  initialInstructions?: string
  onResult: (newPrompt: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [instructions, setInstructions] = useState(initialInstructions)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function run() {
    const trimmed = instructions.trim()
    if (trimmed.length < 5) {
      setErr('Tell Claude what to change (at least 5 characters)')
      return
    }
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch('/api/stage3/edit-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, instructions: trimmed, category }),
      })
      const data = await res.json()
      if (!data.success || !data.prompt) {
        setErr(data.error ?? `HTTP ${res.status}`)
        return
      }
      onResult(data.prompt as string)
      setInstructions('')
      setOpen(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="cursor-pointer inline-flex items-center gap-[6px] rounded-md px-[10px] py-[6px] text-[12px] font-[620] text-[var(--color-accent-text)] bg-[var(--color-accent-weak)] border border-transparent transition-all hover:brightness-95 whitespace-nowrap disabled:opacity-40"
      >
        <Icon.Spark className="w-3 h-3 text-[var(--color-accent)]" />
        Edit with AI
      </button>
    )
  }
  return (
    <div className="w-full border border-[var(--color-border)] rounded-[9px] bg-[var(--color-accent-weak)] p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-[650] uppercase tracking-[0.1em] text-[var(--color-accent-text)] flex items-center gap-1.5">
          <Icon.Spark className="w-3 h-3 text-[var(--color-accent)]" />
          Tell Claude what to change
        </span>
        <button
          onClick={() => { setOpen(false); setInstructions(''); setErr(null) }}
          disabled={loading}
          className="cursor-pointer text-[var(--color-text-3)] hover:text-[var(--color-text)] transition-colors disabled:opacity-40"
          aria-label="Close"
        >
          <Icon.X className="w-3 h-3" />
        </button>
      </div>
      <textarea
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        placeholder="e.g. warmer lighting, remove the second person, brushed steel more visible"
        rows={2}
        autoFocus
        disabled={loading}
        className="w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-md px-[11px] py-[8px] text-[12px] transition-all focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)] resize-y placeholder:text-[var(--color-text-4)] disabled:opacity-50"
      />
      {err && (
        <div className="text-[11px] text-[var(--color-error)] flex items-start gap-1.5">
          <Icon.Alert className="w-3 h-3 flex-shrink-0 mt-px" />
          <span>{err}</span>
        </div>
      )}
      <button
        onClick={run}
        disabled={loading || instructions.trim().length < 5}
        className="cursor-pointer inline-flex items-center gap-[6px] rounded-md px-[12px] py-[7px] text-[12px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] border border-transparent transition-all hover:brightness-105 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? (<><Icon.Loader className="w-3 h-3" />Rewriting…</>) : (<><Icon.Spark className="w-3 h-3" />Rewrite prompt</>)}
      </button>
    </div>
  )
}

/**
 * Floating Stage 2 copy panel — a small button anchored to the right edge of
 * the viewport that toggles a slide-in panel containing the Stage 2 German
 * copy. The text is plain (not a textarea) so the user can select arbitrary
 * spans and copy them into their Google Doc while images are generating.
 *
 * Hidden entirely if the run has no Stage 2 output yet (description-only
 * runs, or before Stage 2 completes).
 */
function Stage2CopyPanel({ run }: { run: Run | null }) {
  const [open, setOpen] = useState(false)
  // Prefer the edited copy if the operator tweaked it on the run page.
  const copy = run?.stage2_copy_edited ?? run?.stage2_output ?? ''
  if (!copy.trim()) return null

  return (
    <>
      {/* Toggle button — right edge, vertically centered */}
      <button
        onClick={() => setOpen((v) => !v)}
        title="Show Stage 2 German copy — select + copy into your Google Doc"
        aria-label="Toggle Stage 2 copy panel"
        className="fixed right-0 top-1/2 -translate-y-1/2 z-40 cursor-pointer flex items-center gap-1.5 px-2.5 py-3 rounded-l-lg bg-[var(--color-primary)] text-[var(--color-on-primary)] border border-[var(--color-border-strong)] border-r-0 shadow-[0_2px_6px_rgba(20,20,18,.10)] hover:brightness-105 transition-all"
      >
        <span className="font-[var(--font-ibm-plex-mono)] text-[11px] font-[700] [writing-mode:vertical-rl] rotate-180">
          {open ? 'Close copy' : 'Stage 2 copy'}
        </span>
      </button>

      {/* Slide-in panel */}
      <div
        aria-hidden={!open}
        className={[
          'fixed top-0 right-0 h-screen w-[440px] max-w-[90vw] z-50 bg-[var(--color-surface)] border-l border-[var(--color-border-strong)] shadow-[-4px_0_16px_rgba(20,20,18,.08)] transition-transform duration-200 ease-out flex flex-col',
          open ? 'translate-x-0' : 'translate-x-full pointer-events-none',
        ].join(' ')}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
          <div className="min-w-0">
            <p className="font-[var(--font-ibm-plex-mono)] text-[9px] uppercase tracking-widest text-[var(--color-text-3)]">Stage 2</p>
            <h3 className="text-[13px] font-[600] text-[var(--color-text)] truncate">
              German copy {run?.brand_name ? `— ${run.brand_name}` : run?.product_name ? `— ${run.product_name}` : ''}
            </h3>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => navigator.clipboard?.writeText(copy).catch(() => {})}
              title="Copy entire Stage 2 output"
              className="cursor-pointer text-[11px] font-[var(--font-ibm-plex-mono)] px-2 py-1 rounded border border-[var(--color-border-strong)] text-[var(--color-text-2)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors"
            >
              Copy all
            </button>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close panel"
              className="cursor-pointer text-[var(--color-text-3)] hover:text-[var(--color-text)] p-1"
            >
              <Icon.X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 bg-white">
          {/* Rendered in 11pt black Arial so what you see matches what the
              copy looks like in the Google Doc you're pasting into. White
              background is forced so dark mode doesn't invert the look. */}
          <pre
            className="whitespace-pre-wrap leading-relaxed selection:bg-[var(--color-accent-weak)]"
            style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: 11, color: '#000' }}
          >
            {copy}
          </pre>
        </div>
      </div>
    </>
  )
}

function QCGate({
  prompts,
  originalPrompts,
  onPromptsChange,
  productImages,
  onApprove,
}: {
  prompts: ImagePrompt[]
  originalPrompts: ImagePrompt[]
  onPromptsChange: (p: ImagePrompt[]) => void
  productImages: string[]
  onApprove: () => void
}) {
  const inputCls = "w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-lg px-[13px] py-[11px] text-sm font-[inherit] transition-all focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)]"

  // Bulk "Edit all with AI" — applies one instruction across every prompt in
  // parallel. Partial failures are tolerated: prompts whose rewrite fails keep
  // their current text. Progress counter shows X/9 as they land.
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkInstr, setBulkInstr] = useState('')
  const [bulkLoading, setBulkLoading] = useState(false)
  const [bulkProgress, setBulkProgress] = useState({ done: 0, failed: 0 })
  const [bulkErr, setBulkErr] = useState<string | null>(null)

  async function runBulkEdit() {
    const trimmed = bulkInstr.trim()
    if (trimmed.length < 5) {
      setBulkErr('At least 5 characters of instructions')
      return
    }
    setBulkLoading(true)
    setBulkErr(null)
    setBulkProgress({ done: 0, failed: 0 })

    let done = 0
    let failed = 0
    const next: ImagePrompt[] = [...prompts]
    await Promise.all(
      prompts.map(async (p, i) => {
        try {
          const res = await fetch('/api/stage3/edit-prompt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: p.prompt, instructions: trimmed, category: p.category }),
          })
          const data = await res.json()
          if (data.success && typeof data.prompt === 'string' && data.prompt.trim().length > 20) {
            next[i] = { ...p, prompt: data.prompt.trim() }
            done++
          } else {
            failed++
          }
        } catch {
          failed++
        }
        setBulkProgress({ done, failed })
      })
    )
    onPromptsChange(next)
    setBulkLoading(false)
    if (failed === 0) {
      setBulkInstr('')
      setBulkOpen(false)
      setBulkProgress({ done: 0, failed: 0 })
    } else {
      setBulkErr(`${failed} of ${prompts.length} prompts didn't rewrite — kept their previous text.`)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-[var(--color-text)] mb-1">Review Image Prompts</h2>
        <p className="font-[var(--font-ibm-plex-mono)] text-[11px] text-[var(--color-text-3)]">Review and edit the 9 prompts before generating. Changes are saved as learning data.</p>
      </div>

      {/* Bulk AI edit */}
      {!bulkOpen ? (
        <button
          onClick={() => setBulkOpen(true)}
          className="cursor-pointer inline-flex items-center gap-[7px] rounded-lg px-[13px] py-[7px] text-[12.5px] font-[620] text-[var(--color-accent-text)] bg-[var(--color-accent-weak)] border border-transparent transition-all hover:brightness-95 whitespace-nowrap"
        >
          <Icon.Spark className="w-3.5 h-3.5 text-[var(--color-accent)]" />
          Edit all {prompts.length} prompts with AI
        </button>
      ) : (
        <div className="border border-[var(--color-border)] rounded-[11px] bg-[var(--color-accent-weak)] p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-[650] uppercase tracking-[0.1em] text-[var(--color-accent-text)] flex items-center gap-1.5">
              <Icon.Spark className="w-3.5 h-3.5 text-[var(--color-accent)]" />
              Apply one change to ALL prompts
            </span>
            <button
              onClick={() => { setBulkOpen(false); setBulkInstr(''); setBulkErr(null); setBulkProgress({ done: 0, failed: 0 }) }}
              disabled={bulkLoading}
              className="cursor-pointer text-[var(--color-text-3)] hover:text-[var(--color-text)] transition-colors disabled:opacity-40"
              aria-label="Close"
            >
              <Icon.X className="w-3.5 h-3.5" />
            </button>
          </div>
          <textarea
            value={bulkInstr}
            onChange={(e) => setBulkInstr(e.target.value)}
            placeholder="e.g. Make the German overlay text shorter and bolder. Shift all backgrounds to a warmer palette. Add more lifestyle context to product shots."
            rows={3}
            autoFocus
            disabled={bulkLoading}
            className="w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-md px-[13px] py-[11px] text-[13px] transition-all focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)] resize-y placeholder:text-[var(--color-text-4)] disabled:opacity-50"
          />
          {bulkErr && (
            <div className="text-[11px] text-[var(--color-error)] flex items-start gap-1.5">
              <Icon.Alert className="w-3 h-3 flex-shrink-0 mt-px" />
              <span>{bulkErr}</span>
            </div>
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={runBulkEdit}
              disabled={bulkLoading || bulkInstr.trim().length < 5}
              className="cursor-pointer inline-flex items-center gap-[7px] rounded-lg px-[15px] py-[9px] text-[13.5px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] border border-transparent transition-all hover:brightness-105 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {bulkLoading
                ? (<><Icon.Loader className="w-3.5 h-3.5" />Rewriting {bulkProgress.done + bulkProgress.failed}/{prompts.length}…</>)
                : (<><Icon.Spark className="w-3.5 h-3.5" />Rewrite all {prompts.length}</>)}
            </button>
            <p className="font-[var(--font-ibm-plex-mono)] text-[10px] text-[var(--color-text-3)]">
              Runs in parallel · per-prompt facts (product, refs, German text) are preserved
            </p>
          </div>
        </div>
      )}
      <div className="space-y-4">
        {prompts.map((prompt, i) => {
          const cat = IMAGE_CATEGORIES.find(c => c.id === prompt.category)
          const isEdited = prompt.prompt !== originalPrompts[i]?.prompt
          const refImg =
            (prompt.source_image_references && prompt.source_image_references[0]) ||
            (prompt.reference_image_index != null ? productImages[prompt.reference_image_index] : productImages[0])
          const germanText = prompt.german_text || prompt.german_text_used || ''

          return (
            <div key={i} className="border border-[var(--color-border)] rounded-[11px] bg-[var(--color-surface)] shadow-[0_1px_2px_rgba(20,20,18,.05)] p-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13px] font-[600] text-[var(--color-text)]">{cat?.label ?? prompt.category}</span>
                <span className="font-[var(--font-ibm-plex-mono)] text-[9px] bg-[var(--color-surface-2)] text-[var(--color-text-2)] border border-[var(--color-border)] px-2 py-0.5 rounded">{prompt.model}</span>
                <span className="font-[var(--font-ibm-plex-mono)] text-[9px] bg-[var(--color-surface-2)] text-[var(--color-text-3)] border border-[var(--color-border)] px-2 py-0.5 rounded">{prompt.aspect_ratio}</span>
                {refImg && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={refImg}
                    alt="ref"
                    className="w-6 h-6 object-cover rounded border border-[var(--color-border)]"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                )}
                {cat && (
                  <span className="font-[var(--font-ibm-plex-mono)] text-[9px] text-[var(--color-text-3)]">{cat.description}</span>
                )}
                {isEdited && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-[620] px-2.5 py-1 rounded-full bg-[var(--color-amber-bg)] text-[var(--color-amber)] whitespace-nowrap">
                    Edited
                  </span>
                )}
              </div>
              <textarea
                value={prompt.prompt}
                rows={10}
                onChange={e => {
                  const updated = [...prompts]
                  updated[i] = { ...prompt, prompt: e.target.value }
                  onPromptsChange(updated)
                }}
                className={`${inputCls} font-[var(--font-ibm-plex-mono)] text-[11px] resize-y leading-relaxed`}
              />
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="font-[var(--font-ibm-plex-mono)] text-[9px] text-[var(--color-text-4)]">{prompt.prompt.length} chars</span>
                <div className="flex items-center gap-2 ml-auto">
                  <PromptAiEditor
                    prompt={prompt.prompt}
                    category={prompt.category}
                    onResult={(newPrompt) => {
                      const updated = [...prompts]
                      updated[i] = { ...prompt, prompt: newPrompt }
                      onPromptsChange(updated)
                    }}
                  />
                  {isEdited && (
                    <button
                      onClick={() => {
                        const updated = [...prompts]
                        updated[i] = { ...prompt, prompt: originalPrompts[i].prompt }
                        onPromptsChange(updated)
                      }}
                      className="cursor-pointer inline-flex items-center gap-[7px] rounded-lg px-3 py-[7px] text-[12.5px] font-[620] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] transition-all hover:border-[var(--color-text-3)] hover:bg-[var(--color-surface-2)] whitespace-nowrap"
                    >
                      Reset to Original
                    </button>
                  )}
                </div>
              </div>
              {germanText && (
                <div className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg p-3">
                  <p className="font-[var(--font-ibm-plex-mono)] text-[9px] text-[var(--color-text-3)] uppercase tracking-widest mb-1">German text used</p>
                  <p className="font-[var(--font-ibm-plex-mono)] text-[10px] text-[var(--color-text-2)]">{germanText}</p>
                </div>
              )}
              {prompt.source_image_references && prompt.source_image_references.length > 0 && (
                <div className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg p-3">
                  <p className="font-[var(--font-ibm-plex-mono)] text-[9px] text-[var(--color-text-3)] uppercase tracking-widest mb-2">Source images referenced</p>
                  <div className="flex flex-wrap gap-2">
                    {prompt.source_image_references.map((url, j) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={j} src={url} alt={`ref ${j + 1}`} className="w-10 h-10 object-cover rounded border border-[var(--color-border)]" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <button
        onClick={onApprove}
        className="cursor-pointer inline-flex items-center gap-[7px] rounded-lg px-[15px] py-[9px] text-[13.5px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] border border-transparent transition-all hover:brightness-105 whitespace-nowrap"
      >
        Approve All &amp; Generate Images →
      </button>
    </div>
  )
}

function GeneratingPhase({
  images,
  prompts,
  generatingIndex,
}: {
  images: ImageSlot[]
  prompts: ImagePrompt[]
  generatingIndex: number | null
}) {
  const cat = generatingIndex != null ? IMAGE_CATEGORIES.find(c => c.id === prompts[generatingIndex]?.category) : null
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-[var(--color-text)] mb-1">Generating Images</h2>
        {generatingIndex != null ? (
          <p className="font-[var(--font-ibm-plex-mono)] text-[11px] text-[var(--color-accent)] animate-pulse">
            Generating image {generatingIndex + 1} of {prompts.length} — {cat?.label ?? prompts[generatingIndex]?.category}
          </p>
        ) : (
          <p className="font-[var(--font-ibm-plex-mono)] text-[11px] text-[var(--color-text-3)]">Starting generation…</p>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {prompts.map((prompt, i) => (
          <ImageCell
            key={i}
            image={images[i] ?? { url: null, status: 'pending' }}
            prompt={prompt}
            auditResult={null}
            onRegenerate={() => {}}
            regenCount={0}
          />
        ))}
      </div>
    </div>
  )
}

function AuditingPhase({
  images,
  prompts,
  auditResults,
  auditingIndex,
}: {
  images: ImageSlot[]
  prompts: ImagePrompt[]
  auditResults: (AuditResult | null)[]
  auditingIndex: number | null
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-[var(--color-text)] mb-1">Auditing Images</h2>
        {auditingIndex != null ? (
          <p className="font-[var(--font-ibm-plex-mono)] text-[11px] text-[var(--color-accent)] animate-pulse">
            Auditing image {auditingIndex + 1} of {prompts.length}…
          </p>
        ) : (
          <p className="font-[var(--font-ibm-plex-mono)] text-[11px] text-[var(--color-text-3)]">Completing audit…</p>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {prompts.map((prompt, i) => {
          const result = auditResults[i]
          const isAuditing = auditingIndex === i
          return (
            <div key={i} className="relative">
              <ImageCell
                image={images[i] ?? { url: null, status: 'pending' }}
                prompt={prompt}
                auditResult={result}
                onRegenerate={() => {}}
                regenCount={0}
              />
              {isAuditing && !result && (
                <div className="absolute top-2 right-2">
                  <div className="w-2 h-2 rounded-full bg-[var(--color-accent)] animate-pulse" />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CompletePhase({
  images,
  prompts,
  auditResults,
  regenCounts,
  onRegenerate,
  onRerunAll,
  onRegenerateFailed,
  onOverrideVerdict,
  onSaveNote,
  run,
}: {
  images: ImageSlot[]
  prompts: ImagePrompt[]
  auditResults: (AuditResult | null)[]
  regenCounts: number[]
  onRegenerate: (i: number) => void
  onRerunAll: () => void
  onRegenerateFailed: () => void
  onOverrideVerdict: (i: number) => void
  onSaveNote: (i: number, note: string) => void
  run: Run | null
}) {
  // Count slots that need a redo: nothing generated, OR effective verdict
  // (after override) is fail OR minor. We include minor so a single click
  // catches every non-clean-pass image; the auditor only marks fail/minor
  // when there's an actual issue worth flagging.
  const failedCount = images.reduce((n, img, i) => {
    const generationFailed = img.status === 'error' || img.status === 'failed'
    const auditFlagged = effectiveVerdict(auditResults[i]) === 'fail'
    return (generationFailed || auditFlagged) && (regenCounts[i] ?? 0) < 3 ? n + 1 : n
  }, 0)
  const passed = auditResults.filter(r => effectiveVerdict(r) === 'pass').length
  const failed = auditResults.filter(r => effectiveVerdict(r) === 'fail').length

  const [downloading, setDownloading] = useState(false)
  // Download every generated image as separate files (not a zip). Files land
  // in the browser's download folder, named like "01_hero_studio.png" so
  // they sort in the right order. A 150ms gap between each download keeps
  // Chrome happy — without it the browser blocks "too many" auto-downloads.
  //
  // First download triggers Chrome's "Allow multiple downloads" prompt
  // (the same one the user already saw for any multi-file site). Once
  // allowed it doesn't ask again.
  async function downloadAll() {
    if (downloading) return
    const items = images
      .map((img, i) => ({ img, i, prompt: prompts[i] }))
      .filter((x) => x.img.url && x.img.status !== 'error' && x.img.status !== 'failed')
    if (items.length === 0) return
    setDownloading(true)
    try {
      const pad = (n: number) => String(n).padStart(2, '0')
      for (const { img, i, prompt } of items) {
        const url = img.url as string
        const ext = (url.split(/[?#]/)[0].split('.').pop() || 'png').slice(0, 4)
        const cat = (prompt?.category || 'image').replace(/[^a-z0-9_-]+/gi, '_')
        const filename = `${pad(i + 1)}_${cat}.${ext}`
        await downloadImage(url, filename)
        // Throttle so Chrome doesn't block the burst.
        await new Promise((r) => setTimeout(r, 150))
      }
    } finally {
      setDownloading(false)
    }
  }
  const downloadableCount = images.filter((img) => img.url && img.status !== 'error' && img.status !== 'failed').length

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-[var(--color-text)] mb-2">Image Generation Complete</h2>
        <div className="flex items-center gap-4 text-[13px]">
          <span className="inline-flex items-center gap-1.5 text-xs font-[620] px-2.5 py-1 rounded-full bg-[var(--color-green-bg)] text-[var(--color-green)] whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />{passed} passed
          </span>
          {failed > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs font-[620] px-2.5 py-1 rounded-full bg-[var(--color-red-bg)] text-[var(--color-red)] whitespace-nowrap">
              <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />{failed} failed
            </span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {prompts.map((prompt, i) => (
          <ImageCell
            key={i}
            image={images[i] ?? { url: null, status: 'pending' }}
            prompt={prompt}
            auditResult={auditResults[i]}
            onRegenerate={() => onRegenerate(i)}
            onOverrideVerdict={() => onOverrideVerdict(i)}
            onSaveNote={(note) => onSaveNote(i, note)}
            regenCount={regenCounts[i] ?? 0}
          />
        ))}
      </div>
      {run?.id && (
        <div className="flex items-start justify-between gap-3 pt-2 flex-wrap">
          <FeedbackAppliedChip stage={3} />
          <FeedbackButtons
            runId={run.id}
            stage="stage3"
            initialVote={run.feedback_stage3 ?? null}
            initialNote={run.feedback_stage3_note ?? null}
          />
        </div>
      )}
      <div className="flex items-center gap-3 pt-2 flex-wrap">
        {downloadableCount > 0 && (
          <button
            onClick={downloadAll}
            disabled={downloading}
            title="Saves each image as a separate file in your downloads folder. Browser will ask once to allow multiple downloads."
            className="cursor-pointer inline-flex items-center gap-[7px] rounded-lg px-[15px] py-[9px] text-[13.5px] font-[620] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] transition-all hover:border-[var(--color-text-3)] hover:bg-[var(--color-surface-2)] whitespace-nowrap disabled:opacity-60"
          >
            {downloading ? 'Downloading…' : `↓ Download all (${downloadableCount})`}
          </button>
        )}
        {failedCount > 0 && (
          <button
            onClick={onRegenerateFailed}
            className="cursor-pointer inline-flex items-center gap-[7px] rounded-lg px-[15px] py-[9px] text-[13.5px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] border border-transparent transition-all hover:brightness-105 whitespace-nowrap"
            title="Re-runs every slot that errored or didn't get a clean pass (fail + minor). Sequential to stay under Higgsfield rate limits."
          >
            Regenerate flagged ({failedCount})
          </button>
        )}
        <button
          onClick={onRerunAll}
          title="Re-runs prompt generation (picking up your 👍/👎 + notes), then generates a fresh image batch. Discards the current prompts."
          className={[
            "cursor-pointer inline-flex items-center gap-[7px] rounded-lg px-[15px] py-[9px] text-[13.5px] font-[620] border border-transparent transition-all whitespace-nowrap",
            failedCount > 0
              ? "bg-[var(--color-surface)] text-[var(--color-text)] border-[var(--color-border-strong)] hover:border-[var(--color-text-3)] hover:bg-[var(--color-surface-2)]"
              : "bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:brightness-105",
          ].join(" ")}
        >
          Re-prompt &amp; regenerate
        </button>
        {run?.id && (
          <Link
            href={`/runs/${run.id}#stage-2-section`}
            className="inline-flex items-center gap-[7px] rounded-lg px-[15px] py-[9px] text-[13.5px] font-[620] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] transition-all hover:border-[var(--color-text-3)] hover:bg-[var(--color-surface-2)] whitespace-nowrap"
          >
            ← Back to Stage 2
          </Link>
        )}
        {run?.id && (
          <Link
            href={`/history/${run.id}`}
            className="inline-flex items-center gap-[7px] rounded-lg px-[15px] py-[9px] text-[13.5px] font-[620] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] transition-all hover:border-[var(--color-text-3)] hover:bg-[var(--color-surface-2)] whitespace-nowrap"
          >
            View Run History →
          </Link>
        )}
      </div>
    </div>
  )
}

function RegenModal({
  index,
  prompt,
  auditResult,
  category,
  regenCount,
  loading,
  onChange,
  onConfirm,
  onClose,
}: {
  index: number
  prompt: string
  auditResult: AuditResult | null
  category: string | null
  regenCount: number
  loading: boolean
  onChange: (p: string) => void
  onConfirm: () => void
  onClose: () => void
}) {
  // Prefer the audit's category (when present) for the title; fall back to the
  // prompt's own category so we always show something useful.
  const auditCategory = (auditResult as AuditResult & { category?: string } | null)?.category
  const cat = IMAGE_CATEGORIES.find(c => c.id === (auditCategory ?? category ?? ''))

  // Pre-populate the AI-edit panel with (a) the operator's saved note for
  // this image, if any, and (b) the auditor's issues. One click on Rewrite
  // applies both. Operator can edit before clicking.
  const presetIssues = useMemo(() => {
    const issues = auditResult?.issues?.filter(Boolean) ?? []
    const note = (auditResult?.user_note ?? '').trim()
    const skipIssues = issues.length === 0 || effectiveVerdict(auditResult) === 'pass'
    if (!note && skipIssues) return ''
    const parts: string[] = []
    if (note) parts.push('My note: ' + note)
    if (!skipIssues) parts.push('Fix the audit issues:\n- ' + issues.join('\n- '))
    return parts.join('\n\n')
  }, [auditResult])

  const [aiOpen, setAiOpen] = useState(presetIssues.length > 0)
  const [aiInstructions, setAiInstructions] = useState(presetIssues)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  async function runAiEdit() {
    const trimmed = aiInstructions.trim()
    if (trimmed.length < 5) {
      setAiError('Tell Claude what to change (at least 5 characters)')
      return
    }
    setAiLoading(true)
    setAiError(null)
    try {
      const res = await fetch('/api/stage3/edit-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, instructions: trimmed, category: category ?? null }),
      })
      const data = await res.json()
      if (!data.success || !data.prompt) {
        setAiError(data.error ?? `HTTP ${res.status}`)
        return
      }
      onChange(data.prompt as string)
      setAiInstructions('')
      setAiOpen(false)
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setAiLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative border border-[var(--color-border)] rounded-[11px] bg-[var(--color-surface)] shadow-[0_2px_8px_rgba(20,20,18,.06)] p-6 max-w-2xl w-full space-y-4">
        <div>
          <p className="font-[var(--font-ibm-plex-mono)] text-[10px] text-[var(--color-text-3)] uppercase tracking-widest">Image {index + 1}{cat ? ` — ${cat.label}` : ''}</p>
          <p className="text-[var(--color-text)] text-sm font-[600] mt-0.5">Attempt {regenCount + 1} of 3</p>
        </div>
        {auditResult && auditResult.issues.length > 0 && (
          <div className="space-y-1">
            <p className="font-[var(--font-ibm-plex-mono)] text-[9px] text-[var(--color-text-3)] uppercase tracking-widest">Issues</p>
            {auditResult.issues.map((issue, i) => (
              <p key={i} className="text-[11px] text-[var(--color-error)] font-[var(--font-ibm-plex-mono)]">• {issue}</p>
            ))}
          </div>
        )}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="font-[var(--font-ibm-plex-mono)] text-[10px] text-[var(--color-text-3)] uppercase tracking-widest">Edit Prompt</label>
            {!aiOpen && (
              <button
                onClick={() => setAiOpen(true)}
                disabled={loading}
                className="cursor-pointer inline-flex items-center gap-[6px] rounded-md px-2 py-1 text-[11px] font-[620] text-[var(--color-accent-text)] bg-[var(--color-accent-weak)] border border-transparent transition-all hover:brightness-95 whitespace-nowrap disabled:opacity-40"
              >
                <Icon.Spark className="w-3 h-3 text-[var(--color-accent)]" />
                Edit with AI
              </button>
            )}
          </div>
          {aiOpen && (
            <div className="border border-[var(--color-border)] rounded-[9px] bg-[var(--color-accent-weak)] p-3 mb-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-[650] uppercase tracking-[0.1em] text-[var(--color-accent-text)] flex items-center gap-1.5">
                  <Icon.Spark className="w-3 h-3 text-[var(--color-accent)]" />
                  Tell Claude what to change
                </span>
                <button
                  onClick={() => { setAiOpen(false); setAiInstructions(''); setAiError(null) }}
                  disabled={aiLoading}
                  className="cursor-pointer text-[var(--color-text-3)] hover:text-[var(--color-text)] transition-colors disabled:opacity-40"
                  aria-label="Close AI edit"
                >
                  <Icon.X className="w-3 h-3" />
                </button>
              </div>
              <textarea
                value={aiInstructions}
                onChange={(e) => setAiInstructions(e.target.value)}
                placeholder="e.g. Warmer lighting, brushed-steel finish more visible, remove the second hand"
                rows={2}
                autoFocus
                disabled={aiLoading}
                className="w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-md px-[11px] py-[8px] text-[12px] transition-all focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)] resize-y placeholder:text-[var(--color-text-4)] disabled:opacity-50"
              />
              {aiError && (
                <div className="text-[11px] text-[var(--color-error)] flex items-start gap-1.5">
                  <Icon.Alert className="w-3 h-3 flex-shrink-0 mt-px" />
                  <span>{aiError}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={runAiEdit}
                  disabled={aiLoading || aiInstructions.trim().length < 5}
                  className="cursor-pointer inline-flex items-center gap-[6px] rounded-md px-[12px] py-[7px] text-[12px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] border border-transparent transition-all hover:brightness-105 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {aiLoading ? (
                    <><Icon.Loader className="w-3 h-3" />Rewriting…</>
                  ) : (
                    <><Icon.Spark className="w-3 h-3" />Rewrite prompt</>
                  )}
                </button>
                <p className="font-[var(--font-ibm-plex-mono)] text-[10px] text-[var(--color-text-3)]">
                  Replaces the textarea below
                </p>
              </div>
            </div>
          )}
          <textarea
            value={prompt}
            rows={8}
            onChange={e => onChange(e.target.value)}
            className="w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-lg px-[13px] py-[11px] text-sm font-[var(--font-ibm-plex-mono)] text-[11px] transition-all focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)] resize-y leading-relaxed"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onConfirm}
            disabled={loading || aiLoading}
            className="cursor-pointer inline-flex items-center gap-[7px] rounded-lg px-[15px] py-[9px] text-[13.5px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] border border-transparent transition-all hover:brightness-105 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? 'Regenerating…' : 'Regenerate Image'}
          </button>
          <button
            onClick={onClose}
            disabled={loading || aiLoading}
            className="cursor-pointer inline-flex items-center gap-[7px] rounded-lg px-[15px] py-[9px] text-[13.5px] font-[620] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] transition-all hover:border-[var(--color-text-3)] hover:bg-[var(--color-surface-2)] whitespace-nowrap disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page Component ──────────────────────────────────────────────────────

function Stage3Page() {
  const searchParams = useSearchParams()
  const [run, setRun] = useState<Run | null>(null)
  const [phase, setPhase] = useState<Stage3Phase>('loading')
  const [error, setError] = useState<string | null>(null)

  // Phase A outputs
  const [prompts, setPrompts] = useState<ImagePrompt[]>([])
  const [originalPrompts, setOriginalPrompts] = useState<ImagePrompt[]>([])

  // Phase C outputs
  const [images, setImages] = useState<ImageSlot[]>([])
  const [generatingIndex, setGeneratingIndex] = useState<number | null>(null)

  // Phase D outputs
  const [auditResults, setAuditResults] = useState<(AuditResult | null)[]>([])
  const [auditingIndex, setAuditingIndex] = useState<number | null>(null)

  // Phase E — regeneration
  const [regenModal, setRegenModal] = useState<{ index: number; editedPrompt: string } | null>(null)
  const [regenCounts, setRegenCounts] = useState<number[]>([])
  const [regenLoading, setRegenLoading] = useState(false)
  // When the operator hits "Regenerate all" from the complete screen, we set
  // this ref so Phase A's effect knows to skip the QC gate and chain directly
  // into image generation with the fresh prompts. Ref (not state) so the
  // effect reads the latest value without re-running on flip.
  const autoAdvanceAfterPromptsRef = useRef(false)
  // Optional operator note from the "Re-prompt & regenerate" dialog. Sent
  // alongside the /api/stage3/prompts POST so the next 9 prompts respect it.
  const reprmptNoteRef = useRef<string>('')

  const scraperImages = useMemo(() => {
    if (!run?.scraper_data) return []
    try {
      const d = JSON.parse(run.scraper_data)
      return (d.images ?? []) as string[]
    } catch { return [] }
  }, [run])

  // On mount: fetch run data
  useEffect(() => {
    const runId = searchParams.get('runId')
    if (!runId) { setError('No run ID provided'); setPhase('error'); return }
    // ?fresh=1 is an escape hatch that forces a clean Stage 3 run, ignoring
    // any saved prompts/images. Default behavior: ALWAYS restore saved state
    // so refreshing the page never throws work away. (The legacy ?skipPrompts=1
    // is kept as a synonym for the default — no-op since restore is default now.)
    const forceFresh = searchParams.get('fresh') === '1'
    fetch(`/api/runs/${runId}`)
      .then(r => r.json())
      .then(data => {
        if (!data.run) throw new Error('Run not found')
        setRun(data.run)

        // If the run already has saved prompts (and optionally images), restore
        // them. Images → E_complete (per-image regenerate/rate flow). Prompts
        // only → B_qc_gate (regenerate-all flow). No saved prompts → fall
        // through to A_generating below.
        if (!forceFresh && data.run.image_prompts) {
          try {
            const saved = JSON.parse(data.run.image_prompts) as ImagePrompt[]
            if (Array.isArray(saved) && saved.length === 9) {
              setPrompts(saved)
              setOriginalPrompts(saved)

              let imageSlots: ImageSlot[] = saved.map(() => ({ url: null, status: 'pending' as const }))
              let audits: (AuditResult | null)[] = saved.map(() => null)
              let haveImages = false
              if (data.run.generated_images) {
                try {
                  const savedImgs = JSON.parse(data.run.generated_images) as Array<{
                    image_url?: string; status?: string
                  }>
                  if (Array.isArray(savedImgs)) {
                    imageSlots = saved.map((_, i) => {
                      const img = savedImgs[i]
                      if (img?.image_url && img.status !== 'failed') {
                        return { url: img.image_url, status: 'done' as const }
                      }
                      return { url: null, status: 'pending' as const }
                    })
                    haveImages = imageSlots.some(s => s.status === 'done')
                  }
                } catch { /* fall back to empty slots */ }
              }
              if (data.run.audit_results) {
                try {
                  const savedAudits = JSON.parse(data.run.audit_results) as (AuditResult | null)[]
                  if (Array.isArray(savedAudits)) audits = savedAudits
                } catch { /* keep nulls */ }
              }

              setImages(imageSlots)
              setAuditResults(audits)
              setRegenCounts(saved.map(() => 0))
              setPhase(haveImages ? 'E_complete' : 'B_qc_gate')
              return
            }
          } catch { /* fall through to regenerating prompts */ }
        }

        setPhase('A_generating')
      })
      .catch(err => { setError(err instanceof Error ? err.message : String(err)); setPhase('error') })
  }, [searchParams])

  // Phase A: Generate prompts
  useEffect(() => {
    if (phase !== 'A_generating' || !run) return

    const scraperData = run.scraper_data ? JSON.parse(run.scraper_data) : null
    const productImages: string[] = scraperData?.images ?? []
    let uploadedImages: string[] = []
    try {
      uploadedImages = run.uploaded_source_images ? JSON.parse(run.uploaded_source_images) : []
    } catch { uploadedImages = [] }
    const onePager = run.stage1_one_pager_edited ?? run.stage1_one_pager ?? ''

    fetch('/api/stage3/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        research: run.step_research_revised ?? run.step_research ?? '',
        avatar: run.step_avatar_revised ?? run.step_avatar ?? '',
        offer_brief: run.step_offer_brief_revised ?? run.step_offer_brief ?? '',
        necessary_beliefs: run.step_necessary_beliefs_revised ?? run.step_necessary_beliefs ?? '',
        copy: run.stage2_output ?? '',
        one_pager: onePager,
        product_images: productImages,
        uploaded_images: uploadedImages,
        operator_note: reprmptNoteRef.current || undefined,
      }),
    })
      .then(r => r.json())
      .then(data => {
        if (!data.success) throw new Error(data.error ?? 'Prompt generation failed')
        setPrompts(data.prompts)
        setOriginalPrompts(data.prompts)
        setImages(data.prompts.map(() => ({ url: null, status: 'pending' as const })))
        setAuditResults(data.prompts.map(() => null))
        setRegenCounts(data.prompts.map(() => 0))
        if (autoAdvanceAfterPromptsRef.current) {
          // "Regenerate all images" path: skip the QC gate and chain straight
          // into image generation with the fresh prompts. Pass them explicitly
          // because the closure inside generateImages still holds the stale
          // `prompts` state.
          autoAdvanceAfterPromptsRef.current = false
          generateImages(data.prompts as ImagePrompt[])
        } else {
          setPhase('B_qc_gate')
        }
      })
      .catch(err => { setError(err instanceof Error ? err.message : String(err)); setPhase('error') })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, run])

  // Phase C: Generate images sequentially.
  //
  // Accepts an optional `promptsArg` override so callers that JUST set fresh
  // prompts can pass them in without waiting for React to flush — the
  // useCallback closure would otherwise hold the stale `prompts` value.
  const generateImages = useCallback(async (promptsArg?: ImagePrompt[]) => {
    if (!run) return
    // Guard against React's synthetic event sneaking in when this is wired
    // directly as an onClick handler — only accept an actual array override.
    const ps = Array.isArray(promptsArg) ? promptsArg : prompts
    if (!ps.length) return
    setPhase('C_generating')
    const scraperData = run.scraper_data ? JSON.parse(run.scraper_data) : null
    const productImages: string[] = scraperData?.images ?? []
    let uploadedSources: string[] = []
    try {
      if (run.uploaded_source_images) {
        const parsed = JSON.parse(run.uploaded_source_images)
        if (Array.isArray(parsed)) uploadedSources = parsed.filter((u): u is string => typeof u === 'string')
      }
    } catch { /* missing or malformed JSON — fall back to no uploaded refs */ }

    const editsToSave = ps.map((p, i) => ({
      category: p.category,
      original: originalPrompts[i]?.prompt ?? p.prompt,
      edited: p.prompt,
      approved: true,
      timestamp: new Date().toISOString(),
    }))
    await fetch('/api/stage3/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt_edits: editsToSave }),
    }).catch(() => {})

    const updatedImages: ImageSlot[] = ps.map(() => ({ url: null, status: 'pending' as const }))

    for (let i = 0; i < ps.length; i++) {
      const p = ps[i]
      setGeneratingIndex(i)
      updatedImages[i] = { url: null, status: 'generating' }
      setImages([...updatedImages])

      const refImages = buildReferenceImages(
        uploadedSources,
        p.source_image_references ?? [],
        productImages,
        p.reference_image_index,
      )

      try {
        const res = await fetch('/api/stage3/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: p.prompt,
            model: p.model,
            reference_images: refImages,
            aspect_ratio: p.aspect_ratio,
          }),
        })
        const data = await res.json()
        if (!data.success) throw new Error(data.error ?? 'Generation failed')
        updatedImages[i] = { url: data.image_url, status: 'done' }
        setImages([...updatedImages])
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        updatedImages[i] = { url: null, status: 'error', error: msg }
        setImages([...updatedImages])
      }
    }

    setGeneratingIndex(null)
    await auditImagesInternal(updatedImages, ps)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, prompts, originalPrompts])

  // Phase D: Audit images
  const auditImagesInternal = useCallback(async (finalImages: ImageSlot[], finalPrompts: ImagePrompt[]) => {
    if (!run) return
    setPhase('D_auditing')
    const productDesc = run.product_description ?? run.product_name ?? ''

    const newResults: (AuditResult | null)[] = finalPrompts.map(() => null)

    for (let i = 0; i < finalImages.length; i++) {
      const img = finalImages[i]
      if (!img.url || img.status !== 'done') {
        newResults[i] = { image_index: i, verdict: 'fail', issues: ['Image generation failed'], requires_regeneration: true }
        setAuditResults([...newResults])
        continue
      }

      setAuditingIndex(i)
      const p = finalPrompts[i]

      try {
        const res = await fetch('/api/stage3/audit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_url: img.url,
            category: p.category,
            prompt_used: p.prompt,
            product_description: productDesc,
            german_text_used: p.german_text || p.german_text_used || null,
          }),
        })
        const data = await res.json()
        if (!data.success) throw new Error(data.error)
        newResults[i] = { image_index: i, ...data.result }
        setAuditResults([...newResults])

        await fetch('/api/stage3/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audit_results: [{ category: p.category, verdict: data.result.verdict, issues: data.result.issues, timestamp: new Date().toISOString() }],
          }),
        }).catch(() => {})
      } catch {
        newResults[i] = { image_index: i, verdict: 'fail', issues: ['Audit error'], requires_regeneration: true }
        setAuditResults([...newResults])
      }
    }

    setAuditingIndex(null)

    if (run.id) {
      const editCount = finalPrompts.filter((p, i) => p.prompt !== originalPrompts[i]?.prompt).length
      await fetch(`/api/runs/${run.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_prompts: JSON.stringify(finalPrompts),
          generated_images: JSON.stringify(finalImages.map((img, i) => ({
            prompt_index: i,
            category: finalPrompts[i].category,
            image_url: img.url ?? '',
            status: img.status === 'done' ? 'complete' : 'failed',
          }))),
          audit_results: JSON.stringify(newResults),
          prompt_edits_made: editCount,
        }),
      }).catch(() => {})
    }

    setPhase('E_complete')
  }, [run, originalPrompts])

  // Phase E: Regenerate single image
  const regenerateImage = useCallback(async (index: number, newPrompt: string) => {
    if (!run || regenCounts[index] >= 3) return
    setRegenLoading(true)

    const scraperData = run.scraper_data ? JSON.parse(run.scraper_data) : null
    const productImages: string[] = scraperData?.images ?? []
    let uploadedSources: string[] = []
    try {
      if (run.uploaded_source_images) {
        const parsed = JSON.parse(run.uploaded_source_images)
        if (Array.isArray(parsed)) uploadedSources = parsed.filter((u): u is string => typeof u === 'string')
      }
    } catch { /* fall back to no uploaded refs */ }
    const p = prompts[index]
    const refImages = buildReferenceImages(
      uploadedSources,
      p.source_image_references ?? [],
      productImages,
      p.reference_image_index,
    )

    const originalIssue = auditResults[index]?.issues?.join(', ') ?? ''

    const updatedPrompts = [...prompts]
    updatedPrompts[index] = { ...p, prompt: newPrompt }
    setPrompts(updatedPrompts)

    setImages(prev => prev.map((img, i) => i === index ? { url: null, status: 'generating' as const } : img))

    try {
      const genRes = await fetch('/api/stage3/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: newPrompt, model: p.model, reference_images: refImages, aspect_ratio: p.aspect_ratio }),
      })
      const genData = await genRes.json()
      if (!genData.success) throw new Error(genData.error)

      setImages(prev => prev.map((img, i) => i === index ? { url: genData.image_url, status: 'done' as const } : img))

      const productDesc = run.product_description ?? run.product_name ?? ''
      const auditRes = await fetch('/api/stage3/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: genData.image_url, category: p.category, prompt_used: newPrompt, product_description: productDesc, german_text_used: p.german_text || p.german_text_used || null }),
      })
      const auditData = await auditRes.json()

      setAuditResults(prev => prev.map((r, i) => i === index ? (auditData.success ? { image_index: index, ...auditData.result } : r) : r))
      setRegenCounts(prev => prev.map((c, i) => i === index ? c + 1 : c))

      await fetch('/api/stage3/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          regeneration_fixes: [{
            category: p.category,
            original_issue: originalIssue,
            fix_applied: `Changed prompt to: "${newPrompt.slice(0, 100)}..."`,
            success: auditData.success && auditData.result?.verdict !== 'fail',
            timestamp: new Date().toISOString(),
          }],
        }),
      }).catch(() => {})

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setImages(prev => prev.map((img, i) => i === index ? { url: null, status: 'error' as const, error: msg } : img))
    }

    setRegenLoading(false)
    setRegenModal(null)
  }, [run, prompts, regenCounts, auditResults])

  // Phase E: Regenerate every image that's either failed to generate at all
  // (status === 'error' / 'failed') or generated but failed the audit
  // (verdict === 'fail'). Runs sequentially so we don't blow the Higgsfield
  // rate limit.
  //
  // Before retrying, we ask Claude to rewrite the prompt using the audit's
  // own issues as instructions — so we don't waste a generation re-running
  // the same prompt that already failed. If the rewrite fails (network etc.),
  // we fall back to the existing prompt so the user still gets a retry.
  const regenerateFailedImages = useCallback(async () => {
    if (!run) return
    const indices: number[] = []
    images.forEach((img, i) => {
      const generationFailed = img.status === 'error' || img.status === 'failed'
      const auditFlagged = effectiveVerdict(auditResults[i]) === 'fail'
      const underCap = (regenCounts[i] ?? 0) < 3
      if ((generationFailed || auditFlagged) && underCap) indices.push(i)
    })
    if (indices.length === 0) return
    for (const i of indices) {
      const audit = auditResults[i]
      const issues = audit?.issues?.filter(Boolean) ?? []
      const userNote = (audit?.user_note ?? '').trim()
      let nextPrompt = prompts[i].prompt
      // Rewrite when we have either auditor issues OR a user note. Combine
      // both so the user's note takes priority but the auditor's findings
      // still inform the rewrite.
      if (issues.length > 0 || userNote) {
        const parts: string[] = []
        if (userNote) {
          parts.push('Operator note (highest priority — follow this):\n' + userNote)
        }
        if (issues.length > 0) {
          parts.push(
            'Auditor flagged these problems with the previous render — avoid them while keeping the product itself unchanged:\n- ' +
              issues.join('\n- '),
          )
        }
        try {
          const res = await fetch('/api/stage3/edit-prompt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: nextPrompt,
              category: prompts[i].category,
              instructions: parts.join('\n\n'),
            }),
          })
          const data = await res.json()
          if (data.success && typeof data.prompt === 'string' && data.prompt.trim().length > 20) {
            nextPrompt = data.prompt.trim()
            // Show the user the new prompt in state right away.
            setPrompts((prev) => prev.map((p, j) => (j === i ? { ...p, prompt: nextPrompt } : p)))
          }
        } catch {
          // Fall through: regen with the existing prompt rather than failing the loop.
        }
      }
      await regenerateImage(i, nextPrompt)
    }
  }, [run, images, auditResults, regenCounts, prompts, regenerateImage])

  // "Regenerate all" from the complete screen — re-runs Stage 3 prompt
  // generation (which picks up the operator's accumulated 👍/👎 notes and the
  // stage3 learning store), then auto-chains into a fresh image batch.
  //
  // `note` is the optional operator instruction from the "Re-prompt &
  // regenerate" dialog. It's stashed in a ref so Phase A's effect can pick
  // it up when it fires (state would race the setPhase below).
  const executeRegenerateAll = useCallback((note: string) => {
    if (!run) return
    reprmptNoteRef.current = note.trim()
    autoAdvanceAfterPromptsRef.current = true
    setPhase('A_generating')
  }, [run])
  // Modal toggle: clicking "Re-prompt & regenerate" opens a small note input
  // first, then commits via executeRegenerateAll on submit.
  const [reprmptModalOpen, setReprmptModalOpen] = useState(false)
  const [reprmptDraft, setReprmptDraft] = useState('')
  const openReprmptModal = useCallback(() => {
    setReprmptDraft('')
    setReprmptModalOpen(true)
  }, [])

  // Persist the operator's per-image note onto auditResult.user_note so the
  // next regen of this image picks it up as additional rewrite instructions.
  // PATCHes the run so the note survives a refresh.
  const saveImageNote = useCallback((index: number, note: string) => {
    if (!run) return
    setAuditResults((prev) => {
      // Make sure there's an audit row to attach the note to — synthesize one
      // if the image never went through auditing (e.g. brand-new failed slot).
      // Default to 'fail' so an un-audited image with a note still surfaces
      // in "Regenerate flagged (N)" — operator-noted = worth redoing.
      const base = prev[index] ?? {
        image_index: index,
        verdict: 'fail' as const,
        issues: [],
        requires_regeneration: true,
      }
      const updated = prev.map((r, i) =>
        i === index ? { ...base, user_note: note || null } : r,
      )
      // Bump even if prev[index] was null:
      if (!prev[index]) updated[index] = { ...base, user_note: note || null }
      fetch(`/api/runs/${run.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audit_results: JSON.stringify(updated) }),
      }).catch(() => { /* informational; ignore network blips */ })
      return updated
    })
  }, [run])

  // Phase E: Operator override of an audit verdict. Cycles
  // pass → minor → fail → (clear back to auditor's verdict) → ...
  // Persists by PATCHing audit_results on the run so it survives refresh.
  const overrideVerdict = useCallback((index: number) => {
    if (!run) return
    const current = auditResults[index]
    if (!current) return
    const nextVal = nextOverride(current.user_override ?? null, current.verdict)
    const updated = auditResults.map((r, i) =>
      i === index && r ? { ...r, user_override: nextVal } : r,
    )
    setAuditResults(updated)
    fetch(`/api/runs/${run.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audit_results: JSON.stringify(updated) }),
    }).catch(() => { /* override is informational; ignore network blips */ })
  }, [run, auditResults])

  return (
    <main className="px-7 py-7 max-w-[1080px] mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link href="/" className="text-[12px] text-[var(--color-text-3)] hover:text-[var(--color-text-2)] transition-colors">← Pipeline</Link>
        <div className="w-px h-3.5 bg-[var(--color-border-strong)]" />
        <span className="text-[11px] font-[650] uppercase tracking-[0.08em] text-[var(--color-accent)]">Stage 3</span>
        <span className="text-[var(--color-text-4)]">·</span>
        <span className="text-[11px] font-[550] text-[var(--color-text-3)]">Image Generation</span>
        {run && (
          <>
            <div className="w-px h-3.5 bg-[var(--color-border-strong)]" />
            <span className="text-[12px] text-[var(--color-text-2)]">{run.brand_name ?? run.product_name ?? `Run #${run.id}`}</span>
          </>
        )}
      </div>

      <PhaseIndicator phase={phase} />

      {phase === 'loading' && <LoadingState message="Loading run data…" />}
      {phase === 'A_generating' && (
        <LoadingState
          message="Generating 9 image prompts…"
          subtitle="Claude is analyzing your research and copy to craft targeted Higgsfield prompts."
        />
      )}
      {phase === 'B_qc_gate' && (
        <QCGate
          prompts={prompts}
          originalPrompts={originalPrompts}
          onPromptsChange={setPrompts}
          productImages={scraperImages}
          onApprove={generateImages}
        />
      )}
      {phase === 'C_generating' && (
        <GeneratingPhase
          images={images}
          prompts={prompts}
          generatingIndex={generatingIndex}
        />
      )}
      {phase === 'D_auditing' && (
        <AuditingPhase
          images={images}
          prompts={prompts}
          auditResults={auditResults}
          auditingIndex={auditingIndex}
        />
      )}
      {phase === 'E_complete' && (
        <CompletePhase
          images={images}
          prompts={prompts}
          auditResults={auditResults}
          regenCounts={regenCounts}
          onRegenerate={(i) => setRegenModal({ index: i, editedPrompt: prompts[i].prompt })}
          onRerunAll={openReprmptModal}
          onRegenerateFailed={regenerateFailedImages}
          onOverrideVerdict={overrideVerdict}
          onSaveNote={saveImageNote}
          run={run}
        />
      )}
      {phase === 'error' && <ErrorState message={error ?? 'Unknown error'} runId={searchParams.get('runId')} />}

      {regenModal && (
        <RegenModal
          index={regenModal.index}
          prompt={regenModal.editedPrompt}
          auditResult={auditResults[regenModal.index] ?? null}
          category={prompts[regenModal.index]?.category ?? null}
          regenCount={regenCounts[regenModal.index] ?? 0}
          loading={regenLoading}
          onChange={(p) => setRegenModal(prev => prev ? { ...prev, editedPrompt: p } : prev)}
          onConfirm={() => regenerateImage(regenModal.index, regenModal.editedPrompt)}
          onClose={() => setRegenModal(null)}
        />
      )}

      {/* Always-available Stage 2 copy reference (hidden on description-only
          runs or before Stage 2 completes). */}
      <Stage2CopyPanel run={run} />

      {reprmptModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setReprmptModalOpen(false)}
          />
          <div className="relative border border-[var(--color-border)] rounded-[11px] bg-[var(--color-surface)] shadow-[0_2px_8px_rgba(20,20,18,.06)] p-6 max-w-xl w-full space-y-4">
            <div>
              <p className="font-[var(--font-ibm-plex-mono)] text-[10px] text-[var(--color-text-3)] uppercase tracking-widest">Re-prompt &amp; regenerate</p>
              <h3 className="text-[15px] font-[600] text-[var(--color-text)] mt-0.5">
                Anything specific Claude should do differently this time?
              </h3>
              <p className="text-[12px] text-[var(--color-text-3)] mt-1 leading-relaxed">
                Optional. Whatever you put here gets injected as the highest-priority instruction
                across all 9 fresh prompts. Leave blank to just re-run with the accumulated
                feedback from past rounds.
              </p>
            </div>
            <textarea
              value={reprmptDraft}
              onChange={(e) => setReprmptDraft(e.target.value)}
              placeholder="e.g. Use warmer lighting throughout. Move all German overlay text higher in frame. Drop the studio backgrounds — show product in real apartments instead."
              rows={4}
              autoFocus
              className="w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-lg px-[13px] py-[11px] text-sm transition-all focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)] resize-y placeholder:text-[var(--color-text-4)]"
            />
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={() => { setReprmptModalOpen(false); executeRegenerateAll(reprmptDraft) }}
                className="cursor-pointer inline-flex items-center gap-[7px] rounded-lg px-[15px] py-[9px] text-[13.5px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] border border-transparent transition-all hover:brightness-105 whitespace-nowrap"
              >
                {reprmptDraft.trim() ? 'Regenerate with this note' : 'Regenerate (no note)'}
              </button>
              <button
                onClick={() => setReprmptModalOpen(false)}
                className="cursor-pointer inline-flex items-center gap-[7px] rounded-lg px-[15px] py-[9px] text-[13.5px] font-[620] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] transition-all hover:border-[var(--color-text-3)] hover:bg-[var(--color-surface-2)] whitespace-nowrap"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

export default function Stage3PageWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--color-bg)]" />}>
      <Stage3Page />
    </Suspense>
  )
}
