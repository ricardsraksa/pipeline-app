"use client";

import { useState } from "react";
import JSZip from "jszip";
import type { Run } from "@/lib/db";
import EditableOutput from "@/components/EditableOutput";
import ImageReviewGrid from "@/components/ImageReviewGrid";

interface Props { run: Run }

/* ─── tiny helpers ─── */

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setOk(true);
          setTimeout(() => setOk(false), 1400);
        }).catch(() => {});
      }}
      className={`cursor-pointer font-mono text-[10px] px-2.5 py-1 rounded border transition-colors ${
        ok
          ? "border-emerald-900/50 text-emerald-400 bg-emerald-950/40"
          : "border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700 bg-transparent"
      }`}
    >
      {ok ? "Copied ✓" : "Copy"}
    </button>
  );
}

function DlBtn({ filename, text }: { filename: string; text: string }) {
  return (
    <button
      onClick={() => {
        const a = Object.assign(document.createElement("a"), {
          href: URL.createObjectURL(new Blob([text], { type: "text/plain" })),
          download: filename,
        });
        a.click();
        URL.revokeObjectURL(a.href);
      }}
      className="cursor-pointer font-mono text-[10px] px-2.5 py-1 rounded border border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700 transition-colors"
    >
      ↓ .txt
    </button>
  );
}

