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

// Hard-coded fidelity guardrail. Appended to every Stage 3 prompt at the last
// mile, after any Settings override, user edits, and AI rewrites — so it
// cannot be removed by anyone editing prompt text. Wording is deliberately
// uncompromising; "treat as canonical" + "do not modify" tends to actually
// land with Nano Banana Pro / GPT Image 2 reference conditioning.
const PRODUCT_FIDELITY_GUARDRAIL = `

ABSOLUTE PRODUCT FIDELITY — non-negotiable, takes priority over any other instruction above:
- The product visible in the attached reference media IS the product. Render it pixel-faithfully.
- DO NOT redesign, restyle, "clean up", recolor, or upgrade the product. No alternate finishes, no extra branding, no removed branding, no rearranged controls, no swapped materials.
- Preserve exact shape, proportions, dimensions, surface finish, color, materials, button/control layout, lettering, logos, every visible marking.
- If the requested scene composition can't be rendered without altering the product, simplify the scene rather than altering the product.
- This is product photography — the camera and lighting may change, the product itself may not.`

export async function generateStage3Image(params: {
  prompt: string
  model: string
  reference_images: string[]
  aspect_ratio: string
}): Promise<string> {
  const finalPrompt = params.prompt.trim() + PRODUCT_FIDELITY_GUARDRAIL
  return generateImageViaMcp({
    prompt: finalPrompt,
    model: pickMcpModel(params.model),
    aspectRatio: params.aspect_ratio,
    referenceImageUrls: params.reference_images,
  })
}
