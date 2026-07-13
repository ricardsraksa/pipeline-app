export type ImageCategory =
  | 'hero_studio'
  | 'lifestyle'
  | 'problem_solution'
  | 'feature_callout'
  | 'benefit_visualization'
  | 'before_after'
  | 'comparison'
  | 'ugc_native'
  | 'review_social_proof'

export interface ImagePrompt {
  category: ImageCategory
  image_type: string
  prompt: string
  overlay_text: string
  source_image_references: string[]
  model: string
  aspect_ratio: string
  // Legacy fields kept optional for backward compatibility with old runs/feedback data.
  overlay_text_used?: string | null
  reference_image_index?: number
}

export interface GeneratedImage {
  prompt_index: number
  category: ImageCategory
  higgsfield_job_id: string
  image_url: string
  status: 'generating' | 'complete' | 'failed'
}

export type Verdict = 'pass' | 'fail'

export interface AuditResult {
  image_index: number
  /** Auto verdict from the audit pass — never mutated after the audit returns.
   *  Legacy runs may still hold `'minor_issue'` in storage; readers should
   *  treat anything that isn't a clean `'pass'` as `'fail'` (see
   *  effectiveVerdict / coerceVerdict). */
  verdict: Verdict
  /** Operator override. If set, takes precedence over `verdict` everywhere
   *  (counts, "regenerate flagged", badge color). null = no override. */
  user_override?: Verdict | null
  /** Operator-written note. Used as additional instructions when the prompt
   *  is rewritten before the next regen. Persisted with the run. */
  user_note?: string | null
  issues: string[]
  requires_regeneration: boolean
}

/** Coerce any stored verdict (incl. legacy `'minor_issue'`) into the binary
 *  pass/fail world. Anything that isn't `'pass'` becomes `'fail'`. */
export function coerceVerdict(v: string | null | undefined): Verdict {
  return v === 'pass' ? 'pass' : 'fail'
}

/** Single source of truth: prefer the user's override when it's set. */
export function effectiveVerdict(a: AuditResult | null | undefined): Verdict | null {
  if (!a) return null
  return coerceVerdict(a.user_override ?? a.verdict)
}

export interface PromptFeedback {
  category: ImageCategory
  original_prompt: string
  edited_prompt: string | null
  approved: boolean
  timestamp: string
}

export type Stage3Phase =
  | 'loading'
  | 'A_generating'
  | 'B_qc_gate'
  | 'C_generating'
  | 'D_auditing'
  | 'E_complete'
  | 'error'
