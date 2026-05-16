export interface CategoryDef {
  id: string
  label: string
  description: string
  default_model: string
  aspect_ratio: string
}

export const IMAGE_CATEGORIES: CategoryDef[] = [
  { id: 'hero_studio', label: '1. Hero Studio', description: 'Clean studio shot, neutral/gradient background, product only, dramatic lighting', default_model: 'marketing_studio_image', aspect_ratio: '1:1' },
  { id: 'hero_angle', label: '2. Hero Angle (3/4)', description: 'Same studio treatment, 3/4 angle showing depth and dimension', default_model: 'marketing_studio_image', aspect_ratio: '1:1' },
  { id: 'lifestyle', label: '3. Lifestyle', description: 'Product in natural aspirational setting, human conveys emotional outcome if present', default_model: 'marketing_studio_image', aspect_ratio: '1:1' },
  { id: 'worn_in_use', label: '4. Worn/In-Use', description: 'Product actively worn or used by ONE person, mechanism visible in use', default_model: 'flux_2', aspect_ratio: '1:1' },
  { id: 'versatility', label: '5. Versatility', description: 'TWO instances of product in TWO different realistic contexts, one frame', default_model: 'flux_2', aspect_ratio: '1:1' },
  { id: 'durability', label: '6. Durability', description: 'Most demanding realistic condition this product would actually face', default_model: 'flux_2', aspect_ratio: '1:1' },
  { id: 'detail_a', label: '7. Detail A', description: 'Macro of most visually unique physical feature', default_model: 'nano_banana_flash', aspect_ratio: '1:1' },
  { id: 'detail_b', label: '8. Detail B', description: 'Macro of second functional feature, tells engineering/craft story', default_model: 'nano_banana_flash', aspect_ratio: '1:1' },
  { id: 'use_case', label: '9. Use Case', description: 'Single most specific real-world scenario the German avatar recognizes instantly', default_model: 'marketing_studio_image', aspect_ratio: '1:1' },
  { id: 'infographic_features', label: '10. Infographic A (Features)', description: 'Product with 2-3 key features highlighted, German text labels, circular magnified insets', default_model: 'flux_2_pro', aspect_ratio: '1:1' },
  { id: 'infographic_benefits', label: '11. Infographic B (Benefits)', description: 'Product in context with 2-3 benefit callouts, German text, icons, social-ready', default_model: 'flux_2_pro', aspect_ratio: '1:1' },
]
