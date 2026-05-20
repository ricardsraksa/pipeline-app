"use client"
import { useEffect, useState, useCallback, useMemo, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { IMAGE_CATEGORIES } from '@/lib/stage3/categories'
import type { ImagePrompt, AuditResult, Stage3Phase } from '@/lib/stage3/types'
import type { Run } from '@/lib/db'

// ─── Sub-components ──────────────────────────────────────────────────────────

function VerdictBadge({ verdict }: { verdict: string }) {
  if (verdict === 'pass')
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-mono bg-[color:rgb(90_158_117_/_0.12)] text-[var(--color-success)] border border-[color:rgb(90_158_117_/_0.28)]">✓ Pass</span>
  if (verdict === 'minor_issue')
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-mono bg-[color:rgb(184_144_74_/_0.12)] text-[var(--color-warn)] border border-[color:rgb(184_144_74_/_0.28)]">~ Minor</span>
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-mono bg-[color:rgb(184_96_96_/_0.12)] text-[var(--color-error)] border border-[color:rgb(184_96_96_/_0.28)]">✕ Fail</span>
}

interface ImageSlot {
  url: string | null
  status: 'pending' | 'generating' | 'done' | 'error'
  error?: string
}

function ImageCell({
  image,
  prompt,
  auditResult,
  onRegenerate,
  regenCount,
}: {
  image: ImageSlot
  prompt: ImagePrompt
  auditResult: AuditResult | null
  onRegenerate: () => void
  regenCount: number
}) {
  const [showDetails, setShowDetails] = useState(false)
  const cat = IMAGE_CATEGORIES.find(c => c.id === prompt.category)
  const catIndex = IMAGE_CATEGORIES.findIndex(c => c.id === prompt.category)

  return (
    <div className="aspect-square rounded-xl border border-[var(--color-border)] overflow-hidden relative bg-[var(--color-surface)] group">
      {image.status === 'done' && image.url ? (
        <>
          <img src={image.url} alt={cat?.label ?? prompt.category} className="w-full h-full object-cover" />
          {auditResult && (
            <div className="absolute top-2 left-2">
              <VerdictBadge verdict={auditResult.verdict} />
            </div>
          )}
          {auditResult?.requires_regeneration && regenCount < 3 && (
            <button
              onClick={onRegenerate}
              className="absolute bottom-2 right-2 px-2 py-1 bg-[color:rgb(184_96_96_/_0.12)] border border-[color:rgb(184_96_96_/_0.30)] text-[var(--color-error)] text-[10px] font-mono rounded cursor-pointer hover:bg-[color:rgb(184_96_96_/_0.18)] transition-colors"
            >
              Regenerate
            </button>
          )}
          {regenCount >= 3 && auditResult?.requires_regeneration && (
            <div className="absolute bottom-2 right-2 px-2 py-1 bg-[var(--color-surface)]/90 text-[var(--color-text-3)] text-[9px] font-mono rounded">
              Max retries
            </div>
          )}
          <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
            <p className="font-mono text-[9px] text-white/80 truncate">{cat?.label}</p>
          </div>
          {auditResult && auditResult.issues.length > 0 && (
            <button
              onClick={() => setShowDetails(v => !v)}
              className="absolute top-2 right-2 w-5 h-5 rounded-full bg-black/60 text-[var(--color-text-2)] text-[9px] font-mono flex items-center justify-center cursor-pointer hover:bg-black/80"
            >
              i
            </button>
          )}
          {showDetails && auditResult && (
            <div className="absolute inset-0 bg-black/85 p-3 flex flex-col gap-1 overflow-y-auto">
              <p className="font-mono text-[9px] text-[var(--color-text-2)] uppercase tracking-wider mb-1">Issues</p>
              {auditResult.issues.map((issue, i) => (
                <p key={i} className="text-[10px] text-[var(--color-text-2)] font-mono leading-relaxed">• {issue}</p>
              ))}
              <button onClick={() => setShowDetails(false)} className="mt-auto text-[9px] text-[var(--color-text-3)] hover:text-[var(--color-text-2)] font-mono cursor-pointer">close</button>
            </div>
          )}
        </>
      ) : image.status === 'generating' ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-2 h-2 rounded-full bg-[var(--color-accent)] animate-pulse" />
        </div>
      ) : image.status === 'error' ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-3 gap-1">
          <span className="text-[var(--color-error)] font-mono text-[10px]">Failed</span>
          <span className="text-[var(--color-text-3)] text-[9px] text-center font-mono">{image.error?.slice(0, 60)}</span>
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
          <span className="font-mono text-[var(--color-text-4)] text-lg">{catIndex + 1}</span>
          <span className="font-mono text-[var(--color-text-4)] text-[9px] text-center px-2">{cat?.label}</span>
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
        const stepOrder = i + 1 // A=1, B=2, C=3, D=4, E=5
        const isActive = phase === step.id
        const isDone = currentIdx > stepOrder
        return (
          <div key={step.id} className="flex items-center gap-2">
            {i > 0 && <div className="w-6 h-px bg-[var(--color-surface-2)]" />}
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isActive ? 'bg-[var(--color-accent)]' : isDone ? 'bg-[var(--color-success)]' : 'bg-[var(--color-surface-3)]'}`} />
              <span className={`font-mono text-[10px] uppercase tracking-widest ${isActive ? 'text-[var(--color-accent)]' : isDone ? 'text-[var(--color-success)]' : 'text-[var(--color-text-3)]'}`}>
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
      <p className="font-mono text-sm text-[var(--color-text-2)]">{message}</p>
      {subtitle && <p className="font-mono text-[11px] text-[var(--color-text-3)] max-w-sm text-center">{subtitle}</p>}
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <p className="font-mono text-sm text-[var(--color-error)]">Error</p>
      <p className="font-mono text-[11px] text-[var(--color-text-3)] max-w-md text-center">{message}</p>
    </div>
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
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[var(--color-text)] text-lg font-medium mb-1">Review Image Prompts</h2>
        <p className="font-mono text-[11px] text-[var(--color-text-3)]">Review and edit the 11 prompts before generating. Changes are saved as learning data.</p>
      </div>
      <div className="space-y-4">
        {prompts.map((prompt, i) => {
          const cat = IMAGE_CATEGORIES.find(c => c.id === prompt.category)
          const isEdited = prompt.prompt !== originalPrompts[i]?.prompt
          const refImg = productImages[prompt.reference_image_index]
          const isInfographic = prompt.category === 'infographic_features' || prompt.category === 'infographic_benefits'

          return (
            <div key={i} className="bg-[var(--color-surface)]/40 border border-[var(--color-border)] rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-[10px] text-[var(--color-text-2)] font-medium">{cat?.label ?? prompt.category}</span>
                <span className="font-mono text-[9px] bg-[var(--color-surface-2)] text-[var(--color-text-2)] px-2 py-0.5 rounded">{prompt.model}</span>
                <span className="font-mono text-[9px] bg-[var(--color-surface-2)] text-[var(--color-text-3)] px-2 py-0.5 rounded">{prompt.aspect_ratio}</span>
                {refImg && (
                  <img
                    src={refImg}
                    alt="ref"
                    className="w-6 h-6 object-cover rounded"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                )}
                {cat && (
                  <span className="font-mono text-[9px] text-[var(--color-text-3)]">{cat.description}</span>
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
                className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] focus:border-[var(--color-border-hover)] focus:ring-1 focus:ring-[var(--color-accent)]/15 rounded-lg px-3.5 py-2.5 text-sm text-[var(--color-text)] placeholder-[var(--color-text-4)] focus:outline-none transition-colors resize-y font-mono text-[11px] leading-relaxed"
              />
              <div className="flex items-center justify-between">
                <span className="font-mono text-[9px] text-[var(--color-text-4)]">{prompt.prompt.length} chars</span>
                {isEdited && (
                  <button
                    onClick={() => {
                      const updated = [...prompts]
                      updated[i] = { ...prompt, prompt: originalPrompts[i].prompt }
                      onPromptsChange(updated)
                    }}
                    className="px-3 py-1 border border-[var(--color-border)] hover:border-[var(--color-border-hover)] hover:bg-[var(--color-surface-2)]/50 text-[var(--color-text-2)] hover:text-[var(--color-text)] rounded-lg text-[10px] font-mono transition-colors cursor-pointer"
                  >
                    Reset to Original
                  </button>
                )}
              </div>
              {isInfographic && prompt.german_text_used && (
                <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-3">
                  <p className="font-mono text-[9px] text-[var(--color-text-3)] uppercase tracking-widest mb-1">German text used</p>
                  <p className="font-mono text-[10px] text-[var(--color-text-2)]">{prompt.german_text_used}</p>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <button
        onClick={onApprove}
        className="px-4 py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent)] text-white rounded-lg text-sm font-medium transition-colors cursor-pointer"
      >
        Approve All & Generate Images →
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
        <h2 className="text-[var(--color-text)] text-lg font-medium mb-1">Generating Images</h2>
        {generatingIndex != null ? (
          <p className="font-mono text-[11px] text-[var(--color-accent)] animate-pulse">
            Generating image {generatingIndex + 1} of {prompts.length} — {cat?.label ?? prompts[generatingIndex]?.category}
          </p>
        ) : (
          <p className="font-mono text-[11px] text-[var(--color-text-3)]">Starting generation…</p>
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
        <h2 className="text-[var(--color-text)] text-lg font-medium mb-1">Auditing Images</h2>
        {auditingIndex != null ? (
          <p className="font-mono text-[11px] text-[var(--color-accent)] animate-pulse">
            Auditing image {auditingIndex + 1} of {prompts.length}…
          </p>
        ) : (
          <p className="font-mono text-[11px] text-[var(--color-text-3)]">Completing audit…</p>
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
  run,
}: {
  images: ImageSlot[]
  prompts: ImagePrompt[]
  auditResults: (AuditResult | null)[]
  regenCounts: number[]
  onRegenerate: (i: number) => void
  run: Run | null
}) {
  const passed = auditResults.filter(r => r?.verdict === 'pass').length
  const minor = auditResults.filter(r => r?.verdict === 'minor_issue').length
  const failed = auditResults.filter(r => r?.verdict === 'fail').length

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[var(--color-text)] text-lg font-medium mb-1">Image Generation Complete</h2>
        <div className="flex items-center gap-4 font-mono text-[11px]">
          <span className="text-[var(--color-success)]">{passed} passed</span>
          {minor > 0 && <span className="text-[var(--color-warn)]">{minor} minor issues</span>}
          {failed > 0 && <span className="text-[var(--color-error)]">{failed} failed</span>}
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
            regenCount={regenCounts[i] ?? 0}
          />
        ))}
      </div>
      <div className="flex items-center gap-3 pt-2">
        {run?.id && (
          <Link
            href={`/history/${run.id}`}
            className="px-4 py-2 border border-[var(--color-border)] hover:border-[var(--color-border-hover)] hover:bg-[var(--color-surface-2)]/50 text-[var(--color-text-2)] hover:text-[var(--color-text)] rounded-lg text-sm transition-colors cursor-pointer"
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
  regenCount,
  loading,
  onChange,
  onConfirm,
  onClose,
}: {
  index: number
  prompt: string
  auditResult: AuditResult | null
  regenCount: number
  loading: boolean
  onChange: (p: string) => void
  onConfirm: () => void
  onClose: () => void
}) {
  const cat = IMAGE_CATEGORIES.find(c => c.id === (auditResult as AuditResult & { category?: string })?.category)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />
      <div className="relative bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6 max-w-2xl w-full space-y-4">
        <div>
          <p className="font-mono text-[10px] text-[var(--color-text-3)] uppercase tracking-widest">Image {index + 1}{cat ? ` — ${cat.label}` : ''}</p>
          <p className="text-[var(--color-text)] text-sm font-medium mt-0.5">Attempt {regenCount + 1} of 3</p>
        </div>
        {auditResult && auditResult.issues.length > 0 && (
          <div className="space-y-1">
            <p className="font-mono text-[9px] text-[var(--color-text-3)] uppercase tracking-widest">Issues</p>
            {auditResult.issues.map((issue, i) => (
              <p key={i} className="text-[11px] text-[var(--color-error)] font-mono">• {issue}</p>
            ))}
          </div>
        )}
        <div>
          <label className="font-mono text-[10px] text-[var(--color-text-3)] uppercase tracking-widest block mb-2">Edit Prompt</label>
          <textarea
            value={prompt}
            rows={8}
            onChange={e => onChange(e.target.value)}
            className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] focus:border-[var(--color-border-hover)] focus:ring-1 focus:ring-[var(--color-accent)]/15 rounded-lg px-3.5 py-2.5 text-sm text-[var(--color-text)] placeholder-[var(--color-text-4)] focus:outline-none transition-colors resize-y font-mono text-[11px] leading-relaxed"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onConfirm}
            disabled={loading}
            className="px-4 py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent)] disabled:bg-[var(--color-surface-2)] disabled:text-[var(--color-text-3)] text-white rounded-lg text-sm font-medium transition-colors cursor-pointer"
          >
            {loading ? 'Regenerating…' : 'Regenerate Image'}
          </button>
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 border border-[var(--color-border)] hover:border-[var(--color-border-hover)] hover:bg-[var(--color-surface-2)]/50 text-[var(--color-text-2)] hover:text-[var(--color-text)] rounded-lg text-sm transition-colors cursor-pointer"
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
    fetch(`/api/runs/${runId}`)
      .then(r => r.json())
      .then(data => {
        if (!data.run) throw new Error('Run not found')
        setRun(data.run)
        setPhase('A_generating')
      })
      .catch(err => { setError(err instanceof Error ? err.message : String(err)); setPhase('error') })
  }, [searchParams])

  // Phase A: Generate prompts
  useEffect(() => {
    if (phase !== 'A_generating' || !run) return

    const scraperData = run.scraper_data ? JSON.parse(run.scraper_data) : null
    const productImages: string[] = scraperData?.images ?? []

    fetch('/api/stage3/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        research: run.step_research_revised ?? run.step_research ?? '',
        avatar: run.step_avatar_revised ?? run.step_avatar ?? '',
        offer_brief: run.step_offer_brief_revised ?? run.step_offer_brief ?? '',
        necessary_beliefs: run.step_necessary_beliefs_revised ?? run.step_necessary_beliefs ?? '',
        copy: run.stage2_output ?? '',
        product_images: productImages,
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
        setPhase('B_qc_gate')
      })
      .catch(err => { setError(err instanceof Error ? err.message : String(err)); setPhase('error') })
  }, [phase, run])

  // Phase C: Generate images sequentially
  const generateImages = useCallback(async () => {
    if (!run) return
    setPhase('C_generating')
    const scraperData = run.scraper_data ? JSON.parse(run.scraper_data) : null
    const productImages: string[] = scraperData?.images ?? []

    // Save prompt edits as feedback
    const editsToSave = prompts.map((p, i) => ({
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

    const updatedImages: ImageSlot[] = prompts.map(() => ({ url: null, status: 'pending' as const }))

    for (let i = 0; i < prompts.length; i++) {
      const p = prompts[i]
      setGeneratingIndex(i)
      updatedImages[i] = { url: null, status: 'generating' }
      setImages([...updatedImages])

      const refImages = p.reference_image_index != null
        ? [productImages[p.reference_image_index]].filter(Boolean)
        : productImages.slice(0, 1)

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
    // Auto-trigger audit with the final images array
    await auditImagesInternal(updatedImages, prompts)
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
            german_text_used: p.german_text_used,
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

    // Save to DB
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
    const p = prompts[index]
    const refImages = p.reference_image_index != null
      ? [productImages[p.reference_image_index]].filter(Boolean)
      : productImages.slice(0, 1)

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
        body: JSON.stringify({ image_url: genData.image_url, category: p.category, prompt_used: newPrompt, product_description: productDesc, german_text_used: p.german_text_used }),
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

  return (
    <main className="min-h-screen bg-[var(--color-bg)]">
      {/* Top bar */}
      <div className="border-b border-[var(--color-border)] bg-[var(--color-bg)]">
        <div className="max-w-5xl mx-auto px-6 h-11 flex items-center gap-4">
          <Link href="/" className="font-mono text-[10px] text-[var(--color-text-3)] hover:text-[var(--color-text-2)] transition-colors">← Pipeline</Link>
          <div className="w-px h-3.5 bg-[var(--color-surface-2)]" />
          <span className="font-mono text-[10px] text-[var(--color-accent)] uppercase tracking-widest">Stage 3</span>
          <span className="text-[var(--color-text-4)]">·</span>
          <span className="font-mono text-[10px] text-[var(--color-text-3)] uppercase tracking-widest">Image Generation</span>
          {run && (
            <>
              <div className="w-px h-3.5 bg-[var(--color-surface-2)]" />
              <span className="font-mono text-[10px] text-[var(--color-text-3)]">{run.brand_name ?? run.product_name ?? `Run #${run.id}`}</span>
            </>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-10">
        <PhaseIndicator phase={phase} />

        {phase === 'loading' && <LoadingState message="Loading run data…" />}
        {phase === 'A_generating' && (
          <LoadingState
            message="Generating 11 image prompts…"
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
            run={run}
          />
        )}
        {phase === 'error' && <ErrorState message={error ?? 'Unknown error'} />}

        {regenModal && (
          <RegenModal
            index={regenModal.index}
            prompt={regenModal.editedPrompt}
            auditResult={auditResults[regenModal.index] ?? null}
            regenCount={regenCounts[regenModal.index] ?? 0}
            loading={regenLoading}
            onChange={(p) => setRegenModal(prev => prev ? { ...prev, editedPrompt: p } : prev)}
            onConfirm={() => regenerateImage(regenModal.index, regenModal.editedPrompt)}
            onClose={() => setRegenModal(null)}
          />
        )}
      </div>
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
