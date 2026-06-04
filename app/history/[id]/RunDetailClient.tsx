"use client";

import { useState } from "react";
import Link from "next/link";
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
      className={`cursor-pointer font-[var(--font-ibm-plex-mono)] text-[10px] px-2.5 py-1 rounded border transition-colors ${
        ok
          ? "border-[var(--color-green)] text-[var(--color-green)] bg-[var(--color-green-bg)]"
          : "border-[var(--color-border)] text-[var(--color-text-3)] hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)]"
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
      className="cursor-pointer font-[var(--font-ibm-plex-mono)] text-[10px] px-2.5 py-1 rounded border border-[var(--color-border)] text-[var(--color-text-3)] hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)] transition-colors"
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
        className="flex items-center gap-2 font-[var(--font-ibm-plex-mono)] text-[10px] text-[var(--color-text-3)] hover:text-[var(--color-text-2)] transition-colors py-1 cursor-pointer"
      >
        <span className="text-[8px]">{open ? "▼" : "▶"}</span>
        Scraped text — {text.length.toLocaleString()} chars
      </button>
      {open && (
        <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
          <pre className="whitespace-pre-wrap break-words font-[var(--font-ibm-plex-mono)] text-[10px] text-[var(--color-text-2)] leading-relaxed">
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
            className="cursor-pointer group aspect-square rounded-[9px] overflow-hidden border border-[var(--color-border)] hover:border-[var(--color-border-strong)] transition-colors bg-[var(--color-surface-2)]"
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setLb(null)}
        >
          <button
            onClick={() => setLb(null)}
            className="cursor-pointer absolute top-5 right-5 font-[var(--font-ibm-plex-mono)] text-xs text-white/50 hover:text-white/90 transition-colors"
          >
            ✕
          </button>
          <button
            onClick={async (e) => {
              e.stopPropagation();
              const url = lb;
              try {
                const res = await fetch(url);
                const blob = await res.blob();
                const objUrl = URL.createObjectURL(blob);
                const ext = url.split(/[?#]/)[0].split(".").pop()?.slice(0, 4) || "png";
                const a = Object.assign(document.createElement("a"), {
                  href: objUrl,
                  download: `image_${Date.now()}.${ext}`,
                });
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(objUrl);
              } catch {
                window.open(url, "_blank", "noopener");
              }
            }}
            className="cursor-pointer absolute top-5 left-5 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-[550] bg-white/10 hover:bg-white/20 text-white border border-white/15 transition-colors"
          >
            Download
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
    <div className={`rounded-[11px] border overflow-hidden ${accent ? "border-[var(--color-green)] bg-[var(--color-green-bg)]" : "border-[var(--color-border)] bg-[var(--color-surface)]"}`}>
      <div className={`flex items-center justify-between px-4 py-2 border-b ${accent ? "border-[var(--color-green)]/30" : "border-[var(--color-border)]"}`}>
        <span className={`font-[var(--font-ibm-plex-mono)] text-[10px] uppercase tracking-widest ${accent ? "text-[var(--color-green)]" : "text-[var(--color-text-3)]"}`}>
          {label}
        </span>
        <div className="flex items-center gap-1.5">
          <CopyBtn text={text} />
          <DlBtn filename={filename} text={text} />
        </div>
      </div>
      <div className="max-h-[380px] overflow-y-auto">
        <pre className={`p-4 whitespace-pre-wrap break-words font-[var(--font-ibm-plex-mono)] text-[11px] leading-relaxed ${accent ? "text-[var(--color-text)]" : "text-[var(--color-text-2)]"}`}>
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
        <h3 className="font-[var(--font-ibm-plex-mono)] text-[11px] text-[var(--color-text-3)] uppercase tracking-widest">{stepLabel}</h3>
        {hasRevision && (
          <span className="inline-flex items-center gap-1.5 text-xs font-[620] px-2.5 py-1 rounded-full bg-[var(--color-amber-bg)] text-[var(--color-amber)] whitespace-nowrap">
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
        <span className="text-[11px] font-[650] uppercase tracking-[0.1em] text-[var(--color-accent)]">{label}</span>
        <div className="bg-[var(--color-border)] h-px flex-1" />
      </div>
      {children}
    </section>
  );
}

/* ─── main component ─── */
export default function RunDetailClient({ run }: Props) {
  const slug = run.brand_name ?? run.product_name ?? `run_${run.id}`;
  const [imagesZipping, setImagesZipping] = useState(false);

  const scraperData = (() => {
    try { return run.scraper_data ? JSON.parse(run.scraper_data) as { scraped_text?: string; images?: string[] } : null; }
    catch { return null; }
  })();

  const competitorUrls: string[] = (() => {
    try { return run.competitor_urls ? JSON.parse(run.competitor_urls) : []; }
    catch { return []; }
  })();

  const imageUrls: string[] = (() => {
    try {
      // New hero-first flow: hero image + the 8 derivatives in
      // stage3_remaining_images. This is where completed runs now store
      // their images, so check it first.
      const heroFlow: string[] = [];
      if (run.stage3_hero_image_url) heroFlow.push(run.stage3_hero_image_url);
      if (run.stage3_remaining_images) {
        const parsed = JSON.parse(run.stage3_remaining_images);
        if (Array.isArray(parsed)) {
          for (const g of parsed as Array<{ image_url?: string; status?: string }>) {
            if (g?.image_url && g.status !== "failed") heroFlow.push(g.image_url);
          }
        }
      }
      if (heroFlow.length) return heroFlow;

      // Explicit image_urls column, if populated.
      if (run.image_urls) {
        const parsed = JSON.parse(run.image_urls);
        if (Array.isArray(parsed) && parsed.length) return parsed as string[];
      }
      // Legacy /stage3 path: generated_images. Each entry is
      // { prompt_index, category, image_url, status }.
      if (run.generated_images) {
        const parsed = JSON.parse(run.generated_images);
        if (Array.isArray(parsed)) {
          return parsed
            .filter((g: { image_url?: string; status?: string }) => g?.image_url && g.status !== "failed")
            .map((g: { image_url: string }) => g.image_url);
        }
      }
      return [];
    } catch { return []; }
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

  async function handleDownloadImages() {
    if (!imageUrls.length || imagesZipping) return;
    setImagesZipping(true);
    try {
      const zip = new JSZip();
      const pad = (n: number) => String(n).padStart(2, "0");
      // Fetch each image as a blob and add to the zip. If a CDN blocks the
      // cross-origin fetch we just skip that one (rare; the per-image
      // lightbox download uses the same fetch and works in practice).
      for (let i = 0; i < imageUrls.length; i++) {
        const url = imageUrls[i];
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          const blob = await res.blob();
          const ext = (url.split(/[?#]/)[0].split(".").pop() || "png").slice(0, 4);
          zip.file(`image_${pad(i + 1)}.${ext}`, blob);
        } catch { /* skip */ }
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const a = Object.assign(document.createElement("a"), {
        href: URL.createObjectURL(blob),
        download: `${slug}_images.zip`,
      });
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setImagesZipping(false);
    }
  }

  async function handleDownloadAll() {
    const zip = new JSZip();

    zip.file("inputs.txt", [
      `Product URL: ${run.product_url}`,
      run.product_description ? `\nProduct Description:\n${run.product_description}` : "",
      competitorUrls.length ? `\nCompetitor URLs:\n${competitorUrls.join("\n")}` : "",
    ].filter(Boolean).join("\n"));

    if (scraperData) zip.file("scraper_data.json", JSON.stringify(scraperData, null, 2));

    const files: [string | null, string][] = [
      [run.stage1_one_pager_edited ?? run.stage1_one_pager, `${slug}_STAGE1_ONE_PAGER.md`],
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

  // Runs that finished a stage but are stalled waiting for the operator's next
  // action (Stage 2 approval, image approval, QC verdict) need to land on the
  // live run page to move forward — the static history detail can't drive them.
  const waitingStatuses = new Set([
    "awaiting_stage2_approval",
    "awaiting_user",
    "awaiting_qc",
  ]);
  const isWaiting = waitingStatuses.has(run.status ?? "");
  const isFailed = run.status === "failed";
  const canContinue = isWaiting || isFailed;

  return (
    <div className="space-y-10">

      {canContinue && (
        <div className="flex items-start gap-3 rounded-[11px] border border-[var(--color-amber)] bg-[var(--color-amber-bg)] px-4 py-3 text-[13px] text-[var(--color-text)]">
          <span className="font-[var(--font-ibm-plex-mono)] text-[10px] uppercase tracking-widest text-[var(--color-amber)] mt-0.5">
            {isFailed ? "Failed" : "Waiting"}
          </span>
          <div className="flex-1">
            <p className="font-[600]">
              {isFailed
                ? "This run failed mid-pipeline."
                : run.status === "awaiting_stage2_approval"
                  ? "Stage 1 finished. Stage 2 hasn't started yet — your approval is needed to continue."
                  : run.status === "awaiting_user"
                    ? "Stage 3 is waiting for image approval."
                    : "QC review is required before the pipeline continues."}
            </p>
            <p className="text-[var(--color-text-2)] text-[12px] mt-0.5">
              Use the live run page to pick up where this left off.
            </p>
          </div>
          <Link
            href={`/runs/${run.id}`}
            className="cursor-pointer inline-flex items-center gap-[7px] rounded-lg px-[13px] py-[7px] text-[12.5px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] border border-transparent transition-all hover:brightness-105 whitespace-nowrap"
          >
            {isFailed ? "Open & retry →" : "Continue run →"}
          </Link>
        </div>
      )}

      {/* Download All */}
      <div className="flex justify-end">
        <button
          onClick={handleDownloadAll}
          className="cursor-pointer inline-flex items-center gap-[7px] rounded-lg px-[15px] py-[9px] text-[13.5px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] border border-transparent transition-all hover:brightness-105 whitespace-nowrap"
        >
          ↓ Download All (.zip)
        </button>
      </div>

      {/* Inputs */}
      <Section label="Inputs">
        <div className="border border-[var(--color-border)] rounded-[11px] bg-[var(--color-surface)] shadow-[0_1px_2px_rgba(20,20,18,.05)] divide-y divide-[var(--color-border)]">
          {run.product_url ? (
            <div className="flex items-start gap-4 px-4 py-3">
              <span className="font-[var(--font-ibm-plex-mono)] text-[10px] text-[var(--color-text-3)] uppercase tracking-wider w-28 flex-shrink-0 pt-0.5">
                Product URL
              </span>
              <a
                href={run.product_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-[var(--color-accent)] hover:underline break-all"
              >
                {run.product_url}
              </a>
            </div>
          ) : (
            <div className="flex items-start gap-4 px-4 py-3">
              <span className="font-[var(--font-ibm-plex-mono)] text-[10px] text-[var(--color-text-3)] uppercase tracking-wider w-28 flex-shrink-0 pt-0.5">
                Source
              </span>
              <span className="text-sm text-[var(--color-text-3)]">No URL — uploaded source images</span>
            </div>
          )}
          {run.product_description && (
            <div className="flex items-start gap-4 px-4 py-3">
              <span className="font-[var(--font-ibm-plex-mono)] text-[10px] text-[var(--color-text-3)] uppercase tracking-wider w-28 flex-shrink-0 pt-0.5">
                Description
              </span>
              <p className="text-sm text-[var(--color-text-2)] leading-relaxed whitespace-pre-wrap">
                {run.product_description}
              </p>
            </div>
          )}
          {competitorUrls.length > 0 && (
            <div className="flex items-start gap-4 px-4 py-3">
              <span className="font-[var(--font-ibm-plex-mono)] text-[10px] text-[var(--color-text-3)] uppercase tracking-wider w-28 flex-shrink-0 pt-0.5">
                Competitors
              </span>
              <div className="space-y-1">
                {competitorUrls.map((u, i) => (
                  <a
                    key={i}
                    href={u}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-sm text-[var(--color-accent)] hover:underline break-all"
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
          <div className="border border-[var(--color-border)] rounded-[11px] bg-[var(--color-surface)] shadow-[0_1px_2px_rgba(20,20,18,.05)] divide-y divide-[var(--color-border)]">
            {scrapedImageUrls.length > 0 && (
              <div className="p-4">
                <p className="font-[var(--font-ibm-plex-mono)] text-[10px] text-[var(--color-text-3)] uppercase tracking-widest mb-2">
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

      {/* Stage 1 — only the synthesised one-pager is shown */}
      {run.stage1_one_pager && (
        <Section label="Stage 1 — Research summary">
          <EditableOutput
            runId={run.id}
            field="stage1_one_pager"
            stage="stage1"
            originalValue={run.stage1_one_pager}
            editedValue={run.stage1_one_pager_edited}
            editedAt={run.stage1_one_pager_edited_at}
            label="Research one-pager"
            monospace={false}
            downloadFilename={`${slug}_STAGE1_ONE_PAGER.md`}
          />
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
            downloadFilename={`${slug}_STAGE2_GERMAN_COPY.txt`}
          />
        </Section>
      )}

      {/* Generated Images */}
      {imageUrls.length > 0 && (
        <Section label={`Stage 3 — Generated Images · ${imageUrls.length}`}>
          <div className="flex flex-wrap items-center justify-end gap-2 mb-2">
            <Link
              href={`/stage3?runId=${run.id}&skipPrompts=1`}
              className="cursor-pointer inline-flex items-center gap-[7px] rounded-lg px-[13px] py-[7px] text-[12.5px] font-[620] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] transition-all hover:border-[var(--color-text-3)] hover:bg-[var(--color-surface-2)] whitespace-nowrap"
              title="Open Stage 3 with the saved prompts so you can re-run image generation"
            >
              ↺ Regenerate images
            </Link>
            <button
              onClick={() => handleDownloadImages()}
              disabled={imagesZipping}
              className="cursor-pointer inline-flex items-center gap-[7px] rounded-lg px-[13px] py-[7px] text-[12.5px] font-[620] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] transition-all hover:border-[var(--color-text-3)] hover:bg-[var(--color-surface-2)] whitespace-nowrap disabled:opacity-60"
            >
              {imagesZipping ? "Zipping…" : "↓ Download all images (.zip)"}
            </button>
          </div>
          <ImageGrid urls={imageUrls} cols={4} />
        </Section>
      )}
    </div>
  );
}
