import { db } from "@/lib/db";

import { requireSession } from "@/lib/auth";
// Lightweight counts for the TopBar needs-you badge.
export async function GET(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;
  try {
    const r = await db.execute(
      `SELECT COUNT(*) AS needs FROM runs
       WHERE snoozed_at IS NULL
         AND (
           status IN ('awaiting_product_approval','awaiting_stage2_approval','awaiting_user','awaiting_qc','awaiting_hero_qc','failed')
           OR ads_step = 'review'
           OR ads_error IS NOT NULL
         )`,
    );
    const needs = Number((r.rows[0] as unknown as { needs: number | bigint }).needs ?? 0);
    return Response.json({ needs });
  } catch {
    return Response.json({ needs: 0 });
  }
}
