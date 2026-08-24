import { getUsageForRun } from "@/lib/db";
import { costOfUsage } from "@/lib/models";

// Cost tracker readout: every Anthropic call recorded for a run, plus a
// per-label rollup and the total dollar cost. Usage numbers are captured from
// API responses we already receive — this endpoint only reads the DB.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isFinite(runId)) {
    return Response.json({ success: false, error: "bad run id" }, { status: 400 });
  }
  try {
    const rows = await getUsageForRun(runId);
    const byLabel = new Map<string, {
      label: string; model: string; calls: number;
      input_tokens: number; output_tokens: number;
      cache_read_tokens: number; cache_write_tokens: number; cost: number;
    }>();
    let total = 0;
    for (const r of rows) {
      const cost = costOfUsage(r.model, r);
      total += cost;
      const key = `${r.label}|${r.model}`;
      const agg = byLabel.get(key) ?? {
        label: r.label, model: r.model, calls: 0,
        input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost: 0,
      };
      agg.calls += 1;
      agg.input_tokens += r.input_tokens;
      agg.output_tokens += r.output_tokens;
      agg.cache_read_tokens += r.cache_read_tokens;
      agg.cache_write_tokens += r.cache_write_tokens;
      agg.cost += cost;
      byLabel.set(key, agg);
    }
    return Response.json({
      success: true,
      total_cost: total,
      calls: rows.length,
      breakdown: [...byLabel.values()].sort((a, b) => b.cost - a.cost),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
