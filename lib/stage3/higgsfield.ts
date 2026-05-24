import { generateImageViaMcp } from '@/lib/higgsfield-mcp'

// Stage 3 image generation.
//
// Runs through the Higgsfield MCP. Photorealistic product/lifestyle shots use
// Nano Banana Pro; infographic / text-heavy templates use GPT Image 2 (OpenAI's
// text-rendering image model). The Stage 3 system prompt asks Claude to mark
// infographic templates as `marketing_studio_image`, which we map to
// `gpt_image_2` here. The product photos are passed as reference media so the
// output is conditioned on the real product in both cases.
function pickMcpModel(claudeModel: string): string {
  const m = (claudeModel || '').trim().toLowerCase()
  if (m === 'marketing_studio_image' || m === 'gpt_image_2') return 'gpt_image_2'
  return 'nano_banana_pro'
}

export async function generateStage3Image(params: {
  prompt: string
  model: string
  reference_images: string[]
  aspect_ratio: string
}): Promise<string> {
  return generateImageViaMcp({
    prompt: params.prompt,
    model: pickMcpModel(params.model),
    aspectRatio: params.aspect_ratio,
    referenceImageUrls: params.reference_images,
  })
}
