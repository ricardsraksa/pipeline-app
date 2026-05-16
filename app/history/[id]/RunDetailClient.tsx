"use client";

import { useState } from "react";
import JSZip from "jszip";
import type { Run } from "@/lib/db";

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
      className={`font-mono text-[10px] px-2.5 py-1 rounded border transition-colors ${
        ok
          ? "border-emerald-800 text-emerald-500 bg-emerald-950/40"
          : "border-[#333] text-[#666] hover:text-[#aaa] hover:border-[#555] bg-transparent"
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
      className="font-mono text-[10px] px-2.5 py-1 rounded border border-[#333] text-[#666] hover:text-[#aaa] hover:border-[#555] transition-colors"
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
        className="flex items-center gap-2 font-mono text-[10px] text-[#666] hover:text-[#aaa] transition-colors py-1"
      >
        <span className="text-[8px]">{open ? "▼" : "▶"}</span>
        Scraped text — {text.length.toLocaleString()} chars
      </button>
      {open && (
        <div className="mt-2 max-h-64 overflow-y-auto rounded border border-[#1a1a1a] bg-[#080808] p-3">
          <pre className="whitespace-pre-wrap break-words font-mono text-[10px] text-[#888] leading-relaxed">
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
            className="group aspect-square rounded-md overflow-hidden border border-[#1a1a1a] hover:border-[#2563eb]/40 transition-colors bg-[#0c0c0c]"
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
          onClick={() => setLb(null)}
        >
          <button
            onClick={() => setLb(null)}
            className="absolute top-5 right-5 font-mono text-xs text-[#737373] hover:text-white"
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
    <div className={`rounded-lg border overflow-hidden ${accent ? "border-[#1a3a2a] bg-[#090f0a]" : "border-[#222] bg-[#0c0c0c]"}`}>
      <div className={`flex items-center justify-between px-4 py-2 border-b ${accent ? "border-[#1a3a2a]" : "border-[#222]"}`}>
        <span className={`font-mono text-[10px] uppercase tracking-wider ${accent ? "text-emerald-500" : "text-[#555]"}`}>
          {label}
        </span>
        <div className="flex items-center gap-1.5">
          <CopyBtn text={text} />
          <DlBtn filename={filename} text={text} />
        </div>
      </div>
      <div className="max-h-[380px] overflow-y-auto p-4">
        <pre className={`whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed ${accent ? "text-[#c8c8c8]" : "text-[#737373]"}`}>
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
        <h3 className="font-mono text-[11px] text-[#666] uppercase tracking-widest">{stepLabel}</h3>
        {hasRevision && (
          <span className="font-mono text-[9px] text-amber-500 bg-amber-950/40 border border-amber-900/40 px-1.5 py-0.5 rounded-full uppercase tracking-wider">
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
        <span className="font-mono text-[9px] text-[#2563eb] tracking-[0.25em] uppercase">{label}</span>
        <div className="flex-1 h-px bg-[#222]" />
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
          className="font-mono text-xs bg-[#2563eb] hover:bg-[#1d4ed8] text-white px-4 py-2 rounded-md transition-colors"
        >
          ↓ Download All (.zip)
        </button>
      </div>

      {/* Inputs */}
      <Section label="Inputs">
        <div className="rounded-lg border border-[#222] bg-[#0c0c0c] divide-y divide-[#222]">
          <div className="flex items-start gap-4 px-4 py-3">
            <span className="font-mono text-[9px] text-[#555] uppercase tracking-wider w-28 flex-shrink-0 pt-0.5">
              Product URL
            </span>
            <a
              href={run.product_url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[11px] text-[#2563eb] hover:underline break-all"
            >
              {run.product_url}
            </a>
          </div>
          {run.product_description && (
            <div className="flex items-start gap-4 px-4 py-3">
              <span className="font-mono text-[9px] text-[#555] uppercase tracking-wider w-28 flex-shrink-0 pt-0.5">
                Description
              </span>
              <p className="font-mono text-[11px] text-[#555] leading-relaxed whitespace-pre-wrap">
                {run.product_description}
              </p>
            </div>
          )}
          {competitorUrls.length > 0 && (
            <div className="flex items-start gap-4 px-4 py-3">
              <span className="font-mono text-[9px] text-[#555] uppercase tracking-wider w-28 flex-shrink-0 pt-0.5">
                Competitors
              </span>
              <div className="space-y-1">
                {competitorUrls.map((u, i) => (
                  <a
                    key={i}
                    href={u}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block font-mono text-[11px] text-[#2563eb] hover:underline break-all"
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
          <div className="rounded-lg border border-[#222] bg-[#0c0c0c] divide-y divide-[#222]">
            {scraperData.images && scraperData.images.length > 0 && (
              <div className="p-4">
                <p className="font-mono text-[9px] text-[#555] uppercase tracking-wider mb-3">
                  Product images · {scraperData.images.length}
                </p>
                <ImageGrid urls={scraperData.images} cols={4} />
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
              <StepRow
                stepLabel="Step 1 — Research"
                text={run.step_research}
                filename={`${slug}_RESEARCH.txt`}
              />
            )}
            {run.step_chief_mid && (
              <StepRow
                stepLabel="Step 2 — Mid Chief Review"
                text={run.step_chief_mid}
                filename={`${slug}_CHIEF_MID.txt`}
              />
            )}
            {run.step_research_revised && (
              <StepRow
                stepLabel="Step 3 — Research Revised"
                text={run.step_research_revised}
                filename={`${slug}_RESEARCH_REVISED.txt`}
              />
            )}
            {run.step_avatar && (
              <StepRow
                stepLabel="Step 4a — Avatar"
                text={run.step_avatar}
                filename={`${slug}_AVATAR.txt`}
                revised={run.step_avatar_revised}
                revisedFilename={`${slug}_AVATAR_REVISED.txt`}
              />
            )}
            {run.step_offer_brief && (
              <StepRow
                stepLabel="Step 4b — Offer Brief"
                text={run.step_offer_brief}
                filename={`${slug}_OFFER_BRIEF.txt`}
                revised={run.step_offer_brief_revised}
                revisedFilename={`${slug}_OFFER_BRIEF_REVISED.txt`}
              />
            )}
            {run.step_necessary_beliefs && (
              <StepRow
                stepLabel="Step 4c — Necessary Beliefs"
                text={run.step_necessary_beliefs}
                filename={`${slug}_NECESSARY_BELIEFS.txt`}
                revised={run.step_necessary_beliefs_revised}
                revisedFilename={`${slug}_NECESSARY_BELIEFS_REVISED.txt`}
              />
            )}
            {run.step_chief_final && (
              <StepRow
                stepLabel="Step 5 — Final Chief Review"
                text={run.step_chief_final}
                filename={`${slug}_CHIEF_FINAL.txt`}
              />
            )}
          </div>
        </Section>
      )}

      {/* Stage 2 — German Copy */}
      {run.stage2_output && (
        <Section label="Stage 2 — German Copy">
          <DocCard
            label="German Copy Kit"
            text={run.stage2_output}
            filename={`${slug}_STAGE2_GERMAN_COPY.txt`}
            accent
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
