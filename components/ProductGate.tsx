"use client";

// Stage 1 · Product — the review gate.
//
// Shows what scrapling read from each pasted URL, the analyst's 120-word
// description (editable in place), and every photo the run has (scraped
// gallery, seller description images, competitor photos, own uploads) as
// tickable tiles. "Approve" writes the final text + selection onto the run and
// starts research. When the hosted scraper couldn't read the product page,
// the same card explains the local fallback (the Mac script with --push) and
// still lets the operator describe the product by hand.

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/Toasts";
import {
  parseProductScrape,
  productCandidateImages,
  productPageOf,
  defaultSelectedImages,
  type ProductScrapePage,
} from "@/lib/product";
import type { RunStatus } from "@/hooks/useRunPolling";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url.slice(0, 40); }
}

const GROUP_LABEL: Record<string, string> = {
  uploaded: "Your uploads",
  product: "Product listing photos",
  description: "Seller description images",
  competitor: "Competitor / brand photos",
};

function PageRow({ p }: { p: ProductScrapePage }) {
  const facts = [
    p.price ? `Price ${p.price}` : null,
    p.rating ? `★ ${p.rating}` : null,
    p.reviews ? `${p.reviews} reviews` : null,
    p.sold ? `${p.sold} sold` : null,
    p.options && Object.keys(p.options).length ? `${Object.keys(p.options).length} option group${Object.keys(p.options).length === 1 ? "" : "s"}` : null,
    p.image_urls.length ? `${p.image_urls.length} photos` : null,
    p.description_image_urls.length ? `${p.description_image_urls.length} description images` : null,
  ].filter(Boolean);
  return (
    <div className="flex items-start gap-2.5 py-2">
      <span className={cx("mt-1 w-2 h-2 rounded-full shrink-0", p.ok ? "bg-[var(--color-green)]" : "bg-[var(--color-red)]")} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="ff-mono text-[10.5px] uppercase tracking-widest text-[var(--color-text-3)]">{p.role === "product" ? "Product" : "Competitor"}</span>
          <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-[12.5px] text-[var(--color-text)] hover:text-[var(--color-accent-text)] tr truncate max-w-full">{hostOf(p.url)}</a>
          {p.mode && <span className="ff-mono text-[10px] text-[var(--color-text-4)]">{p.mode}</span>}
        </div>
        {p.ok ? (
          <p className="text-[12px] text-[var(--color-text-2)] truncate">{p.title || "(no title)"}{facts.length ? ` · ${facts.join(" · ")}` : ""}</p>
        ) : (
          <p className="text-[12px] text-[var(--color-red)]">{p.error || "Couldn't read this page"}</p>
        )}
      </div>
    </div>
  );
}

