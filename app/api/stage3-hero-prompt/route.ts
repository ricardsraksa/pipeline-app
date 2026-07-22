import { NextRequest } from 'next/server'
import { getRun, updateRun, recordPromptUsed } from '@/lib/db'
import { generateHeroPrompt, HERO_SYSTEM } from '@/lib/stage3/hero'
import { generateStage3Image } from '@/lib/stage3/higgsfield'

// Phase 1 of hero-first Stage 3: generate ONE hero studio shot from the
// SOURCE product photos, then stop at the hero QC gate.
// Submit + poll image gen can take ~40s, plus the prompt call — give it room.
export const maxDuration = 600

function safeArr(json: string | null): string[] {
  if (!json) return []
  try { const v = JSON.parse(json); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [] } catch { return [] }
}

export async function POST(req: NextRequest) {
  const { runId } = (await req.json()) as { runId?: number }
  if (!runId) return Response.json({ success: false, error: 'runId required' }, { status: 400 })

  const run = await getRun(runId)
  if (!run) return Response.json({ success: false, error: 'Run not found' }, { status: 404 })

  // Source product photos = the references the hero is built from. Prefer the
  // user-uploaded source images; fall back to scraped product images.
  const uploaded = safeArr(run.uploaded_source_images)
  const scraperData = run.scraper_data ? (() => { try { return JSON.parse(run.scraper_data!) } catch { return null } })() : null
  const scraped: string[] = Array.isArray(scraperData?.images) ? scraperData.images : []
  const sourceImageUrls = [...uploaded, ...scraped].filter((u, i, a) => u && a.indexOf(u) === i).slice(0, 5)

  if (sourceImageUrls.length === 0) {
    return Response.json({ success: false, error: 'No source product images to build a hero from' }, { status: 400 })
  }

  try {
    await updateRun(runId, { status: 'generating_hero', current_step: 'Stage 3: Generating hero shot', last_updated_at: new Date().toISOString() })

    const onePager = run.stage1_one_pager_edited ?? run.stage1_one_pager ?? ''
    const copy = run.stage2_copy_edited ?? run.stage2_output ?? ''
    const extraReferenceUrls = safeArr(run.stage3_reference_images)
    // Audit trail: the system prompt the hero prompt-writer ran with.
    await recordPromptUsed(runId, 'stage3_hero', HERO_SYSTEM)
    const { hero, validation } = await generateHeroPrompt({ onePager, copy, sourceImageUrls, extraReferenceUrls })

    await updateRun(runId, {
      stage3_hero_prompt: JSON.stringify(hero),
      stage3_hero_validation: JSON.stringify(validation),
      last_updated_at: new Date().toISOString(),
    })

    const imageUrl = await generateStage3Image({
      prompt: hero.prompt,
      model: hero.model,
      // The model curates source_image_references (source photos + any scene
      // extras it chose) — send exactly those to Higgsfield.
      reference_images: hero.source_image_references.length ? hero.source_image_references : sourceImageUrls,
      aspect_ratio: hero.aspect_ratio,
    })

    await updateRun(runId, {
      stage3_hero_image_url: imageUrl,
      stage3_hero_approved: 0,
      status: 'awaiting_hero_qc',
      current_step: 'Stage 3: Review the hero shot',
      last_updated_at: new Date().toISOString(),
    })

    return Response.json({ success: true, hero_image_url: imageUrl, hero_prompt: hero })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await updateRun(runId, { status: 'failed', error_message: message, last_updated_at: new Date().toISOString() }).catch(() => {})
    return Response.json({ success: false, error: message }, { status: 500 })
  }
}
