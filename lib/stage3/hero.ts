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
  overlay_text: string
  source_image_references: string[]
}

const HERO_SYSTEM = `You are a product photography director. Generate ONE hero studio product image prompt for Higgsfield, using the source product images as the visual reference.

CRITICAL FIDELITY RULE:
The source images are the ground truth for what the product looks like. You MAY name the product category, its core function, and its key dimensions/specs where those are factually given in the Stage 1 inputs (this helps scale and staging). But you must NOT invent or embellish appearance details — no invented finishes, colors, textures, handles, grooves, or parts. When it comes to the actual look of the product (exact shape nuances, finish, edges, proportions), the reference image decides, not your words. Anywhere appearance could drift, defer to the reference image explicitly. Never describe a "premium" or idealized version — describe the real product in the reference, placed in a scene.

You will receive:
- Stage 1 one-pager (product name, category, benefits, USPs, dimensions if present)
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

The prompt must follow this exact section structure (fill each section from the Stage 1 inputs; keep the fidelity and negative sections deferring to the reference image):

"IMAGE TYPE:
Hero image

OBJECTIVE:
Create a clean premium product-first studio image for [PRODUCT_NAME], showing it as [one-line plain description of what it is and what it's for, from Stage 1].

PRODUCT CONTEXT:
Product name: [PRODUCT_NAME].
Product category: [category].
[2-4 sentences on what the product is and does, drawn from Stage 1. You may state factual given specs and dimensions here. Do NOT invent appearance details not supported by the source images or Stage 1.]

SCENE INSTRUCTIONS:
Place the product in a clean, bright studio setting with a soft warm-neutral background. Use subtle, category-relevant styling cues placed around the outer edges of the composition, but keep the product dominant. The scene should feel modern, calm, clean, and suitable for an ecommerce product page. Show the product clearly without over-staging. [Add one or two product-appropriate props that communicate the use case, if helpful.]

PRODUCT PLACEMENT:
Position [PRODUCT_NAME] slightly angled in the center of the frame, main visual focus, realistic in scale. Reproduce the product exactly as it appears in the reference image. Do not hide its defining parts.

BENEFIT TO COMMUNICATE:
[One line — the core benefit from Stage 1.]

TEXT OVERLAY:
No embedded text preferred.
Optional English overlay suggestions if text is added later:
[2-3 short English overlay lines drawn from Stage 1/2, only if useful.]

STYLE / CAMERA:
Premium ecommerce studio photography, clean composition, soft diffused lighting, realistic shadows, sharp focus, high detail, 1:1 aspect ratio. Camera angle: slightly elevated three-quarter product angle that clearly reveals the product's form. Natural color grading, no excessive effects.

PRODUCT FIDELITY RULES:
Reproduce the exact product shown in the reference image — same shape, proportions, material, finish, color, edges, and all visible details. The reference image is the ground truth for appearance. Preserve the correct product category. Do not redesign the product or turn it into a different product category. Do not add unsupported parts such as handles, grooves, feet, trays, cables, batteries, buttons, ports, lights, screens, logos, labels, or decorative mechanisms that are not in the reference image. Do not remove visible parts. Do not make the product look more medical, luxury, industrial, futuristic, or complex than the reference shows. Do not substitute a generic or idealized version.

NEGATIVE RULES:
Avoid distorted proportions, warped geometry, wrong product category, extra parts, missing parts, incorrect scale, incorrect colors or materials, invented features, a generic premium substitute in place of the real product, cluttered composition, unrealistic effects, steam or glowing heat effects unless in the source, fake UI overlays, unreadable text, excessive text, non-English image text, mixed-language image text, backdrop seams, and unsupported medical, hygiene, food-safety, waterproof, clinical, guaranteed-effectiveness, or guaranteed-speed claims.

OUTPUT FORMAT:
Square 1:1 ecommerce-ready image, high-resolution, clean product-first composition."

Always use model nano_banana_2 for the hero. Return only the JSON object, no markdown fences.`

const REMAINING_SYSTEM = `You are a creative director generating 8 image prompts for Higgsfield for a DTC product. The product's appearance is locked by an APPROVED HERO IMAGE which will be attached as the reference for every prompt.

CRITICAL FIDELITY RULE:
Do NOT describe the product's appearance in words — not the spout, body, proportions, materials, colors, or features. The approved hero image is the ground truth for appearance. Every prompt you write references the hero image. Your prompts handle ONLY scene, setting, people/animals, lighting, composition, text overlays, and mood — never the product's physical appearance.

When you need to refer to the product in a prompt, call it "the exact product shown in the reference image" — never describe its shape or materials.

INPUTS:
- Stage 1 one-pager (product name, benefits, use cases, USPs)
- Stage 2 English copy (headlines, benefits, FAQs, ad copy)
- Stage 1 avatar and visual strategy
- The approved hero image URL (this is the reference for all 8)

Generate exactly 8 prompts for these templates (indices 2-9):
2 lifestyle, 3 problem_solution, 4 feature_callout, 5 benefit_visualization, 6 before_after, 7 comparison, 8 ugc_native, 9 review_social_proof.

For each prompt:
- Fill scene, setting, lighting, composition from the template
- Use verbatim English text from Stage 2 for any overlays (never invent new claims; use the Stage 2 copy as written)
- Pick the model: nano_banana_2 for realistic photography (2, 5, 8), gpt_image_2 for text/graphic-heavy (3, 4, 6, 7, 9)
- Reference the approved hero image in source_image_references
- Apply the brand aesthetic that fits the product (determine from Stage 1/2 — premium editorial, playful, bold, etc) but keep typography clean: no Alibaba pill badges, no clip-art icons, no drop shadows, mobile-readable English text, no garbled or mixed-language text

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
  "overlay_text": "<verbatim English overlay text from Stage 2 or empty>",
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
    'STAGE 1 ONE-PAGER (product name, category, benefits, USPs, dimensions if present):',
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
        // The section-structured hero prompt is much longer than the old
        // free-form one — give the JSON room so it never truncates mid-prompt.
        max_tokens: 4000,
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
    'STAGE 2 COPY (use overlays verbatim):',
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
    overlay_text: p.overlay_text || '',
    // Hero/product refs always; plus only the extra refs the model chose for
    // this image (validated against the pool so nothing hallucinated slips in).
    source_image_references: curateRefs(refs, p.source_image_references, [...refs, ...extras]),
  }))
}
