"use client";

// Collapsible API-cost readout for one run. Data comes from the api_usage
// table (token counts captured from every Anthropic response — recording them
// is free). Fetched lazily on first expand so the run page stays light.

import { useState } from "react";

interface BreakdownRow {
  label: string;
  model: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost: number;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtCost(n: number): string {
  return n >= 0.995 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`;
}

export default function RunCost({ runId }: { runId: number }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{ total_cost: number; calls: number; breakdown: BreakdownRow[] } | null>(null);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !data && !loading) {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/runs/${runId}/usage`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error || `HTTP ${res.status}`);
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <button
        onClick={toggle}
        className="cursor-pointer w-full flex items-center justify-between px-3 py-2 text-[12px] text-[var(--color-text-3)] hover:text-[var(--color-text)] tr"
      >
        <span>
          API cost
          {data ? (
            <span className="ml-2 text-[var(--color-text)] font-[600]">{fmtCost(data.total_cost)}</span>
          ) : null}
          {data ? <span className="ml-1.5">· {data.calls} calls</span> : null}
        </span>
        <span>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3">
          {loading && <p className="text-[11.5px] text-[var(--color-text-3)]">Loading…</p>}
          {error && <p className="text-[11.5px] text-[var(--color-danger,#dc2626)]">{error}</p>}
          {data && data.breakdown.length === 0 && (
            <p className="text-[11.5px] text-[var(--color-text-3)]">
              No usage recorded yet — tracking started with v2.22.0, so older runs have no data.
            </p>
          )}
          {data && data.breakdown.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[11.5px]">
                <thead>
                  <tr className="text-left text-[var(--color-text-3)]">
                    <th className="py-1 pr-3 font-[500]">Call</th>
                    <th className="py-1 pr-3 font-[500]">Model</th>
                    <th className="py-1 pr-3 font-[500] text-right">Calls</th>
                    <th className="py-1 pr-3 font-[500] text-right">In</th>
                    <th className="py-1 pr-3 font-[500] text-right">Out</th>
                    <th className="py-1 pr-3 font-[500] text-right">Cache r/w</th>
                    <th className="py-1 font-[500] text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {data.breakdown.map((r) => (
                    <tr key={`${r.label}|${r.model}`} className="border-t border-[var(--color-border)] text-[var(--color-text-2,var(--color-text))]">
                      <td className="py-1 pr-3">{r.label}</td>
                      <td className="py-1 pr-3 text-[var(--color-text-3)]">{r.model.replace("claude-", "")}</td>
                      <td className="py-1 pr-3 text-right">{r.calls}</td>
                      <td className="py-1 pr-3 text-right">{fmtTokens(r.input_tokens)}</td>
                      <td className="py-1 pr-3 text-right">{fmtTokens(r.output_tokens)}</td>
                      <td className="py-1 pr-3 text-right">{fmtTokens(r.cache_read_tokens)}/{fmtTokens(r.cache_write_tokens)}</td>
                      <td className="py-1 text-right font-[600]">{fmtCost(r.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
