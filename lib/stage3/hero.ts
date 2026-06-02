import Anthropic from '@anthropic-ai/sdk'
import { jsonrepair } from 'jsonrepair'

// Hero-first Stage 3 prompt generation.
//
// Phase 1: ONE hero studio prompt generated from the SOURCE product photos.
// Phase 2: 8 derivative prompts that reference the APPROVED HERO image.
//
// The whole point: appearance is carried by the reference image, never by
// prose. The prompts describe scene / lighting / composition / text only.

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = 'claude-sonnet-4-5-20250929'

export interface HeroPrompt {
  model: string
  aspect_ratio: string
  prompt: string
  source_image_references: string[]
}

export interface RemainingPrompt {
  index: number
  image_type: string
  category: string
  model: string
  aspect_ratio: string
  prompt: string
  german_text: string
  source_image_references: string[]
}

const HERO_SYSTEM = `You are a product photography director. Generate ONE hero studio product image prompt for Higgsfield, using the source product images as the visual reference.

CRITICAL FIDELITY RULE:
Do NOT describe the product's appearance in words. Do not describe the spout shape, body shape, proportions, materials, colors, or features. The source images are the ground truth for what the product looks like. Describing it in words competes with the reference image and causes the model to drift toward a generic version. Your prompt handles ONLY scene, lighting, composition, and camera — never product appearance.

You will receive:
- Stage 1 one-pager (for product name and category only)
- Source product image URLs

OUTPUT: A single JSON object:
{
  "model": "nano_banana_2",
  "aspect_ratio": "1:1",
  "prompt": "<the hero prompt>",
  "source_image_references": ["<all source image URLs>"]
}

The prompt must follow this structure:

"Premium ecommerce hero product photograph.

SUBJECT: The exact product shown in the reference image. Reproduce it precisely — same shape, same proportions, same spout, same body, same window, same materials, same finish, same color. Do not stylize, redesign, or improve the product. It must be visually identical to the reference image, only placed in a clean studio scene.

SCENE: Clean studio setting. Soft warm light grey background with a gentle tonal gradient, no harsh edges, no visible backdrop seams. Product sits on a matching surface with a soft natural contact shadow underneath.

LIGHTING: Soft directional softbox from upper left, gentle fill from the right. Airy and premium, enough directional quality to show the product's real materials and surfaces. No dramatic shadows.

COMPOSITION: Product centered with generous breathing room on all sides. Photographed straight on at eye level or a very slight three-quarter angle. Full product visible, nothing cropped.

CAMERA: 85mm lens equivalent, f/8, sharp throughout. Realistic commercial product photography.

TEXT: None.

CRITICAL: The product must match the reference image exactly. If the reference shows a short angular spout, render a short angular spout. Keep the exact proportions, body shape, and window shape and placement from the reference. Do not substitute a generic or more elegant version of this product type.

NEGATIVE: do not redesign the product, do not change the spout shape, do not change proportions, do not change the body shape, do not change the window shape or position, do not make it taller or sleeker than the reference, no generic premium substitute, no invented features, no plastic finish if the reference is metal, no studio backdrop seams, no dramatic lighting, no text."

Always use model nano_banana_2 for the hero. Return only the JSON object, no markdown fences.`

const REMAINING_SYSTEM = `You are a creative director generating 8 image prompts for Higgsfield for a DTC product. The product's appearance is locked by an APPROVED HERO IMAGE which will be attached as the reference for every prompt.

CRITICAL FIDELITY RULE:
Do NOT describe the product's appearance in words — not the spout, body, proportions, materials, colors, or features. The approved hero image is the ground truth for appearance. Every prompt you write references the hero image. Your prompts handle ONLY scene, setting, people/animals, lighting, composition, text overlays, and mood — never the product's physical appearance.

When you need to refer to the product in a prompt, call it "the exact product shown in the reference image" — never describe its shape or materials.

INPUTS:
- Stage 1 one-pager (product name, benefits, use cases, USPs)
- Stage 2 German copy (headlines, benefits, FAQs, ad copy)
- Stage 1 avatar and visual strategy
- The approved hero image URL (this is the reference for all 8)

Generate exactly 8 prompts for these templates (indices 2-9):
2 lifestyle, 3 problem_solution, 4 feature_callout, 5 benefit_visualization, 6 before_after, 7 comparison, 8 ugc_native, 9 review_social_proof.

For each prompt:
- Fill scene, setting, lighting, composition from the template
- Use verbatim German text from Stage 2 for any overlays (never invent or translate)
- Pick the model: nano_banana_2 for realistic photography (2, 5, 8), gpt_image_2 for text/graphic-heavy (3, 4, 6, 7, 9)
- Reference the approved hero image in source_image_references
- Apply the brand aesthetic that fits the product (determine from Stage 1/2 — premium editorial, playful, bold, etc) but keep typography clean: no Alibaba pill badges, no clip-art icons, no drop shadows, mobile-readable German, no English text

Every prompt must include this fidelity line verbatim:
"Reproduce the exact product shown in the reference image — same shape, proportions, and details. Do not redesign or substitute a generic version."

OUTPUT: a JSON array of exactly 8 objects:
{
  "index": <2-9>,
  "image_type": "<template name>",
  "category": "<slug>",
  "model": "<nano_banana_2 | gpt_image_2>",
  "aspect_ratio": "1:1",
  "prompt": "<scene/lighting/text only — no product appearance description>",
  "german_text": "<verbatim German from Stage 2 or empty>",
  "source_image_references": ["<approved hero image URL>"]
}

Category slugs: 2 lifestyle, 3 problem_solution, 4 feature_callout, 5 benefit_visualization, 6 before_after, 7 comparison, 8 ugc_native, 9 review_social_proof.

Return only the JSON array, no markdown fences.`

