import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { buildImagePromptsUserMessage } from '@/lib/prompts/image_prompts'
import { getPrompt } from '@/lib/prompts'
import { buildFeedbackSummary } from '@/lib/stage3/learning'
import { buildStage3FeedbackBlock } from '@/lib/feedback'
import { IMAGE_CATEGORIES } from '@/lib/stage3/categories'
import { jsonrepair } from 'jsonrepair'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Prompt generation streams ~15-20k output tokens — give the route room.
export const maxDuration = 300

// Index → slug, must match the order/categories used everywhere else.
const SLUG_BY_INDEX = IMAGE_CATEGORIES.map(c => c.id)

interface RawPromptObj {
  index?: number
  image_type?: string
  category?: string
  model?: string
  aspect_ratio?: string
  prompt?: string
  german_text?: string
  german_text_used?: string | null
  source_image_references?: unknown
}

// Forced tool call. Claude reliably mis-escapes the German marketing copy
// (full of quotation marks) when hand-writing a ~40 KB JSON array as text,
// which broke JSON.parse. Routing the 9 prompts through a tool call hands the
// structure to the API's own JSON serialisation, so the result is always
// well-formed regardless of the copy's punctuation.
const PROMPTS_TOOL: Anthropic.Tool = {
  name: 'submit_image_prompts',
  description: 'Submit the 9 generated image prompt briefs.',
  input_schema: {
    type: 'object',
    properties: {
      prompts: {
        type: 'array',
        description: 'Exactly 9 image prompt objects, in order.',
        items: {
          type: 'object',
          properties: {
            index: { type: 'number' },
            image_type: { type: 'string' },
            category: { type: 'string' },
            model: { type: 'string' },
            aspect_ratio: { type: 'string' },
            prompt: { type: 'string' },
            german_text: { type: 'string' },
            source_image_references: { type: 'array', items: { type: 'string' } },
          },
          required: [
            'index', 'image_type', 'category', 'model',
            'aspect_ratio', 'prompt', 'german_text', 'source_image_references',
          ],
        },
      },
    },
    required: ['prompts'],
  },
}

export async function POST(req: NextRequest) {
  const {
    research,
    avatar,
    offer_brief,
    necessary_beliefs,
    copy,
    one_pager,
    product_images,
    uploaded_images,
  } = await req.json()

  if (!research || !copy) {
    return Response.json({ success: false, error: 'research and copy are required' }, { status: 400 })
  }

  const feedbackSummary = buildFeedbackSummary()
  const stage3UserFeedback = await buildStage3FeedbackBlock()
  // getPrompt("stage3") returns any Settings override saved to data/prompts.json,
  // falling back to IMAGE_PROMPTS_SYSTEM (the default template set).
  const basePrompt = await getPrompt('stage3')
  const systemPrompt =
    basePrompt
    + (feedbackSummary ? `\n\nFEEDBACK FROM PAST RUNS:\n${feedbackSummary}` : '\n\nNo automatic feedback from past runs yet.')
    + stage3UserFeedback

  const scraped: string[] = Array.isArray(product_images) ? product_images : []
  const uploaded: string[] = Array.isArray(uploaded_images) ? uploaded_images : []

  const userText = buildImagePromptsUserMessage({
    research,
    avatar,
    offer_brief,
    necessary_beliefs,
    copy,
    one_pager,
    product_images: scraped,
    uploaded_images: uploaded,
  })

  // Pass source images as vision content blocks so Claude can author an accurate Fidelity Lock.
  // Prioritise user uploads (most authoritative), then scraped images. Cap at 5 to stay within limits.
  const visionUrls = [...uploaded, ...scraped].slice(0, 5)
  const imageBlocks = visionUrls.map(url => ({
    type: 'image' as const,
    source: { type: 'url' as const, url },
  }))

  const messageContent = [
    { type: 'text' as const, text: userText },
    ...imageBlocks,
  ]

  try {
    // Forced tool call (see PROMPTS_TOOL): routes the 9 prompts through the
    // API's JSON serialisation so German copy punctuation can't break parsing.
    // Streaming is required by the SDK at this max_tokens budget;
    // finalMessage() collects the stream.
    const message = await anthropic.messages
      .stream({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 32000,
        system: systemPrompt,
        messages: [{ role: 'user', content: messageContent }],
        tools: [PROMPTS_TOOL],
        tool_choice: { type: 'tool', name: 'submit_image_prompts' },
      })
      .finalMessage()

    if (message.stop_reason === 'max_tokens') {
      return Response.json(
        { success: false, error: 'Prompt generation was cut off (output too long). Please retry.' },
        { status: 500 },
      )
    }

    const toolUse = message.content.find(b => b.type === 'tool_use')
    if (!toolUse || toolUse.type !== 'tool_use') {
      return Response.json(
        { success: false, error: 'Model did not return structured prompts.' },
        { status: 500 },
      )
    }

    // Claude usually returns `prompts` as a proper array, but for a payload
    // this large it sometimes emits it as a stringified JSON array instead.
    // Handle both — and run the string form through jsonrepair first, since
    // the German marketing copy is prone to quote-escaping mistakes.
    const rawPrompts = (toolUse.input as { prompts?: unknown }).prompts
    let parsed: RawPromptObj[]
    try {
      if (Array.isArray(rawPrompts)) {
        parsed = rawPrompts as RawPromptObj[]
      } else if (typeof rawPrompts === 'string') {
        parsed = JSON.parse(jsonrepair(rawPrompts)) as RawPromptObj[]
      } else {
        throw new Error('prompts field missing or not array/string')
      }
    } catch {
      return Response.json({ success: false, error: 'Failed to parse generated prompts.' }, { status: 500 })
    }

    if (!Array.isArray(parsed) || parsed.length !== 9) {
      return Response.json(
        { success: false, error: `Expected 9 prompts, got ${Array.isArray(parsed) ? parsed.length : 0}` },
        { status: 500 },
      )
    }

    // Normalize: ensure required fields and a valid category slug for every prompt.
    const normalized = parsed.map((p, i) => {
      const slug =
        (typeof p.category === 'string' && SLUG_BY_INDEX.includes(p.category)) ? p.category :
        SLUG_BY_INDEX[i] ?? SLUG_BY_INDEX[0]

      const refs = Array.isArray(p.source_image_references)
        ? (p.source_image_references as unknown[]).filter((x): x is string => typeof x === 'string')
        : []

      const germanText = typeof p.german_text === 'string'
        ? p.german_text
        : (typeof p.german_text_used === 'string' ? p.german_text_used : '')

      return {
        category: slug,
        image_type: p.image_type ?? IMAGE_CATEGORIES[i]?.label ?? slug,
        prompt: typeof p.prompt === 'string' ? p.prompt : '',
        german_text: germanText,
        source_image_references: refs.length ? refs : visionUrls.slice(0, 1),
        model: p.model ?? IMAGE_CATEGORIES[i]?.default_model ?? 'nano_banana_pro',
        aspect_ratio: p.aspect_ratio ?? '1:1',
        // Back-compat shims for any old consumers.
        german_text_used: germanText || null,
        reference_image_index: 0,
      }
    })

    return Response.json({ success: true, prompts: normalized })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ success: false, error: message }, { status: 500 })
  }
}
