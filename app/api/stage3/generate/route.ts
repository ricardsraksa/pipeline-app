import { NextRequest } from 'next/server'
import { requireSession } from '@/lib/auth'
import { generateStage3Image } from '@/lib/stage3/higgsfield'
import { assertPublicUrl } from '@/lib/ssrf'

// Image generation goes through the Higgsfield MCP: submit + poll, ~10-40s.
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const denied = requireSession(req); if (denied) return denied;
  const { prompt, model, reference_images, aspect_ratio } = await req.json()

  if (!prompt || typeof prompt !== 'string' || prompt.length > 20_000) {
    return Response.json({ success: false, error: 'prompt required (string, max 20k chars)' }, { status: 400 })
  }
  // Reference URLs are fetched server-side downstream — validate hard here.
  const refs: string[] = Array.isArray(reference_images)
    ? reference_images.filter((u: unknown): u is string => typeof u === 'string').slice(0, 6)
    : []
  try {
    await Promise.all(refs.map((u) => assertPublicUrl(u)))
  } catch (e) {
    return Response.json({ success: false, error: e instanceof Error ? e.message : 'blocked reference URL' }, { status: 400 })
  }
  const MODEL_ALLOWLIST = new Set(['gpt_image_2', 'nano_banana_2', 'nano_banana_pro', 'marketing_studio_image'])
  const safeModel = typeof model === 'string' && MODEL_ALLOWLIST.has(model) ? model : 'gpt_image_2'
  const aspectOk = typeof aspect_ratio === 'string' && /^[0-9]{1,2}:[0-9]{1,2}$/.test(aspect_ratio)
  const safeAspect = aspectOk ? aspect_ratio : '1:1'


  try {
    const image_url = await generateStage3Image({
      prompt,
      model: safeModel,
      reference_images: refs,
      aspect_ratio: safeAspect,
    })
    return Response.json({ success: true, image_url })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ success: false, error: message }, { status: 500 })
  }
}
