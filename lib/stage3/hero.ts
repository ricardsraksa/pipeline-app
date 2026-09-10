import Anthropic from '@anthropic-ai/sdk'
import { jsonrepair } from 'jsonrepair'
import { getModel, modelSupportsSamplingParams } from '@/lib/models'
import { recordUsage } from '@/lib/db'
import { validateHeroObject, validateRemainingArray, type Stage3Validation } from '@/lib/stage3-validation'
import { getPrompt } from '@/lib/prompts'

// Hero-first Stage 3 prompt generation.
//
// Phase 1: ONE hero studio prompt generated from the SOURCE product photos.
// Phase 2: 8 derivative prompts that reference the APPROVED HERO image.
//
// Both system prompts are the TESTED versions (validated against Sonnet 4.6,
// Opus 4.8, Haiku 4.5 across multiple products) — do not rephrase or "improve"
// them. Output format is checked by lib/stage3-validation; a failing output
// gets exactly ONE regeneration attempt with the validation errors appended.
// Validation informs the QC gates, it never blocks them.

// timeout: a hung prompt-writing call fails within 2 min instead of the SDK's
// 10-min default — the route-level maxDuration would otherwise cut it off with
// no useful error.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 120_000 })
// Stage 3 prompt writing (hero + the 8 derivatives) resolves via the
// "stage3Prompt" role (lib/models.ts) — selectable in Settings.

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
  /** Page section this image was authored to sit beside (2 or 3); null for
   *  gallery images. Auto-placement uses it as the default pick. */
  intended_section?: 2 | 3 | null
}

/** Section 2 / Section 3 headline+paragraph from a run's stage2_json — what the
 *  Section n Photo sits next to on the page (lib/shopify/fields.ts). */
export function pageSectionsFromStage2Json(raw: string | null | undefined): Array<{ n: 2 | 3; headline: string; paragraph: string }> {
  try {
    const j = raw ? (JSON.parse(raw) as { sections?: Array<{ headline?: string; paragraph?: string }> }) : null
    return ([2, 3] as const)
      .map((n) => ({ n, headline: (j?.sections?.[n - 1]?.headline ?? '').trim(), paragraph: (j?.sections?.[n - 1]?.paragraph ?? '').trim() }))
      .filter((s) => s.headline || s.paragraph)
  } catch { return [] }
}

