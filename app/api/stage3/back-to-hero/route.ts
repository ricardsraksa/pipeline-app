import { NextRequest } from 'next/server'
import { getRun, updateRun } from '@/lib/db'

// Step back from the 8-prompt review gate (awaiting_qc) to the hero QC gate.
// Non-destructive on purpose: the stored prompts/images stay, so an operator
// who just wants another look at the hero and re-approves it unchanged loses
// nothing (approval regenerates the prompts; the resume logic keeps any images
// already generated). Only actually REGENERATING the hero clears the old
// hero's derivatives — see hero-regenerate.
export async function POST(req: NextRequest) {
  const { runId } = (await req.json()) as { runId?: number }
  if (!runId) return Response.json({ success: false, error: 'runId required' }, { status: 400 })

  const run = await getRun(runId)
  if (!run) return Response.json({ success: false, error: 'Run not found' }, { status: 404 })
  if (!run.stage3_hero_image_url) {
    return Response.json({ success: false, error: 'This run has no hero image to go back to (it was generated from source photos).' }, { status: 400 })
  }

  await updateRun(runId, {
    status: 'awaiting_hero_qc',
    stage3_hero_approved: 0,
    error_message: null,
    current_step: 'Stage 3: Review the hero shot',
    last_updated_at: new Date().toISOString(),
  })

  return Response.json({ success: true })
}