/* ─── collapsible scraped text ─── */
function CollapsibleText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 font-mono text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors py-1 cursor-pointer"
      >
        <span className="text-[8px]">{open ? "▼" : "▶"}</span>
        Scraped text — {text.length.toLocaleString()} chars
      </button>
      {open && (
        <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3">
          <pre className="whitespace-pre-wrap break-words font-mono text-[10px] text-zinc-400 leading-relaxed">
            {text}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ─── image grid + lightbox ─── */
function ImageGrid({ urls, cols = 4 }: { urls: string[]; cols?: number }) {
  const [lb, setLb] = useState<string | null>(null);
  if (!urls.length) return null;
  const gridCls = cols === 3 ? "grid-cols-3" : "grid-cols-4";
  return (
    <>
      <div className={`grid ${gridCls} gap-2`}>
        {urls.map((u, i) => (
          <button
            key={i}
            onClick={() => setLb(u)}
            className="cursor-pointer group aspect-square rounded-lg overflow-hidden border border-zinc-800 hover:border-zinc-600 transition-colors bg-zinc-900"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={u}
              alt={`Image ${i + 1}`}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
            />
          </button>
        ))}
      </div>
      {lb && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={() => setLb(null)}
        >
          <button
            onClick={() => setLb(null)}
            className="cursor-pointer absolute top-5 right-5 font-mono text-xs text-zinc-500 hover:text-zinc-100"
          >
            ✕
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lb}
            alt="Full size"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

/* ─── single doc card ─── */
function DocCard({
  label,
  text,
  filename,
  accent = false,
}: {
  label: string;
  text: string;
  filename: string;
  accent?: boolean;
}) {
  return (
    <div className={`rounded-lg border overflow-hidden ${accent ? "border-emerald-900/50 bg-emerald-950/20" : "border-zinc-800 bg-zinc-900/40"}`}>
      <div className={`flex items-center justify-between px-4 py-2 border-b ${accent ? "border-emerald-900/50" : "border-zinc-800"}`}>
        <span className={`font-mono text-[10px] uppercase tracking-widest ${accent ? "text-emerald-400" : "text-zinc-500"}`}>
          {label}
        </span>
        <div className="flex items-center gap-1.5">
          <CopyBtn text={text} />
          <DlBtn filename={filename} text={text} />
        </div>
      </div>
      <div className="max-h-[380px] overflow-y-auto">
        <pre className={`p-4 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed ${accent ? "text-zinc-300" : "text-zinc-400"}`}>
          {text}
        </pre>
      </div>
    </div>
  );
}

/* ─── step row: single or side-by-side ─── */
function StepRow({
  stepLabel,
  text,
  filename,
  revised,
  revisedFilename,
}: {
  stepLabel: string;
  text: string;
  filename: string;
  revised?: string | null;
  revisedFilename?: string;
}) {
  const hasRevision = Boolean(revised && revised !== text);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="font-mono text-[11px] text-zinc-500 uppercase tracking-widest">{stepLabel}</h3>
        {hasRevision && (
          <span className="text-[9px] font-mono bg-amber-950/40 text-amber-400 border border-amber-900/40 px-1.5 py-0.5 rounded-full uppercase tracking-wider">
            Revised
          </span>
        )}
      </div>
      {hasRevision ? (
        <div className="grid grid-cols-2 gap-2">
          <DocCard label="Original" text={text} filename={filename} />
          <DocCard label="Revised" text={revised!} filename={revisedFilename ?? filename} accent />
        </div>
      ) : (
        <DocCard label={stepLabel} text={text} filename={filename} />
      )}
    </div>
  );
}

/* ─── section wrapper ─── */
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="font-mono text-[10px] text-blue-400 uppercase tracking-widest">{label}</span>
        <div className="bg-zinc-800 h-px flex-1" />
      </div>
      {children}
    </section>
  );
}

/* ─── main component ─── */
export default function RunDetailClient({ run }: Props) {
  const slug = run.brand_name ?? run.product_name ?? `run_${run.id}`;

  const scraperData = (() => {
    try { return run.scraper_data ? JSON.parse(run.scraper_data) as { scraped_text?: string; images?: string[] } : null; }
    catch { return null; }
  })();

  const competitorUrls: string[] = (() => {
    try { return run.competitor_urls ? JSON.parse(run.competitor_urls) : []; }
    catch { return []; }
  })();

  const imageUrls: string[] = (() => {
    try { return run.image_urls ? JSON.parse(run.image_urls) : []; }
    catch { return []; }
  })();

  const scrapedImageUrls: string[] = (() => {
    try {
      if (run.scraped_image_urls) return JSON.parse(run.scraped_image_urls);
      return scraperData?.images ?? [];
    } catch { return scraperData?.images ?? []; }
  })();

  const approvedImageUrls: string[] = (() => {
    try { return run.approved_image_urls ? JSON.parse(run.approved_image_urls) : []; }
    catch { return []; }
  })();

  async function handleDownloadAll() {
    const zip = new JSZip();

    // inputs.txt
    zip.file("inputs.txt", [
      `Product URL: ${run.product_url}`,
      run.product_description ? `\nProduct Description:\n${run.product_description}` : "",
      competitorUrls.length ? `\nCompetitor URLs:\n${competitorUrls.join("\n")}` : "",
    ].filter(Boolean).join("\n"));

    if (scraperData) zip.file("scraper_data.json", JSON.stringify(scraperData, null, 2));

    const files: [string | null, string][] = [
      [run.step_research,                `${slug}_RESEARCH.txt`],
      [run.step_chief_mid,               `${slug}_CHIEF_MID.txt`],
      [run.step_research_revised,        `${slug}_RESEARCH_REVISED.txt`],
      [run.step_avatar,                  `${slug}_AVATAR.txt`],
      [run.step_avatar_revised,          `${slug}_AVATAR_REVISED.txt`],
      [run.step_offer_brief,             `${slug}_OFFER_BRIEF.txt`],
      [run.step_offer_brief_revised,     `${slug}_OFFER_BRIEF_REVISED.txt`],
      [run.step_necessary_beliefs,       `${slug}_NECESSARY_BELIEFS.txt`],
      [run.step_necessary_beliefs_revised, `${slug}_NECESSARY_BELIEFS_REVISED.txt`],
      [run.step_chief_final,             `${slug}_CHIEF_FINAL.txt`],
      [run.stage2_output,                `${slug}_STAGE2_GERMAN_COPY.txt`],
    ];
    for (const [content, name] of files) if (content) zip.file(name, content);
    if (imageUrls.length) zip.file("generated_image_urls.txt", imageUrls.join("\n"));

    const blob = await zip.generateAsync({ type: "blob" });
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(blob),
      download: `${slug}_run_${run.id}.zip`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const hasAnyStep =
    run.step_research || run.step_chief_mid || run.step_research_revised ||
    run.step_avatar || run.step_offer_brief || run.step_necessary_beliefs || run.step_chief_final;

  return (
    <div className="space-y-10">

      {/* Download All */}
      <div className="flex justify-end">
        <button
          onClick={handleDownloadAll}
          className="cursor-pointer px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          ↓ Download All (.zip)
        </button>
      </div>

      {/* Inputs */}
      <Section label="Inputs">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 divide-y divide-zinc-800">
          <div className="flex items-start gap-4 px-4 py-3">
            <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider w-28 flex-shrink-0 pt-0.5">
              Product URL
            </span>
            <a
              href={run.product_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-400 hover:underline break-all"
            >
              {run.product_url}
            </a>
          </div>
          {run.product_description && (
            <div className="flex items-start gap-4 px-4 py-3">
              <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider w-28 flex-shrink-0 pt-0.5">
                Description
              </span>
              <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
                {run.product_description}
              </p>
            </div>
          )}
          {competitorUrls.length > 0 && (
            <div className="flex items-start gap-4 px-4 py-3">
              <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider w-28 flex-shrink-0 pt-0.5">
                Competitors
              </span>
              <div className="space-y-1">
                {competitorUrls.map((u, i) => (
                  <a
                    key={i}
                    href={u}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-sm text-blue-400 hover:underline break-all"
                  >
                    {u}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* Scraper Data */}
      {scraperData && (scraperData.scraped_text || (scraperData.images?.length ?? 0) > 0) && (
        <Section label="Scraper Data">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 divide-y divide-zinc-800">
            {scrapedImageUrls.length > 0 && (
              <div className="p-4">
                <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest mb-2">
                  Product images · {scrapedImageUrls.length} scraped · {approvedImageUrls.length} approved
                </p>
                <ImageReviewGrid
                  runId={run.id}
                  scrapedUrls={scrapedImageUrls}
                  approvedUrls={approvedImageUrls}
                  onApprovedChange={() => {}}
                  readOnly
                />
              </div>
            )}
            {scraperData.scraped_text && (
              <div className="px-4 py-3">
                <CollapsibleText text={scraperData.scraped_text} />
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Pipeline Steps */}
      {hasAnyStep && (
        <Section label="Pipeline Steps">
          <div className="space-y-4">
            {run.step_research && (
              <EditableOutput
                runId={run.id}
                field="stage1_research"
                stage="stage1"
                originalValue={run.step_research}
                editedValue={run.stage1_research_edited}
                editedAt={run.stage1_edited_at}
                label="Step 1 — Research Brief"
                monospace
              />
            )}
            {run.step_chief_mid && (
              <EditableOutput
                runId={run.id}
                field="stage1_chief_mid"
                stage="stage1"
                originalValue={run.step_chief_mid}
                editedValue={run.stage1_chief_mid_edited}
                editedAt={run.stage1_edited_at}
                label="Step 2 — Chief Marketer Analysis"
                monospace
              />
            )}
            {run.step_research_revised && (
              <DocCard
                label="Step 3 — Research Revised"
                text={run.step_research_revised}
                filename={`${slug}_RESEARCH_REVISED.txt`}
              />
            )}
            {run.step_avatar && (
              <EditableOutput
                runId={run.id}
                field="stage1_avatar"
                stage="stage1"
                originalValue={run.step_avatar}
                editedValue={run.stage1_avatar_edited}
                editedAt={run.stage1_edited_at}
                label="Step 4a — Customer Avatar"
                monospace
              />
            )}
            {run.step_avatar_revised && (
              <EditableOutput
                runId={run.id}
                field="stage1_avatar_revised"
                stage="stage1"
                originalValue={run.step_avatar_revised}
                editedValue={run.stage1_avatar_revised_edited}
                editedAt={run.stage1_edited_at}
                label="Step 4a — Revised Avatar"
                monospace
              />
            )}
            {run.step_offer_brief && (
              <EditableOutput
                runId={run.id}
                field="stage1_offer_brief"
                stage="stage1"
                originalValue={run.step_offer_brief}
                editedValue={run.stage1_offer_brief_edited}
                editedAt={run.stage1_edited_at}
                label="Step 4b — Offer Brief"
                monospace
              />
            )}
            {run.step_offer_brief_revised && (
              <EditableOutput
                runId={run.id}
                field="stage1_offer_brief_revised"
                stage="stage1"
                originalValue={run.step_offer_brief_revised}
                editedValue={run.stage1_offer_brief_revised_edited}
                editedAt={run.stage1_edited_at}
                label="Step 4b — Revised Offer Brief"
                monospace
              />
            )}
            {run.step_necessary_beliefs && (
              <EditableOutput
                runId={run.id}
                field="stage1_necessary_beliefs"
                stage="stage1"
                originalValue={run.step_necessary_beliefs}
                editedValue={run.stage1_necessary_beliefs_edited}
                editedAt={run.stage1_edited_at}
                label="Step 4c — Necessary Beliefs"
                monospace
              />
            )}
            {run.step_necessary_beliefs_revised && (
              <EditableOutput
                runId={run.id}
                field="stage1_necessary_beliefs_revised"
                stage="stage1"
                originalValue={run.step_necessary_beliefs_revised}
                editedValue={run.stage1_necessary_beliefs_revised_edited}
                editedAt={run.stage1_edited_at}
                label="Step 4c — Revised Necessary Beliefs"
                monospace
              />
            )}
            {run.step_chief_final && (
              <EditableOutput
                runId={run.id}
                field="stage1_chief_final"
                stage="stage1"
                originalValue={run.step_chief_final}
                editedValue={run.stage1_chief_final_edited}
                editedAt={run.stage1_edited_at}
                label="Step 5 — Final Chief Review"
                monospace
              />
            )}
          </div>
        </Section>
      )}

      {/* Stage 2 — German Copy */}
      {run.stage2_output && (
        <Section label="Stage 2 — German Copy">
          <EditableOutput
            runId={run.id}
            field="stage2_copy"
            stage="stage2"
            originalValue={run.stage2_output}
            editedValue={run.stage2_copy_edited}
            editedAt={run.stage2_edited_at}
            label="German Copy Kit"
            monospace={false}
          />
        </Section>
      )}

      {/* Generated Images */}
      {imageUrls.length > 0 && (
        <Section label={`Stage 3 — Generated Images · ${imageUrls.length}`}>
          <ImageGrid urls={imageUrls} cols={4} />
        </Section>
      )}
    </div>
  );
}
