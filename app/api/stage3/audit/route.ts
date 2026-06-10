import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { IMAGE_AUDIT_SYSTEM, buildAuditUserMessage } from '@/lib/prompts/image_audit'

// timeout: a hung vision call (usually Anthropic struggling to download the
// image URL) fails in 90s instead of the SDK's 10-min default.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 90_000 })

export const maxDuration = 300

// Anthropic occasionally fails transiently fetching the image URL ("timed out
// while trying to download the file") — retry before giving up so a blip
// doesn't mislabel an image.
async function createWithRetry(body: Anthropic.MessageCreateParamsNonStreaming) {
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await anthropic.messages.create(body)
    } catch (err) {
      lastErr = err
      const msg = err instanceof Error ? err.message : String(err)
      if (/401|403|invalid api key|authentication/i.test(msg)) throw err
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

export async function POST(req: NextRequest) {
  const { image_url, category, prompt_used, product_description, german_text_used } = await req.json()

  if (!image_url || !category || !prompt_used) {
    return Response.json({ success: false, error: 'image_url, category, prompt_used required' }, { status: 400 })
  }

  const userMessage = buildAuditUserMessage({ image_url, category, prompt_used, product_description: product_description ?? '', german_text_used: german_text_used ?? null })

  try {
    const message = await createWithRetry({
      model: 'claude-sonnet-4-5-20250929',
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
