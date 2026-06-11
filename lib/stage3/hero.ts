import Anthropic from '@anthropic-ai/sdk'
import { jsonrepair } from 'jsonrepair'
import { getModel } from '@/lib/models'

// Hero-first Stage 3 prompt generation.
//
// Phase 1: ONE hero studio prompt generated from the SOURCE product photos.
// Phase 2: 8 derivative prompts that reference the APPROVED HERO image.
//
// The whole point: appearance is carried by the reference image, never by
// prose. The prompts describe scene / lighting / composition / text only.

// timeout: a hung prompt-writing call fails within 2 min instead of the SDK's
// 10-min default — the route-level maxDuration would otherwise cut it off with
// no useful error.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 120_000 })
// Stage 3 prompt writing (hero + the 8 derivatives) resolves via the
// "stage3Prompt" role (lib/models.ts) — selectable in Settings. The 8-template
// JSON occasionally needs the 3× retry + jsonrepair regardless of model.

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
- (Optionally) additional reference images the operator wants considered for scene/background/style

ADDITIONAL REFERENCE IMAGES (optional): if extra references are attached, they show a scene, background, or style to aim for. The product still comes ONLY from the source product images — never from the extras. You MAY include an extra reference's exact URL in source_image_references if you want Higgsfield to match that scene/background; otherwise source_image_references is the source product images only.

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

ADDITIONAL REFERENCE IMAGES (optional — may be none):
Besides the approved hero, the operator may attach extra reference images: a desired scene, setting, background, style, prop, or model/person. These are NOT the product — the hero is always the product reference. For EACH prompt, judge which (if any) of these extras genuinely help Higgsfield render THAT specific image (for example a living-room photo for a lifestyle shot, or a hand/skin reference for a UGC shot), and put the exact URLs of the ones that fit into that prompt's source_image_references, ALONGSIDE the hero URL. Attach an extra only where it clearly helps; if none fit an image, that prompt's source_image_references is just the hero. Use the exact URLs provided — never invent a URL.

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
  // Cap vision at 5 images; callers order base/product refs first so extras
  // only get dropped when there are already plenty of product references.
  const seen = new Set<string>()
  return urls.filter((u) => u && !seen.has(u) && seen.add(u)).slice(0, 5)
    .map((u) => ({ type: 'image', source: { type: 'url', url: u } }))
}

// Final source_image_references for one prompt: the base/product refs are ALWAYS
// kept; on top of that we keep only the extra refs the model actually chose AND
// that belong to the known pool — so a hallucinated or product-substituting URL
// can never slip into what we send to Higgsfield.
function curateRefs(base: string[], chosen: unknown, pool: string[]): string[] {
  const allowed = new Set(pool)
  const picks = Array.isArray(chosen)
    ? chosen.filter((u): u is string => typeof u === 'string' && allowed.has(u))
    : []
  return Array.from(new Set([...base.filter(Boolean), ...picks]))
}

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
}

/** Phase 1 — generate the single hero prompt from the source product photos. */
export async function generateHeroPrompt(params: {
  onePager: string
  sourceImageUrls: string[]
  /** Optional extra reference images the operator added — scene/background/style
   *  references. The product still comes only from the source photos. */
  extraReferenceUrls?: string[]
}): Promise<HeroPrompt> {
  const extras = (params.extraReferenceUrls ?? []).filter(Boolean)
  const userText = [
    'STAGE 1 ONE-PAGER (product name + category only):',
    params.onePager || '(none)',
    '',
    `SOURCE PRODUCT IMAGE URLS (${params.sourceImageUrls.length}) — the product comes ONLY from these: ${params.sourceImageUrls.join(', ')}`,
    ...(extras.length ? ['', `ADDITIONAL REFERENCE IMAGES (${extras.length}) — optional scene/background/style references; put a URL in source_image_references only if you want Higgsfield to match that scene: ${extras.join(', ')}`] : []),
    '',
    'Generate the hero prompt JSON now. The images are attached below.',
  ].join('\n')

  // Retry the call + parse up to 3 times — transient API failures and the odd
  // malformed-JSON response both recover on a fresh attempt (mirrors the
  // remaining-prompts loop).
  let parsed: HeroPrompt | null = null
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 3 && !parsed; attempt++) {
    try {
      const msg = await anthropic.messages.create({
        model: await getModel('stage3Prompt'),
        max_tokens: 2000,
        system: [{ type: 'text', text: HERO_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: [{ type: 'text', text: userText }, ...imageBlocks([...params.sourceImageUrls, ...extras])] }],
      })
      const raw = stripFences(msg.content.find((b) => b.type === 'text')?.text ?? '')
      try { parsed = JSON.parse(raw) } catch { parsed = JSON.parse(jsonrepair(raw)) }
    } catch (err) {
      lastErr = err
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
    }
  }
  if (!parsed) {
    throw new Error(`Hero prompt generation failed after 3 attempts: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`)
  }

  return {
    model: parsed.model || 'nano_banana_2',
    aspect_ratio: parsed.aspect_ratio || '1:1',
    prompt: parsed.prompt || '',
    // Source product images always; plus any extra scene refs the model chose
    // (validated against the known pool so placeholders can't slip in).
    source_image_references: curateRefs(params.sourceImageUrls, parsed.source_image_references, [...params.sourceImageUrls, ...extras]),
  }
}

