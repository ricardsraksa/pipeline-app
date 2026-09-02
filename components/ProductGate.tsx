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
  uploaded: "Your photos",
  product: "Listing photos",
  description: "Description images",
  competitor: "Competitor photos",
};

function detailOf(p: ProductScrapePage): string {
  const bits = [
    p.title,
    p.price ? `Price ${p.price}` : null,
    p.rating ? `★ ${p.rating}` : null,
    p.reviews ? `${p.reviews} reviews` : null,
    p.sold ? `${p.sold} sold` : null,
    p.image_urls.length ? `${p.image_urls.length} photos` : null,
  ].filter(Boolean);
  return bits.join(" · ") || "(no detail)";
}

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
  // The worker stops after ~3 minutes of failures. If the page has been sitting
  // unread longer than that with the worker alive, it has given up.
  const scrapedAgoMs = scrape?.scraped_at ? Date.now() - new Date(scrape.scraped_at).getTime() : 0;
  const gaveUp = workerOnline && scrapedAgoMs > 5 * 60 * 1000;
  const pushCmd = `scrapling-py ~/Desktop/supplier-scrape.py --push ${typeof window !== "undefined" ? window.location.origin : ""} --run ${runId} ${run.meta.productUrl || "<product url>"}`;

  const grouped = (["uploaded", "product", "description", "competitor"] as const)
    .map((g) => ({ g, items: candidates.filter((c) => c.group === g) }))
    .filter((x) => x.items.length);

  const label = "eyebrow";
  const textBtn = "cursor-pointer text-[11.5px] text-[var(--color-text-2)] hover:text-[var(--color-text)] tr disabled:opacity-50";
  const card = "border border-[var(--color-border)] rounded-[9px] bg-[var(--color-surface)]";

  return (
    <div className="flex flex-col gap-[26px]">
      {/* worker / manual fallback */}
      {waiting && productPage && !productPage.ok && (
        <div className="rounded-[9px] border px-4 py-3.5 flex flex-col gap-2"
          style={{ borderColor: "color-mix(in srgb, var(--color-amber) 40%, var(--color-border))", background: "var(--color-amber-bg)" }}>
          <p className="text-[12.5px] font-[600] text-[var(--color-text)]">
            {productPage.deferred
              ? (gaveUp ? "Your Mac couldn't get this page. Scrape it by hand:" : workerOnline ? "Your Mac is scraping this page." : "Mac worker offline.")
              : productPage.rateLimited ? "The supplier site is rate-limiting the server." : "The app couldn't read the product page."}
          </p>
          <p className="text-[12px] text-[var(--color-text-2)]">
            {productPage.deferred && !gaveUp && workerOnline ? `Checked in ${workerAgo}.` : "Run this on your Mac, or write the description yourself."}
          </p>
          <div className="flex items-center gap-2">
            <code className="ff-mono text-[11px] flex-1 min-w-0 overflow-x-auto whitespace-nowrap rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[var(--color-text)]">{pushCmd}</code>
            <button onClick={() => { navigator.clipboard.writeText(pushCmd).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }} className={textBtn}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {/* description */}
      <div>
        <div className="flex items-center gap-2.5 mb-2">
          <span className={label}>Description</span>
          <div className="flex-1" />
          <span className="ff-mono text-[10.5px] text-[var(--color-text-3)]">{words} words</span>
          {waiting && <button onClick={regenerate} disabled={regenerating || approving || !scrape?.pages.some((p) => p.ok)} className={textBtn}>{regenerating ? "Rewriting…" : "Regenerate"}</button>}
          {waiting && product?.descriptionAi && text.trim() !== product.descriptionAi.trim() && (
            <button onClick={() => setText(product.descriptionAi ?? "")} className={textBtn}>Restore</button>
          )}
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} disabled={!waiting || regenerating || approving} rows={7}
          placeholder={waiting ? "What the product is and does…" : ""}
          className="w-full px-[13px] py-3 rounded-[8px] bg-[var(--color-surface)] border border-[var(--color-border)] text-[13.5px] leading-[1.6] text-[var(--color-text)] outline-none resize-y focus:border-[var(--color-border-strong)] disabled:opacity-70 placeholder:text-[var(--color-text-3)]" />
      </div>

      {/* photos */}
      <div>
        <div className="flex items-center gap-2.5 mb-2.5">
          <span className={label}>Photos</span>
          <span className="ff-mono text-[10.5px] text-[var(--color-text-3)]">{selected.length} / 10 picked</span>
          <div className="flex-1" />
          {waiting && (
            <>
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => addPhotos(e.target.files)} />
              <button onClick={() => fileRef.current?.click()} disabled={uploading || approving} className={textBtn}>{uploading ? "Uploading…" : "Add my photos"}</button>
            </>
          )}
        </div>
        {candidates.length === 0 ? (
          <p className="text-[12.5px] text-[var(--color-text-2)]">No photos yet.</p>
        ) : (
          <div className="grid gap-[9px]" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(104px,1fr))" }}>
            {candidates.map(({ url, group }) => {
              const on = selSet.has(url);
              return (
                <button key={url} onClick={() => toggle(url)} disabled={!waiting || approving}
                  title={GROUP_LABEL[group]}
                  className={cx("relative aspect-square rounded-[7px] overflow-hidden border tr", waiting ? "cursor-pointer" : "cursor-default",
                    on ? "border-[var(--color-accent)]" : "border-[var(--color-border)] opacity-70 hover:opacity-100 hover:border-[var(--color-border-strong)]")}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
                  <span className="absolute left-0 right-0 bottom-0 px-1.5 py-0.5 ff-mono text-[9.5px] text-[var(--color-text-3)]" style={{ background: "color-mix(in srgb, var(--color-bg) 76%, transparent)" }}>{GROUP_LABEL[group]}</span>
                  {on && <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full grid place-items-center text-[10px] bg-[var(--color-accent)] text-[var(--color-on-primary)]">✓</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* what was read */}
      {scrape && (
        <div>
          <div className={cx(label, "mb-2.5 block")}>What was read</div>
          <div className={cx(card, "overflow-hidden")}>
            {scrape.pages.map((p, i) => (
              <div key={p.url} className={cx("grid gap-3.5 items-center px-[13px] py-2.5 text-[12.5px]", i > 0 && "border-t border-[var(--color-border)]")}
                style={{ gridTemplateColumns: "78px 140px minmax(0,1fr)" }}>
                <span className="ff-mono text-[10.5px]" style={{ color: p.ok ? "var(--color-green)" : "var(--color-red)" }}>{p.role === "product" ? "product" : "competitor"}</span>
                <span className="text-[var(--color-text-2)] truncate">{hostOf(p.url)}</span>
                <span className="text-[var(--color-text)] truncate">{p.ok ? detailOf(p) : (p.error || "Couldn't read this page")}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {err && <p className="text-[12px] text-[var(--color-red)]">{err}</p>}

      {waiting && (
        <div className="flex items-center gap-3">
          <button onClick={approve} disabled={!canApprove}
            className={cx("cursor-pointer h-[34px] px-4 rounded-[6px] text-[13px] font-[500] tr",
              canApprove ? "bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:opacity-90" : "bg-[var(--color-surface-2)] text-[var(--color-text-3)] cursor-not-allowed")}>
            {approving ? "Starting research…" : "Approve & start research"}
          </button>
          <span className="text-[11.5px] text-[var(--color-text-3)]">The description and ticked photos are what every later stage uses.</span>
        </div>
      )}
      {approved && !waiting && <p className="text-[11.5px] text-[var(--color-text-3)]">Approved {new Date(product!.approvedAt!).toLocaleString()}.</p>}
    </div>
  );
}
