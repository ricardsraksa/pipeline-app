import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { IMAGE_AUDIT_SYSTEM, buildAuditUserMessage } from '@/lib/prompts/image_audit'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  const { image_url, category, prompt_used, product_description, german_text_used } = await req.json()

  if (!image_url || !category || !prompt_used) {
    return Response.json({ success: false, error: 'image_url, category, prompt_used required' }, { status: 400 })
  }

  const userMessage = buildAuditUserMessage({ image_url, category, prompt_used, product_description: product_description ?? '', german_text_used: german_text_used ?? null })

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: IMAGE_AUDIT_SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: image_url } },
          { type: 'text', text: userMessage },
        ],
      }],
    })

    const raw = message.content.find(b => b.type === 'text')?.text ?? ''

    let parsed: { verdict: string; issues: string[]; requires_regeneration: boolean }
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON found')
      parsed = JSON.parse(jsonMatch[0])
    } catch {
      return Response.json({ success: false, error: 'Failed to parse audit JSON', raw }, { status: 500 })
    }

    return Response.json({ success: true, result: parsed })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ success: false, error: message }, { status: 500 })
  }
}
