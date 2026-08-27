import { NextRequest } from 'next/server'
import { requireSession } from '@/lib/auth'
import { getRun } from '@/lib/db'
import { createDraftProduct } from '@/lib/shopify'
import { whatsIncluded, type Stage2Json } from '@/lib/stage2/shape'

// Push a finished run to Shopify as a DRAFT product: Stage 2 copy becomes the
// product description, the hero + the 8 Stage 3 images become the product media.
// Draft on purpose — pricing/variants and publishing stay a human decision.
export const maxDuration = 120

type StoredImage = { index?: number; image_url?: string; status?: string }

const esc = (s: string) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

/** Assemble the copy kit into product description HTML (theme-agnostic). */
function buildDescriptionHtml(j: Stage2Json | null, fallbackText: string): string {
  if (!j) {
    // No structured copy — keep the canonical text readable rather than lose it.
    return fallbackText
      .split(/\n{2,}/)
      .map((p) => `<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`)
      .join('\n')
  }

  const out: string[] = []
  if (j.supporting_sentence) out.push(`<p><strong>${esc(j.supporting_sentence)}</strong></p>`)
  if (j.benefits?.length) {
    out.push('<ul>')
    for (const b of j.benefits) if (b?.trim()) out.push(`  <li>${esc(b)}</li>`)
    out.push('</ul>')
  }
  for (const s of j.sections ?? []) {
    if (!s?.headline && !s?.paragraph) continue
    if (s.headline) out.push(`<h3>${esc(s.headline)}</h3>`)
    if (s.paragraph) out.push(`<p>${esc(s.paragraph)}</p>`)
  }
  const included = whatsIncluded(j)
  if (included) {
    out.push(`<h3>What's included</h3>`)
    out.push(`<p>${esc(included)}</p>`)
  }
  if (j.faqs?.length) {
    out.push('<h3>FAQs</h3>')
    for (const f of j.faqs) {
      if (!f?.q && !f?.a) continue
      if (f.q) out.push(`<p><strong>${esc(f.q)}</strong></p>`)
      if (f.a) out.push(`<p>${esc(f.a)}</p>`)
    }
  }
  return out.join('\n')
}

export async function POST(req: NextRequest) {
  const denied = requireSession(req); if (denied) return denied;
  const { runId } = (await req.json()) as { runId?: number }
  if (!runId) return Response.json({ success: false, error: 'runId required' }, { status: 400 })

  const run = await getRun(runId)
  if (!run) return Response.json({ success: false, error: 'Run not found' }, { status: 404 })

  let copy: Stage2Json | null = null
  try {
    const parsed = run.stage2_json ? JSON.parse(run.stage2_json) : null
    if (parsed && typeof parsed === 'object') copy = parsed as Stage2Json
  } catch { /* fall back to raw text */ }

  const canonicalText = run.stage2_copy_edited ?? run.stage2_output ?? ''
  const title = (copy?.product_name || run.brand_name || run.product_name || '').trim()
  if (!title) {
    return Response.json({ success: false, error: 'This run has no product name to use as the Shopify title.' }, { status: 400 })
  }
  const descriptionHtml = buildDescriptionHtml(copy, canonicalText)
  if (!descriptionHtml.trim()) {
    return Response.json({ success: false, error: 'This run has no Stage 2 copy to publish.' }, { status: 400 })
  }

  // Hero first, then the derivatives in prompt order — that's the sequence the
  // operator reviewed, and Shopify uses the first image as the product thumbnail.
  const imageUrls: string[] = []
  if (run.stage3_hero_image_url) imageUrls.push(run.stage3_hero_image_url)
  try {
    const imgs = JSON.parse(run.stage3_remaining_images || '[]') as StoredImage[]
    if (Array.isArray(imgs)) {
      imgs
        .filter((im) => im?.image_url && im.status !== 'failed')
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .forEach((im) => imageUrls.push(im.image_url as string))
    }
  } catch { /* hero only */ }

  try {
    const result = await createDraftProduct({
      title,
      descriptionHtml,
      imageUrls,
      tags: ['pipeline', `run-${runId}`],
    })
    return Response.json({ success: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ success: false, error: message }, { status: 502 })
  }
}