type ImgBlock = { type: 'image'; source: { type: 'url'; url: string } }
function imageBlocks(urls: string[]): ImgBlock[] {
  return urls.slice(0, 5).map((u) => ({ type: 'image', source: { type: 'url', url: u } }))
}

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
}

/** Phase 1 — generate the single hero prompt from the source product photos. */
export async function generateHeroPrompt(params: {
  onePager: string
  sourceImageUrls: string[]
}): Promise<HeroPrompt> {
  const userText = [
    'STAGE 1 ONE-PAGER (product name + category only):',
    params.onePager || '(none)',
    '',
    `SOURCE PRODUCT IMAGE URLS (${params.sourceImageUrls.length}): ${params.sourceImageUrls.join(', ')}`,
    '',
    'Generate the hero prompt JSON now. The source images are attached below.',
  ].join('\n')

  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: HERO_SYSTEM,
    messages: [{ role: 'user', content: [{ type: 'text', text: userText }, ...imageBlocks(params.sourceImageUrls)] }],
  })
  const raw = stripFences(msg.content.find((b) => b.type === 'text')?.text ?? '')
  let parsed: HeroPrompt
  try { parsed = JSON.parse(raw) } catch { parsed = JSON.parse(jsonrepair(raw)) }

  return {
    model: parsed.model || 'nano_banana_2',
    aspect_ratio: parsed.aspect_ratio || '1:1',
    prompt: parsed.prompt || '',
    // Always force the real source URLs — the model sometimes echoes placeholders.
    source_image_references: params.sourceImageUrls,
  }
}

/** Phase 2 — generate the 8 derivative prompts that reference the approved hero. */
export async function generateRemainingPrompts(params: {
  onePager: string
  copy: string
  avatar: string
  visual: string
  heroImageUrl: string
}): Promise<RemainingPrompt[]> {
  const userText = [
    'STAGE 1 ONE-PAGER:',
    params.onePager || '(none)',
    '',
    'STAGE 2 GERMAN COPY (use German overlays verbatim):',
    params.copy || '(none)',
    '',
    'STAGE 1 AVATAR + VISUAL STRATEGY:',
    [params.avatar, params.visual].filter(Boolean).join('\n\n') || '(none)',
    '',
    `APPROVED HERO IMAGE URL (reference for all 8): ${params.heroImageUrl}`,
    '',
    'Generate the 8 prompts JSON array now. The approved hero image is attached below — every prompt references it.',
  ].join('\n')

  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: REMAINING_SYSTEM,
    messages: [{ role: 'user', content: [{ type: 'text', text: userText }, ...imageBlocks([params.heroImageUrl])] }],
  })
  const raw = stripFences(msg.content.find((b) => b.type === 'text')?.text ?? '')
  let arr: RemainingPrompt[]
  try { arr = JSON.parse(raw) } catch { arr = JSON.parse(jsonrepair(raw)) }
  if (!Array.isArray(arr)) throw new Error('Remaining prompts did not parse to an array')

  // Normalize + always pin the hero as the single reference.
  return arr.slice(0, 8).map((p, i) => ({
    index: typeof p.index === 'number' ? p.index : i + 2,
    image_type: p.image_type || '',
    category: p.category || '',
    model: p.model === 'gpt_image_2' ? 'gpt_image_2' : 'nano_banana_2',
    aspect_ratio: p.aspect_ratio || '1:1',
    prompt: p.prompt || '',
    german_text: p.german_text || '',
    source_image_references: [params.heroImageUrl],
  }))
}
