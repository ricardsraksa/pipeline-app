export { generateImage, createGeneration, pollGeneration, DEFAULT_MODEL_ID } from '@/lib/higgsfield'

// Stage 3 image generation.
//
// The Higgsfield platform routes POST /{model_id}. Whatever model name a Stage
// 3 prompt picked is passed straight through — lib/higgsfield.ts normalises any
// legacy short name (nano_banana_2, marketing_studio_image, …) to the verified
// default model_id, so callers no longer need a local alias table.
export async function generateStage3Image(params: {
  prompt: string
  model: string
  reference_images: string[]
  aspect_ratio: string
}): Promise<string> {
  const { generateImage } = await import('@/lib/higgsfield')
  return generateImage({
    prompt: params.prompt,
    model: params.model,
    aspect_ratio: params.aspect_ratio as Parameters<typeof generateImage>[0]['aspect_ratio'],
    resolution: '720p',
  })
}
