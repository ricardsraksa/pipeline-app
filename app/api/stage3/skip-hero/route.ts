import { NextRequest } from 'next/server'
import { angleBlock, parseAngle } from '@/lib/angles'
import { getRun, updateRun, recordPromptUsed } from '@/lib/db'
import { generateRemainingPrompts, REMAINING_SYSTEM, extractVisualSection } from '@/lib/stage3/hero'
import { stage3ActiveSourceImages } from '@/lib/stage3/sources'

import { requireSession } from "@/lib/auth";
// Skip the hero step: generate the 8 derivative prompts directly from the
// SOURCE product photos (no separate hero shot). Lands at the same prompt
// review gate (awaiting_qc); the source images become the reference for every
// image generated there.
export const maxDuration = 600

function safeArr(json: string | null): string[] {
  if (!json) return []
  try { const v = JSON.parse(json); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [] } catch { return [] }
}

export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { runId } = (await req.json()) as { runId?: number }
  if (!runId) return Response.json({ success: false, error: 'runId required' }, { status: 400 })

  const run = await getRun(runId)
  if (!run) return Response.json({ success: false, error: 'Run not found' }, { status: 404 })

  // Same source resolution as the hero step: uploaded + scraped, minus any the
  // operator excluded in the source-image picker, cap to 5.
  const sourceImageUrls = stage3ActiveSourceImages(run)

  if (sourceImageUrls.length === 0) {
    return Response.json({ success: false, error: 'No source product images to generate from' }, { status: 400 })
  }

  try {
    // Clear any prior hero so the UI treats this as a source-image run.
    await updateRun(runId, {
      stage3_hero_prompt: null,
      stage3_hero_prompt_edited: null,
      stage3_hero_image_url: null,
      stage3_hero_approved: 0,
      status: 'generating_remaining',
      current_step: 'Stage 4: Writing the 8 prompts from source images',
      error_message: null,
      last_updated_at: new Date().toISOString(),
    })

    const onePager = run.stage1_one_pager_edited ?? run.stage1_one_pager ?? ''
    const copy = run.stage2_copy_edited ?? run.stage2_output ?? ''
    const avatar = run.step_avatar_revised ?? run.step_avatar ?? ''
    // Only the visual-strategy section — the full research doc was pure token waste here.
    const visual = extractVisualSection(run.step_research_revised ?? run.step_research ?? '')

    // Audit trail: the system prompt the 8 prompts ran with (hero skipped).
    await recordPromptUsed(runId, 'stage3_remaining', REMAINING_SYSTEM)
    const { prompts, validation } = await generateRemainingPrompts({
      angle: angleBlock(parseAngle(run.product_angle_selected)),
      onePager, copy, avatar, visual,
      referenceImageUrls: sourceImageUrls,
      extraReferenceUrls: safeArr(run.stage3_reference_images),
      fromSource: true,
      runId,
    })
    if (!prompts.length) throw new Error('Prompt generation produced no prompts')

    await updateRun(runId, {
      stage3_remaining_prompts: JSON.stringify(prompts),
      stage3_remaining_validation: JSON.stringify(validation),
      status: 'awaiting_qc',
      current_step: 'Stage 4: Review the 8 prompts before generating',
      last_updated_at: new Date().toISOString(),
    })

    return Response.json({ success: true, prompts })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Drop back to the Stage 4 entry gate so the operator can retry.
    await updateRun(runId, { status: 'awaiting_user', error_message: message, last_updated_at: new Date().toISOString() }).catch(() => {})
    return Response.json({ success: false, error: message }, { status: 500 })
  }
}
