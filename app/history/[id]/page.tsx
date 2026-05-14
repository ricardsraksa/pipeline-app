import { notFound } from "next/navigation";
import type { Run } from "@/lib/db";
import type { ImagePrompt } from "@/app/api/stage3-prompts/route";

async function getRun(id: string): Promise<Run | null> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/runs/${id}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return data.run ?? null;
  } catch {
    return null;
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function FeedbackBadge({ value, label }: { value: string | null; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-mono">
      <span className="text-[#404040]">{label}</span>
      {value ? (
        <span className={value === "up" ? "text-[#16a34a]" : "text-[#dc2626]"}>
          {value === "up" ? "↑ good" : "↓ bad"}
        </span>
      ) : (
        <span className="text-[#333]">no feedback</span>
      )}
    </span>
  );
}

export default async function RunPage({
  params,
}: {
  params: Promise<unknown>;
}) {
  const { id } = (await params) as { id: string };
  const run = await getRun(id);

  if (!run) notFound();

  const imageUrls: string[] = run.image_urls ? JSON.parse(run.image_urls) : [];
  const stage3Prompts: ImagePrompt[] = run.stage3_prompts
    ? JSON.parse(run.stage3_prompts)
    : [];

  const infographicUrls = stage3Prompts
    .filter((p) => p.category === "INFOGRAPHIC")
    .map((p) => imageUrls[p.index - 1])
    .filter(Boolean);

  const contextualUrls = stage3Prompts
    .filter((p) => p.category === "CONTEXTUAL")
    .map((p) => imageUrls[p.index - 1])
    .filter(Boolean);

  return (
    <main className="min-h-screen bg-[#0a0a0a] pb-16">
      <div className="max-w-2xl mx-auto px-4 pt-8">
        <div className="mb-7">
          <a
            href="/history"
            className="text-xs font-mono text-[#404040] hover:text-[#737373] transition-colors mb-4 block"
          >
            ← History
          </a>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="font-mono text-sm text-[#e5e5e5] mb-1">
                {run.product_name || "(unnamed)"}
              </h1>
              <p className="text-xs text-[#404040] font-mono truncate max-w-md">
                {run.product_url}
              </p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-xs text-[#404040] font-mono">{formatDate(run.created_at)}</p>
              <p className="text-xs font-mono text-[#2563eb] mt-0.5">Run #{run.id}</p>
            </div>
          </div>

          <div className="flex items-center gap-4 mt-4">
            <FeedbackBadge value={run.feedback_stage1} label="S1" />
            <FeedbackBadge value={run.feedback_stage2} label="S2" />
            <FeedbackBadge value={run.feedback_stage3} label="S3" />
          </div>

          {run.notes && (
            <p className="mt-3 text-xs text-[#737373] bg-[#111] border border-[#2a2a2a] rounded px-3 py-2">
              {run.notes}
            </p>
          )}
        </div>

        <div className="space-y-6">
          {run.stage1_output && (
            <section>
              <h2 className="font-mono text-xs text-[#2563eb] tracking-[0.2em] uppercase mb-3">
                Stage 1 — Research Brief
              </h2>
              <div className="bg-[#0d0d0d] border border-[#2a2a2a] rounded-md p-4 max-h-[520px] overflow-y-auto">
                <pre className="whitespace-pre-wrap break-words text-[#d4d4d4] text-xs leading-relaxed font-mono">
                  {run.stage1_output}
                </pre>
              </div>
            </section>
          )}

          {run.stage2_output && (
            <section>
              <h2 className="font-mono text-xs text-[#2563eb] tracking-[0.2em] uppercase mb-3">
                Stage 2 — German Copy
              </h2>
              <div className="bg-[#0d0d0d] border border-[#2a2a2a] rounded-md p-4 max-h-[520px] overflow-y-auto">
                <pre className="whitespace-pre-wrap break-words text-[#d4d4d4] text-sm leading-relaxed">
                  {run.stage2_output}
                </pre>
              </div>
            </section>
          )}

          {imageUrls.length > 0 && (
            <section>
              <h2 className="font-mono text-xs text-[#2563eb] tracking-[0.2em] uppercase mb-3">
                Stage 3 — Generated Images
              </h2>

              {infographicUrls.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-mono text-[#404040] uppercase tracking-widest mb-2">
                    Infographic
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {infographicUrls.map((url, i) => (
                      <div key={i} className="aspect-square rounded overflow-hidden border border-[#2a2a2a]">
                        <img src={url} alt={`Infographic ${i + 1}`} className="w-full h-full object-cover" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {contextualUrls.length > 0 && (
                <div>
                  <p className="text-xs font-mono text-[#404040] uppercase tracking-widest mb-2">
                    Contextual
                  </p>
                  <div className="grid grid-cols-4 gap-2">
                    {contextualUrls.map((url, i) => (
                      <div key={i} className="aspect-square rounded overflow-hidden border border-[#2a2a2a]">
                        <img src={url} alt={`Contextual ${i + 1}`} className="w-full h-full object-cover" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
