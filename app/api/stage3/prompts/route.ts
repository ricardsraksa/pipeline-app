import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { IMAGE_PROMPTS_SYSTEM, buildImagePromptsUserMessage } from '@/lib/prompts/image_prompts'
import { buildFeedbackSummary } from '@/lib/stage3/learning'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  const { research, avatar, offer_brief, necessary_beliefs, copy, product_images } = await req.json()

  if (!research || !copy) {
    return Response.json({ success: false, error: 'research and copy are required' }, { status: 400 })
  }

  const feedbackSummary = buildFeedbackSummary()
  const systemPrompt = IMAGE_PROMPTS_SYSTEM + (feedbackSummary ? `\n\nFEEDBACK FROM PAST RUNS:\n${feedbackSummary}` : '\n\nNo feedback from past runs yet.')

  const userMessage = buildImagePromptsUserMessage({ research, avatar, offer_brief, necessary_beliefs, copy, product_images: product_images ?? [] })

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    })

    const raw = message.content.find(b => b.type === 'text')?.text ?? ''

    let parsed: { prompts: unknown[] }
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON found')
      parsed = JSON.parse(jsonMatch[0])
    } catch {
      return Response.json({ success: false, error: 'Failed to parse prompts JSON', raw }, { status: 500 })
    }

    if (!Array.isArray(parsed.prompts) || parsed.prompts.length !== 11) {
      return Response.json({ success: false, error: `Expected 11 prompts, got ${parsed.prompts?.length ?? 0}`, raw }, { status: 500 })
    }

    return Response.json({ success: true, prompts: parsed.prompts })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ success: false, error: message }, { status: 500 })
  }
}
