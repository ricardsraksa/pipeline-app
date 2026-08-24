import { NextRequest } from 'next/server'
import { getRun, updateRun, recordPromptUsed } from '@/lib/db'
import { generateRemainingPrompts, REMAINING_SYSTEM, extractVisualSection } from '@/lib/stage3/hero'

// Approve the hero → trigger Phase 2 prompt generation. The approved hero
// image becomes the reference for all 8 derivative prompts. Lands at the
// existing prompt-review gate (awaiting_qc).
export const maxDuration = 600

export async function POST(req: NextRequest) {
  const { runId } = (await req.json()) as { runId?: number }
  if (!runId) return Response.json({ success: false, error: 'runId required' }, { status: 400 })

  const run = await getRun(runId)
  if (!run) return Response.json({ success: false, error: 'Run not found' }, { status: 404 })

  const heroUrl = run.stage3_hero_image_url
  if (!heroUrl) return Response.json({ success: false, error: 'No hero image to approve' }, { status: 400 })

  try {
    await updateRun(runId, {
      stage3_hero_approved: 1,
      status: 'generating_remaining',
      current_step: 'Stage 3: Writing the 8 derivative prompts',
      last_updated_at: new Date().toISOString(),
    })

    const onePager = run.stage1_one_pager_edited ?? run.stage1_one_pager ?? ''
    const copy = run.stage2_copy_edited ?? run.stage2_output ?? ''
    const avatar = run.step_avatar_revised ?? run.step_avatar ?? ''
    // Only the visual-strategy section — the full research doc was pure token waste here.
    const visual = extractVisualSection(run.step_research_revised ?? run.step_research ?? '')
    let extraReferenceUrls: string[] = []
    try { const v = JSON.parse(run.stage3_reference_images || '[]'); if (Array.isArray(v)) extraReferenceUrls = v.filter((x) => typeof x === 'string') } catch { /* none */ }

    // Audit trail: the system prompt the 8 derivative prompts ran with.
    await recordPromptUsed(runId, 'stage3_remaining', REMAINING_SYSTEM)
    const { prompts, validation } = await generateRemainingPrompts({ onePager, copy, avatar, visual, referenceImageUrls: [heroUrl], extraReferenceUrls, runId })
    if (!prompts.length) throw new Error('Phase 2 produced no prompts')

    await updateRun(runId, {
      stage3_remaining_prompts: JSON.stringify(prompts),
      stage3_remaining_validation: JSON.stringify(validation),
      status: 'awaiting_qc',
      current_step: 'Stage 3: Review the 8 prompts before generating',
      last_updated_at: new Date().toISOString(),
    })

    return Response.json({ success: true, prompts })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Revert to the hero gate so the operator can retry, rather than dead-end.
    await updateRun(runId, { status: 'awaiting_hero_qc', error_message: message, last_updated_at: new Date().toISOString() }).catch(() => {})
    return Response.json({ success: false, error: message }, { status: 500 })
  }
}
