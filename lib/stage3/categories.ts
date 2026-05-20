export interface CategoryDef {
  id: string
  label: string
  description: string
  default_model: string
  aspect_ratio: string
}

// 9 template-based image categories. Order matches the Stage 3 system prompt templates.
export const IMAGE_CATEGORIES: CategoryDef[] = [
  { id: 'hero_studio',            label: '1. Hero Studio Product',        description: 'Premium ecommerce hero, clean studio environment, product centered',           default_model: 'nano_banana_2', aspect_ratio: '1:1' },
  { id: 'lifestyle',              label: '2. Lifestyle Use-Case',         description: 'Product in a realistic setting with natural use by target customer',           default_model: 'nano_banana_2', aspect_ratio: '1:1' },
  { id: 'problem_solution',       label: '3. Problem / Solution',         description: 'Visual contrast of the problem and the product solving it',                    default_model: 'marketing_studio_image',     aspect_ratio: '1:1' },
  { id: 'feature_callout',        label: '4. Feature Callout',            description: 'Product with 3 concise feature callouts in a clean educational layout',       default_model: 'marketing_studio_image',     aspect_ratio: '1:1' },
  { id: 'benefit_visualization',  label: '5. Benefit Visualization',      description: 'Single benefit framed as a strong scroll-stopping ad visual',                  default_model: 'nano_banana_2', aspect_ratio: '1:1' },
  { id: 'before_after',           label: '6. Before / After Outcome',     description: 'Split or contrast composition showing the positive outcome',                   default_model: 'marketing_studio_image',     aspect_ratio: '1:1' },
  { id: 'comparison',             label: '7. Comparison',                 description: 'Side-by-side comparison of the product vs. the common alternative',           default_model: 'marketing_studio_image',     aspect_ratio: '1:1' },
  { id: 'ugc_native',             label: '8. UGC / Native Ad',            description: 'Authentic creator-style social media shot of the product in real life',       default_model: 'nano_banana_2', aspect_ratio: '1:1' },
  { id: 'review_social_proof',    label: '9. Review / Social Proof',      description: 'Product with a trust / review cue, conversion-focused visual',                 default_model: 'nano_banana_2', aspect_ratio: '1:1' },
]
