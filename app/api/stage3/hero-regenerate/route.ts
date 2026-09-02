import { NextRequest } from 'next/server'
import { getRun, updateRun } from '@/lib/db'
import { generateStage3Image } from '@/lib/stage3/higgsfield'
import type { HeroPrompt } from '@/lib/stage3/hero'
import { stage3ActiveSourceImages } from '@/lib/stage3/sources'

import { requireSession } from "@/lib/auth";
// Regenerate the hero image at the QC gate. Optionally accepts an edited
// prompt (the operator tweaked it). Stays at awaiting_hero_qc.
export const maxDuration = 300

function safeArr(json: string | null): string[] {
  if (!json) return []
  try { const v = JSON.parse(json); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [] } catch { return [] }
}

export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { runId, editedPrompt } = (await req.json()) as { runId?: number; editedPrompt?: string }
  if (!runId) return Response.json({ success: false, error: 'runId required' }, { status: 400 })

  const run = await getRun(runId)
  if (!run) return Response.json({ success: false, error: 'Run not found' }, { status: 404 })

  let hero: HeroPrompt | null = null
  try { hero = run.stage3_hero_prompt ? JSON.parse(run.stage3_hero_prompt) : null } catch { hero = null }
  if (!hero) return Response.json({ success: false, error: 'No hero prompt to regenerate' }, { status: 400 })

  const promptText = (editedPrompt && editedPrompt.trim()) || hero.prompt
  // Uploaded + scraped, minus any the operator excluded in the picker.
  const sourceImageUrls = stage3ActiveSourceImages(run)
  // Operator-added Stage 3 reference images (scene/style) guide the regen too —
  // sent to Higgsfield alongside the source product photos.
  const extraRefs = safeArr(run.stage3_reference_images)
  const referenceImages = [...sourceImageUrls, ...extraRefs].filter((u, i, a) => u && a.indexOf(u) === i).slice(0, 6)

  try {
    await updateRun(runId, { status: 'generating_hero', current_step: 'Stage 3: Regenerating hero shot', last_updated_at: new Date().toISOString() })

    const imageUrl = await generateStage3Image({
      prompt: promptText,
      model: hero.model || 'gpt_image_2',
      reference_images: referenceImages,
      aspect_ratio: hero.aspect_ratio || '1:1',
    })

    await updateRun(runId, {
      ...(editedPrompt && editedPrompt.trim() ? { stage3_hero_prompt_edited: editedPrompt.trim() } : {}),
      stage3_hero_image_url: imageUrl,
      // A NEW hero invalidates everything derived from the old one. Clearing
      // here keeps the "back to hero" loop safe: without it, the generation
      // resume logic would skip indices already "done" and silently mix
      // old-hero images with new-hero prompts.
      stage3_remaining_prompts: null,
      stage3_remaining_prompts_edited: null,
      stage3_remaining_images: null,
      stage3_ref_overrides: null,
      status: 'awaiting_hero_qc',
      current_step: 'Stage 3: Review the hero shot',
      last_updated_at: new Date().toISOString(),
    })

    return Response.json({ success: true, hero_image_url: imageUrl })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await updateRun(runId, { status: 'awaiting_hero_qc', error_message: message, last_updated_at: new Date().toISOString() }).catch(() => {})
    return Response.json({ success: false, error: message }, { status: 500 })
  }
}
