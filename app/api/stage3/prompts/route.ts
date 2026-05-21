import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { buildImagePromptsUserMessage } from '@/lib/prompts/image_prompts'
import { getPrompt } from '@/lib/prompts'
import { buildFeedbackSummary } from '@/lib/stage3/learning'
import { IMAGE_CATEGORIES } from '@/lib/stage3/categories'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

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
  // getPrompt("stage3") returns any Settings override saved to data/prompts.json,
  // falling back to IMAGE_PROMPTS_SYSTEM (the default template set).
  const basePrompt = getPrompt('stage3')
  const systemPrompt = basePrompt + (feedbackSummary ? `\n\nFEEDBACK FROM PAST RUNS:\n${feedbackSummary}` : '\n\nNo feedback from past runs yet.')

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
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      // 9 fully-expanded templates (each with an inline Fidelity Lock +
      // Negative Constraint Block) run ~15-20k output tokens. 12k truncated
      // the JSON array mid-object; 32k leaves comfortable headroom.
      max_tokens: 32000,
      system: systemPrompt,
      messages: [{ role: 'user', content: messageContent }],
    })

    const raw = message.content.find(b => b.type === 'text')?.text ?? ''

    // A truncated response can't be valid JSON — surface a clear reason.
    if (message.stop_reason === 'max_tokens') {
      return Response.json(
        { success: false, error: 'Prompt generation was cut off (output too long). Please retry.', raw },
        { status: 500 },
      )
    }

    let parsed: RawPromptObj[]
    try {
      const jsonMatch = raw.match(/\[[\s\S]*\]/)
      if (!jsonMatch) throw new Error('No JSON array found')
      parsed = JSON.parse(jsonMatch[0])
    } catch {
      return Response.json({ success: false, error: 'Failed to parse prompts JSON', raw }, { status: 500 })
    }

    if (!Array.isArray(parsed) || parsed.length !== 9) {
      return Response.json({ success: false, error: `Expected 9 prompts, got ${parsed?.length ?? 0}`, raw }, { status: 500 })
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