export const HERO_SYSTEM = `You are a product photography director. Generate ONE hero studio product image prompt for Higgsfield, using the source product images as the visual reference.

BRAND SAFETY: No brand logos, brand names, trademarks, or recognizable branded products may appear anywhere in the image — the only exception is branding physically present on the product itself in the source photos. The prompt's NEGATIVE RULES must forbid logos, brand names, and branded props explicitly.

Your output prompt MUST follow the exact section structure, ordering, tone, and rule style of the GOLD STANDARD EXAMPLE below. Same section headers, same level of detail, same phrasing patterns. Only the product-specific content changes.

========================================================================
GOLD STANDARD EXAMPLE — your output must match this format exactly
========================================================================

IMAGE TYPE:
Hero image

OBJECTIVE:
Create a clean premium product-first studio image for ThawFast Defrosting Board, showing it as an aluminium kitchen defrosting board for conveniently thawing frozen meat, poultry, fish, and other frozen foods without electricity, hot water, or a microwave.

PRODUCT CONTEXT:
Product name: ThawFast Defrosting Board.
Product category: Aluminium kitchen defrosting board for frozen meat and other frozen foods.
The product is a compact aluminium kitchen board designed to help speed up the passive defrosting of frozen meat, poultry, fish, and other frozen foods without using electricity, hot water, or a microwave. The aluminium surface conducts ambient heat and transfers it to frozen food placed on top, supporting a faster and more convenient thawing process than leaving food on a conventional plate or non-conductive surface. It is designed to help speed up passive defrosting, provide a simple hands-free thawing method, and offer a compact alternative to microwave defrosting. Key visible or functional features include aluminium construction, a 23 × 16.5 cm surface, an ultra-slim 0.2 cm profile, a flat-board design, and operation without any power source.

SCENE INSTRUCTIONS:
Place the product in a clean, bright studio setting with a soft warm-neutral background. Use subtle category-relevant styling cues such as one realistically frozen steak, a folded kitchen cloth, and a few understated fresh cooking ingredients placed around the outer edges of the composition, but keep the product dominant. The scene should feel modern, calm, clean, and suitable for an ecommerce product page. Show the board clearly without over-staging. The frozen steak may rest naturally on the board to immediately communicate the use case.

PRODUCT PLACEMENT:
Position ThawFast Defrosting Board slightly angled in the center of the frame, with its flat rectangular aluminium surface, compact 23 × 16.5 cm proportions, and ultra-slim 0.2 cm edge profile clearly visible. If a frozen steak is naturally placed on top, include it without hiding too much of the board. The product should occupy the main visual focus and appear realistic in scale.

BENEFIT TO COMMUNICATE:
Helps make passive defrosting of frozen food faster and more convenient without electricity, hot water, or a microwave.

TEXT OVERLAY:
No embedded text preferred.
Optional English overlay suggestions if text is added later:
"Helps Speed Up Defrosting"
"No Power Required"
"Simple Everyday Thawing"

STYLE / CAMERA:
Premium ecommerce studio photography, clean composition, soft diffused lighting, realistic shadows, sharp focus, high detail, 1:1 aspect ratio. Camera angle: slightly elevated three-quarter product angle that clearly reveals both the broad aluminium surface and ultra-slim edge profile. Natural color grading, no excessive effects.

PRODUCT FIDELITY RULES:
Preserve the exact product category as an aluminium kitchen defrosting board. Preserve the flat rectangular silhouette, realistic 23 × 16.5 cm proportions, ultra-slim 0.2 cm profile, aluminium material, actual source-observed color and finish, surface appearance, edges, and all visible functional details. Do not redesign the product, turn it into a cutting board, serving tray, warming plate, appliance, grill, hot plate, or another product category. Do not add unsupported handles, grooves, drainage channels, feet, trays, heating elements, cables, batteries, buttons, ports, lights, screens, logos, labels, accessories, packaging, or decorative mechanisms. Do not remove supported visible parts or alter the scale unrealistically. Do not make the product look more medical, luxury, industrial, futuristic, or complex than supported.

NEGATIVE RULES:
Avoid distorted proportions, warped geometry, inaccurate rectangular shape, wrong product category, extra parts, missing parts, incorrect 23 × 16.5 × 0.2 cm proportions, incorrect scale, incorrect colors or materials, invented features, unrealistic food thawing effects, steam, glowing heat effects, electrical elements, cluttered composition, unreadable text, excessive text, fake UI overlays, non-English image text, mixed-language image text, and unsupported medical, hygiene, food-safety, waterproof, clinical, guaranteed-effectiveness, or guaranteed-speed claims.

OUTPUT FORMAT:
Square 1:1 ecommerce-ready image, high-resolution, clean product-first composition.

========================================================================
END GOLD STANDARD EXAMPLE
========================================================================

HOW TO FILL EACH SECTION FOR THE ACTUAL PRODUCT:

IMAGE TYPE: Always "Hero image" for this call.

OBJECTIVE: One sentence: "Create a clean premium product-first studio image for [PRODUCT_NAME], showing it as [plain description of what it is and its core function]." Pull from the Stage 1 one-pager.

PRODUCT CONTEXT: Product name line, product category line, then 3-5 sentences describing what the product is, how it works mechanically, and what it is designed to do. Close with one sentence listing key visible or functional features including real dimensions and specs where the Stage 1 inputs provide them. State only facts from Stage 1 or visible in source images. Never invent specs, materials, or features.

SCENE INSTRUCTIONS: Clean bright studio setting with a soft warm-neutral background. Choose 2-3 subtle, category-relevant props that communicate the use case (the way the frozen steak does for the defrosting board), placed at the outer edges, product dominant. Keep the sentence patterns of the example: modern, calm, clean, suitable for an ecommerce product page, no over-staging.

PRODUCT PLACEMENT: Product slightly angled in the center of the frame, main defining physical characteristics visible (name them, using dimensions where known), main visual focus, realistic in scale. If a prop interacts with the product, include it without hiding too much of the product.

BENEFIT TO COMMUNICATE: Select the single strongest benefit (Benefit 1 in the Stage 1 Benefits list, unless the OBJECTIVE already names a different core function). The line may contain ONLY that benefit and its direct mechanism. It must not mention any other benefit, any material property, or any feature — no hygiene, cleaning, noise, capacity, or durability mention unless that IS the selected benefit. No "with", "that", "while", or comma tails adding information. Use softened claim language ("helps..."), never guaranteed-outcome language.

TEXT OVERLAY: Always exactly: "No embedded text preferred." followed by "Optional English overlay suggestions if text is added later:" and 3 short title-case overlay lines (2-4 words each) drawn from Stage 1/2 benefits, in quotation marks. Overlay lines must be flat, functional benefit statements like the gold standard's "No Power Required" — never slogans, wordplay, or cute phrasing. "Hygienic Stainless Steel" is right; "Flowing Water, Happy Cat" is WRONG (slogan-cute). Softened claim language only ("Helps Speed Up Defrosting" not "Defrosts 5x Faster").

STYLE / CAMERA: Keep the example's exact pattern: "Premium ecommerce studio photography, clean composition, soft diffused lighting, realistic shadows, sharp focus, high detail, 1:1 aspect ratio. Camera angle: [pick the angle that best reveals this product's defining features]. Natural color grading, no excessive effects."

PRODUCT FIDELITY RULES: Follow the example's structure exactly, adapted to this product:
1. "Preserve the exact product category as [category]."
2. "Preserve [the product's silhouette, real dimensions/proportions, material, actual source-observed color and finish, surface appearance, edges, and all visible functional details]."
3. "Do not redesign the product, turn it into [4-7 adjacent product categories AI could confuse it with], or another product category."
4. "Do not add unsupported [8-15 specific parts/features AI commonly adds to this product type: handles, grooves, feet, trays, heating elements, cables, batteries, buttons, ports, lights, screens, logos, labels, accessories, packaging, decorative mechanisms — adapt the list to the product]."
5. "Do not remove supported visible parts or alter the scale unrealistically."
6. "Do not make the product look more medical, luxury, industrial, futuristic, or complex than supported."
Appearance authority: the source images are ground truth. Use "actual source-observed color and finish" phrasing — never invent finishes or colors in words.

NEGATIVE RULES: One continuous "Avoid..." sentence following the example's pattern, covering: distorted proportions, warped geometry, inaccurate [shape], wrong product category, extra parts, missing parts, incorrect [real dimensions] proportions, incorrect scale, incorrect colors or materials, invented features, [2-4 product-specific unrealistic effects, like the steam/glowing-heat items], cluttered composition, unreadable text, excessive text, fake UI overlays, non-English image text, mixed-language image text, and unsupported medical, hygiene, food-safety, waterproof, clinical, guaranteed-effectiveness, or guaranteed-speed claims (adapt the claim list to the category: pet products get vet-approved/health claims, kids products get safety/dentist claims, etc).

OUTPUT FORMAT: Always exactly: "Square 1:1 ecommerce-ready image, high-resolution, clean product-first composition."

INPUTS YOU RECEIVE:
- Stage 1 one-pager (product name, category, positioning angle, benefits, USPs, dimensions where present)
- Stage 2 English copy (for overlay suggestion language)
- Source product image URLs

OUTPUT: A single JSON object, nothing before or after, no markdown fences:
{
  "model": "gpt_image_2",
  "aspect_ratio": "1:1",
  "prompt": "<the full hero prompt in the exact gold-standard format, sections separated by blank lines>",
  "source_image_references": ["<all source image URLs>"]
}`

