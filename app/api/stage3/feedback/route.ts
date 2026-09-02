import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { saveFeedback, type FeedbackStore } from "@/lib/stage3/learning";

// This store is fed back into the legacy Stage 4 system prompt, so every
// string here is prompt-injection surface. Validate shape strictly, cap
// lengths, and drop anything that isn't a plain string/boolean.
const MAX_STR = 4_000;
const MAX_ITEMS = 50;

function str(v: unknown, max = MAX_STR): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}
function arr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === "object").slice(0, MAX_ITEMS) as Record<string, unknown>[]) : [];
}
function ts(v: unknown): string {
  return str(v, 40) || new Date().toISOString();
}

export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  try {
    const raw = await req.text();
    if (raw.length > 500_000) return Response.json({ success: false, error: "Payload too large" }, { status: 413 });
    const body = JSON.parse(raw) as Record<string, unknown>;
    const update: Partial<FeedbackStore> = {
      prompt_edits: arr(body.prompt_edits).map((e) => ({
        category: str(e.category, 100),
        original: str(e.original),
        edited: str(e.edited),
        approved: e.approved === true,
        timestamp: ts(e.timestamp),
      })),
      audit_results: arr(body.audit_results).map((r) => ({
        category: str(r.category, 100),
        verdict: r.verdict === "fail" ? "fail" : "pass",
        issues: Array.isArray(r.issues)
          ? r.issues.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 500)).slice(0, 20)
          : [],
        timestamp: ts(r.timestamp),
      })),
      regeneration_fixes: arr(body.regeneration_fixes).map((f) => ({
        category: str(f.category, 100),
        original_issue: str(f.original_issue),
        fix_applied: str(f.fix_applied),
        success: f.success === true,
        timestamp: ts(f.timestamp),
      })),
      image_feedback: arr(body.image_feedback).map((f) => ({
        category: str(f.category, 100),
        vote: f.vote === "down" ? ("down" as const) : ("up" as const),
        note: str(f.note) || undefined,
        prompt_used: str(f.prompt_used) || undefined,
        timestamp: ts(f.timestamp),
      })),
    };
    saveFeedback(update);
    return Response.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ success: false, error: message }, { status: 400 });
  }
}