export default function ProductGate({
  runId,
  run,
  onChanged,
}: {
  runId: number;
  run: RunStatus;
  onChanged: () => void;
}) {
  const { push } = useToast();
  const product = run.product;
  const scrape = useMemo(() => parseProductScrape(product?.scrape), [product?.scrape]);
  // Own photos: what the run has, plus anything added here (persisted at once
  // so approve-product recognises them as belonging to the run).
  const [uploaded, setUploaded] = useState<string[]>(run.meta.uploadedSourceImages ?? []);
  useEffect(() => {
    setUploaded((prev) => {
      const fromRun = run.meta.uploadedSourceImages ?? [];
      return fromRun.length >= prev.length ? fromRun : prev;
    });
  }, [run.meta.uploadedSourceImages]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const candidates = useMemo(() => productCandidateImages(scrape, uploaded), [scrape, uploaded]);
  const productPage = productPageOf(scrape);
  const waiting = run.status === "awaiting_product_approval";
  const approved = Boolean(product?.approvedAt);

  const initialText = product?.descriptionEdited ?? product?.descriptionAi ?? run.meta.productDescription ?? "";
  const [text, setText] = useState(initialText);
  const [selected, setSelected] = useState<string[]>(
    product?.selectedImages?.length ? product.selectedImages : defaultSelectedImages(scrape, uploaded),
  );
  const [regenerating, setRegenerating] = useState(false);
  const [approving, setApproving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // When a regenerate / local push lands a new description, adopt it.
  useEffect(() => { setText(product?.descriptionEdited ?? product?.descriptionAi ?? ""); }, [product?.descriptionAi, product?.descriptionEdited]);
  useEffect(() => {
    if (product?.selectedImages?.length) setSelected(product.selectedImages);
    else setSelected(defaultSelectedImages(scrape, uploaded));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.scrape]);

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const selSet = new Set(selected);
  const canApprove = waiting && text.trim().length >= 20 && selected.length > 0 && !approving && !regenerating;

  function toggle(url: string) {
    if (!waiting) return;
    setErr(null);
    if (selSet.has(url)) setSelected((p) => p.filter((u) => u !== url));
    else if (selected.length >= 10) setErr("Max 10 photos — untick one first.");
    else setSelected((p) => [...p, url]);
  }

  async function addPhotos(files: FileList | null) {
    if (!files || !files.length || !waiting) return;
    setErr(null);
    setUploading(true);
    try {
      const fd = new FormData();
      Array.from(files).slice(0, 10).forEach((f) => fd.append("images", f));
      const up = await fetch("/api/upload-source-images", { method: "POST", body: fd });
      const data = await up.json();
      if (!up.ok || !Array.isArray(data.urls)) throw new Error(data.error ?? `Upload failed (HTTP ${up.status})`);
      const next = [...uploaded, ...(data.urls as string[])].filter((u, i, a) => a.indexOf(u) === i).slice(0, 20);
      const save = await fetch(`/api/runs/${runId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploaded_source_images: next }),
      });
      if (!save.ok) throw new Error(`Couldn't save the photos (HTTP ${save.status})`);
      setUploaded(next);
      // New photos are what you meant to use — tick them (up to the cap).
      setSelected((p) => [...p, ...(data.urls as string[]).filter((u) => !p.includes(u))].slice(0, 10));
      push(`${(data.urls as string[]).length} photo${data.urls.length === 1 ? "" : "s"} added`, "success");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function regenerate() {
    if (!waiting || regenerating) return;
    setRegenerating(true); setErr(null);
    try {
      const res = await fetch(`/api/runs/${runId}/product-describe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: true }) });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? `HTTP ${res.status}`);
      setText(data.description);
      push("Description rewritten", "success");
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't regenerate");
    } finally { setRegenerating(false); }
  }

  async function approve() {
    if (!canApprove) return;
    setApproving(true); setErr(null);
    try {
      const res = await fetch(`/api/runs/${runId}/approve-product`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: text.trim(), selectedImages: selected }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? `HTTP ${res.status}`);
      push("Approved — research is running", "success");
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't approve");
      setApproving(false);
    }
  }

  // The Mac worker polls every ~20s; anything older than 2 minutes means it
  // isn't running (Mac asleep, agent not installed).
  const lastSeenMs = product?.workerLastSeen ? Date.now() - new Date(product.workerLastSeen).getTime() : Infinity;
  const workerOnline = lastSeenMs < 2 * 60 * 1000;
  const workerAgo = lastSeenMs < 60_000 ? "just now" : `${Math.round(lastSeenMs / 60_000)} min ago`;
  const pushCmd = `scrapling-py ~/Desktop/supplier-scrape.py --push ${typeof window !== "undefined" ? window.location.origin : ""} --run ${runId} ${run.meta.productUrl || "<product url>"}`;

  const grouped = (["uploaded", "product", "description", "competitor"] as const)
    .map((g) => ({ g, items: candidates.filter((c) => c.group === g) }))
    .filter((x) => x.items.length);

  return (
    <div className="space-y-4">
      {/* what was read */}
      {scrape && (
        <div className="border border-[var(--color-border)] rounded-[var(--radius)] bg-[var(--color-surface-2)] px-4 py-1.5 divide-y divide-[var(--color-border)]">
          {scrape.pages.map((p) => <PageRow key={p.url} p={p} />)}
        </div>
      )}

      {/* the page is being handled by the Mac worker, or needs a manual scrape */}
      {waiting && productPage && !productPage.ok && (
        <div className="rounded-[var(--radius-sm)] bg-[var(--color-amber-bg)] px-4 py-3 space-y-2">
          {productPage.deferred ? (
            <>
              <p className="text-[12.5px] font-[620] text-[var(--color-text)] flex items-center gap-2">
                {workerOnline ? <Icon.Loader className="w-3.5 h-3.5" /> : null}
                {workerOnline
                  ? "Your Mac is scraping this page — the description appears here automatically (usually under a minute)."
                  : "Waiting for your Mac. The pipeline worker isn't running there right now."}
              </p>
              <p className="text-[12px] text-[var(--color-text-2)]">
                {workerOnline
                  ? `Worker last checked in ${workerAgo}.`
                  : "Wake the Mac (the worker starts on login), or run the command below to scrape this page by hand:"}
              </p>
            </>
          ) : (
            <>
              <p className="text-[12.5px] font-[620] text-[var(--color-text)]">
                {productPage.rateLimited ? "The supplier site is rate-limiting the app's server." : "The app couldn't read the product page."}
              </p>
              <p className="text-[12px] text-[var(--color-text-2)]">
                Scrape it from your Mac instead — it lands straight on this run and the description is written automatically:
              </p>
            </>
          )}
          <div className="flex items-center gap-2">
            <code className="ff-mono text-[11px] text-[var(--color-text)] bg-[var(--color-surface)] border border-[var(--color-border)] rounded px-2 py-1.5 flex-1 min-w-0 overflow-x-auto whitespace-nowrap">{pushCmd}</code>
            <button onClick={() => { navigator.clipboard.writeText(pushCmd).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
              className="cursor-pointer text-[11px] px-2.5 py-1.5 rounded border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text-2)] hover:text-[var(--color-text)] tr whitespace-nowrap">
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="text-[11.5px] text-[var(--color-text-3)]">Or write the description yourself below and upload photos — that works too.</p>
        </div>
      )}

      {/* description */}
      <div>
        <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
          <p className="eyebrow">Product description{product?.descriptionEdited ? " · edited" : ""}</p>
          <span className={cx("ff-mono text-[11px]", words > 200 ? "text-[var(--color-amber)]" : "text-[var(--color-text-4)]")}>{words} / 200 words</span>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!waiting || regenerating || approving}
          rows={9}
          placeholder={waiting ? "What the product physically is and does — every spec and mechanism detail the listing gives…" : ""}
          className="w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-[var(--radius-sm)] px-[13px] py-[11px] text-[13px] leading-relaxed resize-y transition-all focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)] disabled:opacity-70"
        />
        {waiting && (
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <button onClick={regenerate} disabled={regenerating || approving || !scrape?.pages.some((p) => p.ok)}
              className="cursor-pointer inline-flex items-center gap-[7px] rounded-[var(--radius-sm)] px-3 py-[7px] text-[12.5px] font-[620] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] tr hover:border-[var(--color-text-3)] hover:bg-[var(--color-surface-2)] disabled:opacity-50">
              {regenerating ? <Icon.Loader className="w-3.5 h-3.5" /> : <Icon.Refresh className="w-3.5 h-3.5" />} {regenerating ? "Rewriting…" : "Regenerate description"}
            </button>
            {product?.descriptionAi && text.trim() !== product.descriptionAi.trim() && (
              <button onClick={() => setText(product.descriptionAi ?? "")} className="cursor-pointer text-[11.5px] text-[var(--color-text-3)] hover:text-[var(--color-text)] underline decoration-dotted underline-offset-2 tr">
                Restore the analyst's version
              </button>
            )}
          </div>
        )}
      </div>

      {/* photos */}
      <div>
        <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
          <p className="eyebrow">Photos for this run · {selected.length} of {candidates.length} selected</p>
          <div className="flex items-center gap-3">
            {waiting && <p className="text-[11px] text-[var(--color-text-3)]">Tick the photos research and image generation may use (max 10).</p>}
            {waiting && (
              <>
                <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => addPhotos(e.target.files)} />
                <button onClick={() => fileRef.current?.click()} disabled={uploading || approving}
                  className="cursor-pointer inline-flex items-center gap-[7px] rounded-[var(--radius-sm)] px-3 py-[6px] text-[12px] font-[620] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] tr hover:border-[var(--color-text-3)] hover:bg-[var(--color-surface-2)] disabled:opacity-50 whitespace-nowrap">
                  {uploading ? <Icon.Loader className="w-3.5 h-3.5" /> : <Icon.Image className="w-3.5 h-3.5" />} {uploading ? "Uploading…" : "Add my photos"}
                </button>
              </>
            )}
          </div>
        </div>
        {candidates.length === 0 ? (
          <p className="text-[12.5px] text-[var(--color-text-3)]">No photos on this run yet — add your own above, or wait for the scrape.</p>
        ) : (
          <div className="space-y-3">
            {grouped.map(({ g, items }) => (
              <div key={g}>
                <p className="ff-mono text-[10px] uppercase tracking-widest text-[var(--color-text-4)] mb-1.5">{GROUP_LABEL[g]} · {items.length}</p>
                <div className="flex flex-wrap gap-2">
                  {items.map(({ url }) => {
                    const on = selSet.has(url);
                    return (
                      <button key={url} onClick={() => toggle(url)} disabled={!waiting || approving}
                        title={on ? "Selected — click to remove" : "Click to select"}
                        className={cx("relative w-[84px] h-[84px] rounded-[9px] overflow-hidden border-2 tr",
                          waiting ? "cursor-pointer" : "cursor-default",
                          on ? "border-[var(--color-accent)]" : "border-[var(--color-border)] opacity-60 hover:opacity-100")}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
                        {on && (
                          <span className="absolute top-1 right-1 w-5 h-5 rounded-full grid place-items-center bg-[var(--color-accent)] text-white">
                            <Icon.Check className="w-3 h-3" strokeWidth={3} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {err && <p className="text-[12px] text-[var(--color-red)]">{err}</p>}

      {waiting && (
        <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
          <p className="text-[12px] text-[var(--color-text-3)]">The description and the ticked photos are what research and every later stage use.</p>
          <button onClick={approve} disabled={!canApprove}
            className={cx("cursor-pointer inline-flex items-center gap-[7px] rounded-[var(--radius-sm)] px-[15px] py-[9px] text-[13.5px] font-[620] border border-transparent tr whitespace-nowrap",
              canApprove ? "bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:brightness-110" : "bg-[var(--color-surface-3)] text-[var(--color-text-4)] cursor-not-allowed")}>
            {approving ? <><Icon.Loader className="w-3.5 h-3.5" /> Starting research…</> : <>Approve &amp; start research <Icon.ArrowRight className="w-3.5 h-3.5" /></>}
          </button>
        </div>
      )}
      {approved && !waiting && (
        <p className="text-[11.5px] text-[var(--color-text-3)]">Approved {new Date(product!.approvedAt!).toLocaleString()}.</p>
      )}
    </div>
  );
}