export { REMAINING_SYSTEM } from '@/lib/prompts/remaining_images'
import { REMAINING_SYSTEM } from '@/lib/prompts/remaining_images'
import { buildStage3FeedbackBlock } from '@/lib/feedback'

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

// Forced tool calls. Claude reliably mis-escapes the gold-standard prompt text
// (full of quotation marks) when hand-writing JSON as free text, which breaks
// JSON.parse — especially the 8-object array, where one bad quote fails all 8.
// Routing the output through a tool call hands structure to the API's own JSON
// serialisation, so the result is always well-formed regardless of punctuation.
// (Same technique the legacy app/api/stage3/prompts route uses.)
const HERO_TOOL: Anthropic.Tool = {
  name: 'submit_hero_prompt',
  description: 'Submit the single hero image prompt.',
  input_schema: {
    type: 'object',
    properties: {
      model: { type: 'string' },
      aspect_ratio: { type: 'string' },
      prompt: { type: 'string', description: 'The full hero prompt in the exact gold-standard format.' },
      source_image_references: { type: 'array', items: { type: 'string' } },
    },
    required: ['model', 'aspect_ratio', 'prompt', 'source_image_references'],
  },
}

const REMAINING_TOOL: Anthropic.Tool = {
  name: 'submit_image_prompts',
  description: 'Submit the 8 derivative image prompt briefs, in order.',
  input_schema: {
    type: 'object',
    properties: {
      prompts: {
        type: 'array',
        description: 'Exactly 8 image prompt objects (indices 2-9), in order.',
        items: {
          type: 'object',
          properties: {
            index: { type: 'number' },
            image_type: { type: 'string' },
            category: { type: 'string' },
            model: { type: 'string' },
            aspect_ratio: { type: 'string' },
            prompt: { type: 'string', description: 'The full prompt in the exact gold-standard format.' },
            overlay_text: { type: 'string' },
            intended_section: { type: ['integer', 'null'], description: 'Page section (2 or 3) this image is authored to sit beside; null for gallery images.' },
            source_image_references: { type: 'array', items: { type: 'string' } },
          },
          required: ['index', 'image_type', 'category', 'model', 'aspect_ratio', 'prompt', 'overlay_text', 'source_image_references'],
        },
      },
    },
    required: ['prompts'],
  },
}

