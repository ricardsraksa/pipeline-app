import fs from 'fs'
import path from 'path'

const FEEDBACK_PATH = path.join(process.cwd(), 'data', 'stage3_feedback.json')

interface FeedbackStore {
  prompt_edits: Array<{
    category: string
    original: string
    edited: string
    approved: boolean
    timestamp: string
  }>
  audit_results: Array<{
    category: string
    verdict: string
    issues: string[]
    timestamp: string
  }>
  regeneration_fixes: Array<{
    category: string
    original_issue: string
    fix_applied: string
    success: boolean
    timestamp: string
  }>
}

function loadFeedback(): FeedbackStore {
  try {
    if (fs.existsSync(FEEDBACK_PATH)) {
      return JSON.parse(fs.readFileSync(FEEDBACK_PATH, 'utf-8'))
    }
  } catch { /* ignore */ }
  return { prompt_edits: [], audit_results: [], regeneration_fixes: [] }
}

export function saveFeedback(update: Partial<FeedbackStore>): void {
  const existing = loadFeedback()
  const merged: FeedbackStore = {
    prompt_edits: [...existing.prompt_edits, ...(update.prompt_edits ?? [])],
    audit_results: [...existing.audit_results, ...(update.audit_results ?? [])],
    regeneration_fixes: [...existing.regeneration_fixes, ...(update.regeneration_fixes ?? [])],
  }
  fs.mkdirSync(path.dirname(FEEDBACK_PATH), { recursive: true })
  fs.writeFileSync(FEEDBACK_PATH, JSON.stringify(merged, null, 2))
}

export function buildFeedbackSummary(): string {
  const fb = loadFeedback()
  if (!fb.prompt_edits.length && !fb.audit_results.length) return ''

  const lines: string[] = []

  // Edited prompts — learn from diffs
  const edits = fb.prompt_edits.filter(e => e.edited && e.edited !== e.original)
  if (edits.length) {
    lines.push('PAST PROMPT EDITS (learn from these):')
    // Group by category
    const byCategory: Record<string, typeof edits> = {}
    for (const e of edits) {
      if (!byCategory[e.category]) byCategory[e.category] = []
      byCategory[e.category].push(e)
    }
    for (const [cat, catEdits] of Object.entries(byCategory)) {
      lines.push(`  ${cat}: user edited ${catEdits.length} time(s)`)
      const last = catEdits[catEdits.length - 1]
      lines.push(`    Example — original: "${last.original.slice(0, 100)}..."`)
      lines.push(`    Example — edited to: "${last.edited.slice(0, 100)}..."`)
    }
  }

  // Audit failures — common issues to avoid
  const failures = fb.audit_results.filter(r => r.verdict === 'fail')
  if (failures.length) {
    lines.push('PAST AUDIT FAILURES (issues to avoid):')
    const issueCounts: Record<string, number> = {}
    for (const f of failures) {
      for (const issue of f.issues) {
        issueCounts[issue] = (issueCounts[issue] ?? 0) + 1
      }
    }
    const topIssues = Object.entries(issueCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
    for (const [issue, count] of topIssues) {
      lines.push(`  "${issue}" — occurred ${count} time(s)`)
    }
  }

  // Regeneration fixes that worked
  const successfulFixes = fb.regeneration_fixes.filter(r => r.success)
  if (successfulFixes.length) {
    lines.push('SUCCESSFUL REGENERATION FIXES:')
    for (const fix of successfulFixes.slice(-3)) {
      lines.push(`  Category ${fix.category}: "${fix.fix_applied}"`)
    }
  }

  return lines.join('\n')
}
