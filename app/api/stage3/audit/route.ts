import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { IMAGE_AUDIT_SYSTEM, buildAuditUserMessage } from '@/lib/prompts/image_audit'
import { getModel } from '@/lib/models'
import { recordUsage } from '@/lib/db'
import { assertPublicUrl } from '@/lib/ssrf'

import { requireSession } from "@/lib/auth";
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
      // Only transient failures are worth re-billing (429/5xx/timeouts). A 4xx
      // is deterministic — retrying just multiplies the cost of the same error.
      const status = (err as { status?: number })?.status
      const transient =
        status === 429 ||
        (typeof status === 'number' && status >= 500) ||
        (typeof status !== 'number' && /timeout|timed out|overloaded|econnreset|socket|network|fetch failed/i.test(msg))
      if (!transient) throw err
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { image_url, category, prompt_used, product_description, overlay_text_used, run_id, reference_urls } = await req.json()

  if (!image_url || !category || !prompt_used) {
    return Response.json({ success: false, error: 'image_url, category, prompt_used required' }, { status: 400 })
  }
  // The reference photos the image was generated from — the auditor compares
  // the rendered product against them. Same public-URL guard as the image.
  const refs: string[] = Array.isArray(reference_urls)
    ? (reference_urls as unknown[]).filter((u): u is string => typeof u === 'string' && u.startsWith('https://')).slice(0, 4)
    : []
  try {
    await assertPublicUrl(String(image_url))
    for (const u of refs) await assertPublicUrl(u)
  } catch (e) {
    return Response.json({ success: false, error: e instanceof Error ? e.message : 'blocked image URL' }, { status: 400 })
  }

  const userMessage = buildAuditUserMessage({ category, prompt_used, product_description: product_description ?? '', overlay_text_used: overlay_text_used ?? null, reference_count: refs.length })

  try {
    const model = await getModel('stage3Audit')
    const message = await createWithRetry({
      model,
      max_tokens: 2000,
      // No cache_control: at ~590 tokens the auditor prompt is below the model's
      // 1024-token minimum cacheable prefix, so a cache marker here never caches.
      system: IMAGE_AUDIT_SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: image_url } },
          ...refs.map((u) => ({ type: 'image' as const, source: { type: 'url' as const, url: u } })),
          { type: 'text', text: userMessage },
        ],
      }],
    })

    void recordUsage(typeof run_id === 'number' ? run_id : null, 'stage3: image audit', model, message.usage)
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