// Higgsfield only knows these two generators; anything else the model emits
// would fail the generation call outright, so coerce to the spec default.
// Validation runs on the RAW output first, so a wrong model is still reported.
function knownModel(m: unknown): string {
  return m === 'nano_banana_2' || m === 'gpt_image_2' ? m : 'gpt_image_2'
}

// The one permitted validation retry appends the errors to the user message.
function validationFeedback(userText: string, errors: string[]): string {
  return userText
    + '\n\nYOUR PREVIOUS OUTPUT FAILED VALIDATION WITH THESE ERRORS:\n'
    + errors.join('\n')
    + '\nRegenerate the full output fixing every error. Same format requirements apply.'
}

/** Phase 1 — generate the single hero prompt from the source product photos. */
export async function generateHeroPrompt(params: {
  onePager: string
  /** Stage 2 English copy — the overlay suggestion language. */
  copy: string
  /** The positioning angle the operator chose (lib/angles.ts angleBlock). */
  angle?: string
  sourceImageUrls: string[]
  /** Optional extra reference images the operator added — scene/background/style
   *  references. The product still comes only from the source photos. */
  extraReferenceUrls?: string[]
  /** Run to attribute API token usage to in the cost tracker. */
  runId?: number
}): Promise<{ hero: HeroPrompt; validation: Stage3Validation }> {
  const extras = (params.extraReferenceUrls ?? []).filter(Boolean)
  const userText = [
    ...(params.angle ? ['POSITIONING ANGLE (chosen by the operator — the hero must communicate THIS problem and its solution, not a generic product shot):', params.angle, ''] : []),
    'STAGE 1 ONE-PAGER (product name, category, positioning angle, benefits, USPs, dimensions where present):',
    params.onePager || '(none)',
    '',
    'STAGE 2 ENGLISH COPY (for overlay suggestion language):',
    params.copy || '(none)',
    '',
    `SOURCE PRODUCT IMAGE URLS (${params.sourceImageUrls.length}) — the product comes ONLY from these: ${params.sourceImageUrls.join(', ')}`,
    ...(extras.length ? ['', `ADDITIONAL REFERENCE IMAGES (${extras.length}) — optional scene/background/style references; put a URL in source_image_references only if you want Higgsfield to match that scene: ${extras.join(', ')}`] : []),
    '',
    'Generate the hero prompt JSON now. The images are attached below.',
  ].join('\n')

  const attachments = imageBlocks([...params.sourceImageUrls, ...extras])
  const model = await getModel('stage3Prompt')

  async function callOnce(text: string): Promise<HeroPrompt> {
    const msg = await anthropic.messages.stream({
      model,
      max_tokens: 16000,
      // temperature:0 for run-to-run determinism, but only on models that still
      // accept sampling params — the newer tier (Fable 5, Opus 4.8, …) 400s on it.
      ...(modelSupportsSamplingParams(model) ? { temperature: 0 } : {}),
      system: [{ type: 'text', text: HERO_SYSTEM + (await buildStage3FeedbackBlock().catch(() => '')), cache_control: { type: 'ephemeral', ttl: '1h' } }],
      messages: [{ role: 'user', content: [{ type: 'text', text }, ...attachments] }],
      // Forced tool call → the API serialises the JSON, so quote-heavy prompt
      // text can never break parsing (see HERO_TOOL).
      tools: [HERO_TOOL],
      tool_choice: { type: 'tool', name: 'submit_hero_prompt' },
    }).finalMessage()
    void recordUsage(params.runId ?? null, 'stage3: hero prompt', model, msg.usage)
    const toolUse = msg.content.find((b) => b.type === 'tool_use')
    if (!toolUse || toolUse.type !== 'tool_use') throw new Error('model did not return a hero prompt tool call')
    return toolUse.input as HeroPrompt
  }

  // First result: retry transient API/parse failures up to 3 times (unchanged
  // robustness mechanic — this is NOT the validation retry).
  let parsed: HeroPrompt | null = null
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 3 && !parsed; attempt++) {
    try { parsed = await callOnce(userText) } catch (err) {
      lastErr = err
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
    }
  }
  if (!parsed) {
    throw new Error(`Hero prompt generation failed after 3 attempts: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`)
  }

  // Format validation with exactly ONE feedback retry. Failure never blocks —
  // the errors are returned for the run record and the QC gate badge.
  let validation: Stage3Validation
  const firstErrors = validateHeroObject(parsed)
  if (firstErrors.length === 0) {
    validation = { passed: true }
  } else {
    try {
      const retried = await callOnce(validationFeedback(userText, firstErrors))
      const retryErrors = validateHeroObject(retried)
      parsed = retried // latest output wins either way; errors are reported
      validation = retryErrors.length === 0
        ? { passed: true, retried: true }
        : { passed: false, errors: retryErrors, retried: true }
    } catch {
      // Retry call itself died — keep the first output and its errors.
      validation = { passed: false, errors: firstErrors, retried: true }
    }
  }

  const hero: HeroPrompt = {
    model: knownModel(parsed.model),
    aspect_ratio: parsed.aspect_ratio || '1:1',
    prompt: parsed.prompt || '',
    // Source product images always; plus any extra scene refs the model chose
    // (validated against the known pool so placeholders can't slip in).
    source_image_references: curateRefs(params.sourceImageUrls, parsed.source_image_references, [...params.sourceImageUrls, ...extras]),
  }
  return { hero, validation }
}

