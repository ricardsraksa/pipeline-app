export { generateImage, createGeneration, pollGeneration, BASE_MODEL } from '@/lib/higgsfield'

// Stage 3 image generation.
//
// The first https reference image is passed through as the product photo that
// conditions the result. When one is present the connector uses Soul Reference
// (the base model); otherwise it falls back to Soul Standard. See
// lib/higgsfield.ts.
export async function generateStage3Image(params: {
  prompt: string
  model: string
  reference_images: string[]
  aspect_ratio: string
}): Promise<string> {
  const { generateImage } = await import('@/lib/higgsfield')
  const referenceUrl = params.reference_images.find(
    (u) => typeof u === 'string' && u.startsWith('http'),
  )
  return generateImage({
    prompt: params.prompt,
    reference_image_url: referenceUrl,
    aspect_ratio: params.aspect_ratio as Parameters<typeof generateImage>[0]['aspect_ratio'],
    resolution: '1080p',
  })
}
