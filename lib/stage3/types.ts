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
  german_text: string
  source_image_references: string[]
  model: string
  aspect_ratio: string
  // Legacy fields kept optional for backward compatibility with old runs/feedback data.
  german_text_used?: string | null
  reference_image_index?: number
}

export interface GeneratedImage {
  prompt_index: number
  category: ImageCategory
  higgsfield_job_id: string
  image_url: string
  status: 'generating' | 'complete' | 'failed'
}

export type Verdict = 'pass' | 'minor_issue' | 'fail'

export interface AuditResult {
  image_index: number
  /** Auto verdict from the audit pass — never mutated after the audit returns. */
  verdict: Verdict
  /** Operator override. If set, takes precedence over `verdict` everywhere
   *  (counts, "regenerate failed only", badge color). null = no override. */
  user_override?: Verdict | null
  issues: string[]
  requires_regeneration: boolean
}

/** Single source of truth: prefer the user's override when it's set. */
export function effectiveVerdict(a: AuditResult | null | undefined): Verdict | null {
  if (!a) return null
  return a.user_override ?? a.verdict
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
