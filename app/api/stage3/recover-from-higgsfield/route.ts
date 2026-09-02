import { NextRequest } from 'next/server'
import { getRun, updateRun } from '@/lib/db'
import { listImageGenerations, type HiggsfieldGeneration } from '@/lib/higgsfield-mcp'

import { requireSession } from "@/lib/auth";
// Recover Stage 4 images that generated on Higgsfield but were never persisted
// to the pipeline (the old db.transaction persist path failed silently). The
// pipeline sends each Higgsfield prompt as `<run prompt>.trim() + fidelity
// guardrail`, so a generation's prompt always STARTS WITH the run's stored
// prompt — we match on a normalized prefix and take the newest completed image.
export const maxDuration = 120

type StoredPrompt = { index?: number; category?: string; prompt?: string }
type StoredImage = { index: number; category: string; image_url: string; status: 'done' | 'failed'; recovered?: boolean }

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

function urlOf(g: HiggsfieldGeneration): string {
  return g.results?.rawUrl || g.results?.minUrl || ''
}

export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { runId } = (await req.json()) as { runId?: number }
  if (!runId) return Response.json({ success: false, error: 'runId required' }, { status: 400 })

  const run = await getRun(runId)
  if (!run) return Response.json({ success: false, error: 'Run not found' }, { status: 404 })

  let prompts: StoredPrompt[] = []
  try {
    const raw = run.stage3_remaining_prompts_edited ?? run.stage3_remaining_prompts
    const parsed = raw ? JSON.parse(raw) : []
    if (Array.isArray(parsed)) prompts = parsed
  } catch { /* leave empty */ }
  if (!prompts.length) {
    return Response.json({ success: false, error: 'This run has no Stage 4 prompts to match against.' }, { status: 400 })
  }

  // Images already persisted (partial recovery / prior generation) — keep them.
  let existing: StoredImage[] = []
  try { const p = JSON.parse(run.stage3_remaining_images || '[]'); if (Array.isArray(p)) existing = p } catch { /* none */ }
  const doneByIndex = new Map(existing.filter((im) => im?.status === 'done' && im.image_url).map((im) => [im.index, im]))
  // ALL prior entries (including failed tiles) — an unmatched index keeps its
  // failed entry so the completed view retains its "tap to regenerate" tile
  // instead of the image silently disappearing.
  const anyByIndex = new Map(existing.filter((im) => typeof im?.index === 'number').map((im) => [im.index, im]))

  let gens: HiggsfieldGeneration[]
  try {
    gens = await listImageGenerations()
  } catch (err) {
    return Response.json({ success: false, error: `Couldn't read Higgsfield history: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 })
  }
  // Newest first, only usable completed images.
  const usable = gens
    .filter((g) => g.status === 'completed' && urlOf(g) && g.params?.prompt)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))

  const matched: number[] = []
  const unmatched: number[] = []
  const images: StoredImage[] = []

  for (const p of prompts) {
    const index = typeof p.index === 'number' ? p.index : 0
    const category = p.category || ''
    if (doneByIndex.has(index)) { images.push(doneByIndex.get(index)!); matched.push(index); continue }

    const key = norm(p.prompt || '').slice(0, 200)
    // `usable` is newest-first, so the first prefix match is the latest image.
    const hit = key ? usable.find((g) => norm(g.params!.prompt!).startsWith(key)) : undefined
    if (hit) {
      images.push({ index, category, image_url: urlOf(hit), status: 'done', recovered: true })
      matched.push(index)
    } else {
      // Nothing in Higgsfield history for this prompt — keep whatever entry the
      // run already had (typically a failed tile) rather than dropping it.
      const prior = anyByIndex.get(index)
      if (prior) images.push(prior)
      unmatched.push(index)
    }
  }

  images.sort((a, b) => a.index - b.index)
  if (!images.length) {
    return Response.json({ success: false, error: 'No matching images found in Higgsfield history.', matched, unmatched }, { status: 404 })
  }

  await updateRun(runId, {
    stage3_remaining_images: JSON.stringify(images),
    // Only complete the run when every prompt has an image; otherwise leave it
    // at the review gate so the operator can generate the few that are missing.
    ...(unmatched.length === 0 ? { status: 'completed' } : {}),
    last_updated_at: new Date().toISOString(),
  })

  return Response.json({ success: true, recovered: images.length, total: prompts.length, matched, unmatched })
}