/** Phase 2 — generate the 8 derivative prompts that reference the approved hero. */
export async function generateRemainingPrompts(params: {
  onePager: string
  copy: string
  avatar: string
  visual: string
  /** The image(s) every derivative prompt references for product appearance:
   *  the approved hero (1), or the source product photos when the hero step is
   *  skipped. */
  referenceImageUrls: string[]
  /** Optional extra reference images the operator added during Stage 3. The
   *  model sees them and decides, per image, which (if any) to attach to that
   *  prompt's source_image_references — i.e. what gets sent to Higgsfield. */
  extraReferenceUrls?: string[]
  fromSource?: boolean
}): Promise<RemainingPrompt[]> {
  const refs = params.referenceImageUrls.filter(Boolean)
  const extras = (params.extraReferenceUrls ?? []).filter(Boolean)
  const refLine = params.fromSource
    ? `SOURCE PRODUCT IMAGE URLS (${refs.length}) — these are the reference for all 8; render the product exactly as shown: ${refs.join(', ')}`
    : `APPROVED HERO IMAGE URL (reference for all 8): ${refs[0] ?? ''}`
  const tail = params.fromSource
    ? 'Generate the 8 prompts JSON array now. The source product photos are attached below — every prompt references them so the real product stays consistent (there is no separate hero shot).'
    : 'Generate the 8 prompts JSON array now. The approved hero image is attached below — every prompt references it.'
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
    refLine,
    ...(extras.length ? ['', `ADDITIONAL REFERENCE IMAGES (${extras.length}) — optional. For EACH prompt, include in its source_image_references the exact URLs of the ones that genuinely fit THAT image's scene/style/context (alongside the ${params.fromSource ? 'product photos' : 'hero'}). Omit any that don't fit; if none fit, source_image_references is just the ${params.fromSource ? 'product photos' : 'hero'}. Never invent a URL: ${extras.join(', ')}`] : []),
    '',
    tail,
  ].join('\n')

  // The model occasionally emits slightly malformed JSON (a stray token, an
  // unescaped quote, or prose around the array). Extract the array, try a
  // strict parse then a repair, and retry the whole call a couple of times
  // before giving up — much more robust than a single parse attempt.
  let arr: RemainingPrompt[] | null = null
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 3 && !arr; attempt++) {
    const msg = await anthropic.messages.create({
      model: await getModel('stage3Prompt'),
      max_tokens: 16000,
      system: [{ type: 'text', text: REMAINING_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: [{ type: 'text', text: userText }, ...imageBlocks([...refs, ...extras])] }],
    })
    const raw = stripFences(msg.content.find((b) => b.type === 'text')?.text ?? '')
    // Isolate the JSON array even if the model wrapped it in prose.
    const start = raw.indexOf('[')
    const end = raw.lastIndexOf(']')
    const slice = start !== -1 && end > start ? raw.slice(start, end + 1) : raw
    try {
      const parsed = JSON.parse(slice)
      if (Array.isArray(parsed)) arr = parsed
    } catch {
      try {
        const repaired = JSON.parse(jsonrepair(slice))
        if (Array.isArray(repaired)) arr = repaired
      } catch (e) { lastErr = e }
    }
  }
  if (!arr) throw new Error(`Remaining prompts did not parse to an array${lastErr ? `: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}` : ''}`)

  // Normalize + always pin the reference image(s) every prompt was built around.
  return arr.slice(0, 8).map((p, i) => ({
    index: typeof p.index === 'number' ? p.index : i + 2,
    image_type: p.image_type || '',
    category: p.category || '',
    model: p.model === 'gpt_image_2' ? 'gpt_image_2' : 'nano_banana_2',
    aspect_ratio: p.aspect_ratio || '1:1',
    prompt: p.prompt || '',
    german_text: p.german_text || '',
    // Hero/product refs always; plus only the extra refs the model chose for
    // this image (validated against the pool so nothing hallucinated slips in).
    source_image_references: curateRefs(refs, p.source_image_references, [...refs, ...extras]),
  }))
}
