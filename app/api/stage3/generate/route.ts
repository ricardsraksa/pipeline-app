import { NextRequest } from 'next/server'
import { generateStage3Image } from '@/lib/stage3/higgsfield'

export async function POST(req: NextRequest) {
  const { prompt, model, reference_images, aspect_ratio } = await req.json()

  if (!prompt) {
    return Response.json({ success: false, error: 'prompt required' }, { status: 400 })
  }

  try {
    const image_url = await generateStage3Image({
      prompt,
      model: model ?? 'marketing_studio_image',
      reference_images: reference_images ?? [],
      aspect_ratio: aspect_ratio ?? '1:1',
    })
    return Response.json({ success: true, image_url })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ success: false, error: message }, { status: 500 })
  }
}
