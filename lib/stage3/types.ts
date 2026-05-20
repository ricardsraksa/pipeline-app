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

export interface AuditResult {
  image_index: number
  verdict: 'pass' | 'minor_issue' | 'fail'
  issues: string[]
  requires_regeneration: boolean
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