/** Phase 2 — generate the 8 derivative prompts that reference the approved hero. */
/**
 * Slice the combined Stage 1 research doc down to the visual-strategy section
 * (the part the remaining-prompts writer actually uses as its "visual" input).
 * The full doc is identify+market+competitive+analysis+visual — tens of
 * thousands of chars that were previously shipped whole into a 32k-max-token
 * call. Falls back to the full doc if the section header isn't found.
 */
export function extractVisualSection(researchDoc: string): string {
  const m = researchDoc.match(/^\s*9\.\s*WINNING BRAND IMAGE/im)
  if (m && typeof m.index === 'number') return researchDoc.slice(m.index)
  const alt = researchDoc.search(/WINNING BRAND IMAGE STRATEGY/i)
  if (alt >= 0) return researchDoc.slice(alt)
  return researchDoc
}

export async function generateRemainingPrompts(params: {
  onePager: string
  copy: string
  /** The positioning angle the operator chose (lib/angles.ts angleBlock). */
  angle?: string
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
  /** Source product photos (hero path only) — they can show product states the
   *  hero doesn't (closed, folded, packed), so per-image prompts may reference
   *  them when a scene needs that state. */
  sourceImageUrls?: string[]
  fromSource?: boolean
  /** Run to attribute API token usage to in the cost tracker. */
  runId?: number
  /** Section 2/3 headline+paragraph (pageSectionsFromStage2Json) — the writer
   *  authors one image for each and marks it via intended_section. */
  sections?: Array<{ n: 2 | 3; headline: string; paragraph: string }>
}): Promise<{ prompts: RemainingPrompt[]; validation: Stage3Validation }> {
  const refs = params.referenceImageUrls.filter(Boolean)
  const extras = (params.extraReferenceUrls ?? []).filter(Boolean)
  // State refs only make sense on the hero path — on skip-hero the sources ARE
  // the main references already.
  const stateRefs = params.fromSource ? [] : (params.sourceImageUrls ?? []).filter(Boolean).filter((u) => !refs.includes(u))
  const refLine = params.fromSource
    ? `SOURCE PRODUCT IMAGE URLS (${refs.length}) — these are the reference for all 8; render the product exactly as shown: ${refs.join(', ')}`
    : `APPROVED HERO IMAGE URL (reference for all 8): ${refs[0] ?? ''}`
  const tail = params.fromSource
    ? 'Generate the 8 prompts JSON array now. The source product photos are attached below — every prompt references them so the real product stays consistent (there is no separate hero shot).'
    : 'Generate the 8 prompts JSON array now. The approved hero image is attached below — every prompt references it.'
  const userText = [
    ...(params.angle ? ['POSITIONING ANGLE (chosen by the operator — the set of images tells THIS problem → consequence → mechanism story; the problem/comparison/lifestyle images show this specific problem, not a generic one):', params.angle, ''] : []),
    'STAGE 1 ONE-PAGER:',
    params.onePager || '(none)',
    '',
    'STAGE 2 COPY (use overlays verbatim):',
    params.copy || '(none)',
    '',
    ...(params.sections?.length
      ? [
          'PAGE SECTIONS (author exactly one image for each, mark it with intended_section):',
          ...params.sections.flatMap((s) => [`SECTION ${s.n} — HEADLINE: ${s.headline || '(none)'}`, `SECTION ${s.n} — PARAGRAPH: ${s.paragraph || '(none)'}`]),
          '',
        ]
      : []),
    'STAGE 1 AVATAR + VISUAL STRATEGY:',
    [params.avatar, params.visual].filter(Boolean).join('\n\n') || '(none)',
    '',
    refLine,
    ...(stateRefs.length ? ['', `SOURCE PRODUCT PHOTOS (${stateRefs.length}) — these may show the product in OTHER STATES than the hero (closed, folded, packed). If a scene needs one of those states, put the matching URL(s) in that image's source_image_references per the PRODUCT STATES rule: ${stateRefs.join(', ')}`] : []),
    ...(extras.length ? ['', `ADDITIONAL REFERENCE IMAGES (${extras.length}) — optional. For EACH prompt, include in its source_image_references the exact URLs of the ones that genuinely fit THAT image's scene/style/context (alongside the ${params.fromSource ? 'product photos' : 'hero'}). Omit any that don't fit; if none fit, source_image_references is just the ${params.fromSource ? 'product photos' : 'hero'}. Never invent a URL: ${extras.join(', ')}`] : []),
    '',
    tail,
  ].join('\n')

  const attachments = imageBlocks([...refs, ...stateRefs, ...extras])
  const model = await getModel('stage3Prompt')
  // Settings → "Stage 4 — Images" now drives this writer. A saved override that
  // predates the 8-image flow (the retired page's 9-prompt text) would break
  // generation, so an override is only used when it states the same contract.
  const remainingSystem = await (async () => {
    try {
      const saved = await getPrompt('stage3')
      if (saved && /exactly 8 objects/i.test(saved)) return saved
      if (saved && saved.trim() !== REMAINING_SYSTEM.trim()) {
        console.warn('[stage3] ignoring the saved Stage 4 prompt — it does not ask for exactly 8 prompts')
      }
    } catch { /* fall through to the built-in */ }
    return REMAINING_SYSTEM
  })()
  // Thumbs on past images, the same soft-hint treatment Research and Copy get.
  // This was collected and only ever read by the retired standalone page.
  const imageFeedback = await buildStage3FeedbackBlock().catch(() => '')

  async function callOnce(text: string): Promise<RemainingPrompt[] | null> {
    // Forced tool call → the API serialises the 8-object array, so quote-heavy
    // prompt text can't break parsing (the whole point — see REMAINING_TOOL).
    // Streaming + a generous budget: 8 full gold-standard prompts are large, and
    // the SDK requires streaming above ~16k max_tokens; finalMessage() collects it.
    const msg = await anthropic.messages
      .stream({
        model,
        max_tokens: 32000,
        // temperature:0 for determinism, but only on models that still accept
        // sampling params — the newer tier (Fable 5, Opus 4.8, …) 400s on it.
        ...(modelSupportsSamplingParams(model) ? { temperature: 0 } : {}),
        system: [{ type: 'text', text: remainingSystem + imageFeedback, cache_control: { type: 'ephemeral', ttl: '1h' } }],
        messages: [{ role: 'user', content: [{ type: 'text', text }, ...attachments] }],
        tools: [REMAINING_TOOL],
        tool_choice: { type: 'tool', name: 'submit_image_prompts' },
      })
      .finalMessage()
    void recordUsage(params.runId ?? null, 'stage3: remaining prompts', model, msg.usage)
    if (msg.stop_reason === 'max_tokens') return null // truncated — retry
    const toolUse = msg.content.find((b) => b.type === 'tool_use')
    if (!toolUse || toolUse.type !== 'tool_use') return null
    // Usually a proper array; on very large payloads Claude occasionally emits a
    // stringified array in the tool input — repair + parse that fallback.
    const rawPrompts = (toolUse.input as { prompts?: unknown }).prompts
    if (Array.isArray(rawPrompts)) return rawPrompts as RemainingPrompt[]
    if (typeof rawPrompts === 'string') {
      const repaired = JSON.parse(jsonrepair(rawPrompts))
      return Array.isArray(repaired) ? repaired : null
    }
    return null
  }

  // First result: retry transient API/parse failures up to 3 times (unchanged
  // robustness mechanic — this is NOT the validation retry).
  let arr: RemainingPrompt[] | null = null
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 3 && !arr; attempt++) {
    try { arr = await callOnce(userText) } catch (e) { lastErr = e }
  }
  if (!arr) throw new Error(`Remaining prompts did not parse to an array${lastErr ? `: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}` : ''}`)

  // Format validation with exactly ONE feedback retry (never blocks the gate).
  let validation: Stage3Validation
  const firstErrors = validateRemainingArray(arr)
  if (firstErrors.length === 0) {
    validation = { passed: true }
  } else {
    try {
      const retried = await callOnce(validationFeedback(userText, firstErrors))
      if (retried) {
        const retryErrors = validateRemainingArray(retried)
        arr = retried // latest output wins either way; errors are reported
        validation = retryErrors.length === 0
          ? { passed: true, retried: true }
          : { passed: false, errors: retryErrors, retried: true }
      } else {
        validation = { passed: false, errors: firstErrors, retried: true }
      }
    } catch {
      validation = { passed: false, errors: firstErrors, retried: true }
    }
  }

  // Normalize + always pin the reference image(s) every prompt was built around.
  const prompts = arr.slice(0, 8).map((p, i) => ({
    index: typeof p.index === 'number' ? p.index : i + 2,
    image_type: p.image_type || '',
    category: p.category || '',
    model: knownModel(p.model),
    aspect_ratio: p.aspect_ratio || '1:1',
    prompt: p.prompt || '',
    overlay_text: p.overlay_text || '',
    intended_section: p.intended_section === 2 || p.intended_section === 3 ? p.intended_section : null,
    // Hero/product refs always; plus only the extra refs the model chose for
    // this image (validated against the pool so nothing hallucinated slips in).
    source_image_references: curateRefs(refs, p.source_image_references, [...refs, ...extras]),
  }))
  return { prompts, validation }
}
