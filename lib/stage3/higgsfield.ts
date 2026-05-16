export { generateImage, createGeneration, pollGeneration } from '@/lib/higgsfield'

// For Stage 3 calls with multiple reference images, use first non-null image URL
export async function generateStage3Image(params: {
  prompt: string
  model: string
  reference_images: string[]
  aspect_ratio: string
}): Promise<string> {
  const { generateImage } = await import('@/lib/higgsfield')
  const refUrl = params.reference_images.find(u => u && u.startsWith('http'))
  return generateImage({
    prompt: params.prompt,
    model: params.model as Parameters<typeof generateImage>[0]['model'],
    reference_image_url: refUrl,
    aspect_ratio: params.aspect_ratio as Parameters<typeof generateImage>[0]['aspect_ratio'],
    resolution: '2k',
  })
}
