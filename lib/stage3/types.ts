export type ImageCategory =
  | 'hero_studio'
  | 'hero_angle'
  | 'lifestyle'
  | 'worn_in_use'
  | 'versatility'
  | 'durability'
  | 'detail_a'
  | 'detail_b'
  | 'use_case'
  | 'infographic_features'
  | 'infographic_benefits'

export interface ImagePrompt {
  category: ImageCategory
  prompt: string
  german_text_used: string | null
  reference_image_index: number
  model: string
  aspect_ratio: string
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
