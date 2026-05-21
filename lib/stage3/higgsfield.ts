import { generateImageViaMcp } from '@/lib/higgsfield-mcp'

// Stage 3 image generation.
//
// Runs through the Higgsfield MCP (mcp.higgsfield.ai) so it can use Nano Banana
// Pro — the REST API does not expose that model. The base model is always
// nano_banana_pro; the prompt's source/product photos are passed as reference
// media so the result is conditioned on the real product.
export async function generateStage3Image(params: {
  prompt: string
  model: string
  reference_images: string[]
  aspect_ratio: string
}): Promise<string> {
  return generateImageViaMcp({
    prompt: params.prompt,
    model: 'nano_banana_pro',
    aspectRatio: params.aspect_ratio,
    referenceImageUrls: params.reference_images,
  })
}
