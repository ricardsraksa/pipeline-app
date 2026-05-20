export { generateImage, createGeneration, pollGeneration } from '@/lib/higgsfield'

import type { HiggsfieldModel } from '@/lib/higgsfield'

// Confirmed-real Higgsfield platform model IDs. Anything else needs to be
// mapped to one of these before the call goes out, or the platform returns
// HTTP 404 "Model not found".
const REAL_MODELS: ReadonlySet<HiggsfieldModel> = new Set([
  'marketing_studio_image',
  'flux_2',
  'nano_banana_flash',
  'nano_banana_2',
  'soul',
])

// Map aspirational/alias names Claude likes to use → real Higgsfield models.
// nano_banana_pro and gpt_image_2 don't exist on the platform as of now.
const MODEL_ALIASES: Record<string, HiggsfieldModel> = {
  nano_banana_pro:  'nano_banana_2',         // best photorealism we actually have
  gpt_image_2:      'marketing_studio_image', // best for graphic/text-heavy infographics
  flux_2_pro:       'flux_2',                 // fall back if Pro tier isn't enabled
}

function normalizeModel(name: string): HiggsfieldModel {
  if (REAL_MODELS.has(name as HiggsfieldModel)) return name as HiggsfieldModel
  if (MODEL_ALIASES[name]) return MODEL_ALIASES[name]
  // Unknown name — default to the most versatile real model.
  return 'marketing_studio_image'
}

// For Stage 3 calls with multiple reference images, use first non-null image URL
export async function generateStage3Image(params: {
  prompt: string
  model: string
  reference_images: string[]
  aspect_ratio: string
}): Promise<string> {
  const { generateImage } = await import('@/lib/higgsfield')
  const refUrl = params.reference_images.find(u => u && u.startsWith('http'))
  const model = normalizeModel(params.model)
  return generateImage({
    prompt: params.prompt,
    model,
    reference_image_url: refUrl,
    aspect_ratio: params.aspect_ratio as Parameters<typeof generateImage>[0]['aspect_ratio'],
    resolution: '2k',
  })
}
