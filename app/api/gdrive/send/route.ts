import { requireSession } from "@/lib/auth";
import { getRun, updateRun } from "@/lib/db";
import { driveConfigured, ensureProductFolders, existingFileNames, existingFilesByName, trashFile, uploadImageFromUrl } from "@/lib/google/drive";
import { docTabTitleForCode } from "@/lib/google/docs";

export const maxDuration = 300;

// Send the run's final images (hero + the 8) to the product's Drive folder:
// <products folder>/<P-code - Name>/Images. Creates the folder structure when
// missing; skips files whose name already exists — never overwrites.
export async function POST(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;
  if (!driveConfigured()) {
    return Response.json({ success: false, error: "Drive export not configured — set GOOGLE_SERVICE_ACCOUNT_JSON and GOOGLE_DRIVE_PRODUCTS_FOLDER_ID in Render." }, { status: 503 });
  }

  const { runId, kind } = (await req.json()) as { runId?: number; kind?: string };
  const wantAds = kind === "ads";
  if (typeof runId !== "number" || !Number.isInteger(runId)) {
    return Response.json({ success: false, error: "runId (integer) required" }, { status: 400 });
  }
  const run = await getRun(runId);
  if (!run) return Response.json({ success: false, error: "Run not found" }, { status: 404 });

  const images: Array<{ name: string; url: string }> = [];
  if (wantAds) {
    // Stage 5: the five ads, named by concept, into the "Image Ads" folder.
    try {
      const ads = JSON.parse(run.ads_images ?? "[]") as Array<{ index?: number; concept?: string; image_url?: string; status?: string }>;
      ads
        .filter((a) => a?.image_url && a.status === "done")
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .forEach((a) => images.push({ name: `ad-${a.index ?? 0}-${(a.concept ?? "ad").replace(/[^a-z0-9_-]/gi, "_")}.png`, url: a.image_url as string }));
    } catch { /* none */ }
    if (!images.length) return Response.json({ success: false, error: "No finished ads on this run yet." }, { status: 400 });
  }
  if (!wantAds && run.stage3_hero_image_url) images.push({ name: "01-hero.png", url: run.stage3_hero_image_url });
  // Section 2/3 photos are named by their role so Drive says which is which.
  let placement: { section_2?: number; section_3?: number } | null = null;
  try { placement = JSON.parse(run.stage3_placement ?? "null"); } catch { placement = null; }
  const sectionOf = (idx?: number) => (idx != null && placement?.section_2 === idx ? 2 : idx != null && placement?.section_3 === idx ? 3 : null);
  if (!wantAds) try {
    const rem = JSON.parse(run.stage3_remaining_images ?? "[]") as Array<{ index?: number; category?: string; image_url?: string; status?: string }>;
    rem
      .filter((im) => im?.image_url && im.status === "done")
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .forEach((im) => {
        const cat = (im.category ?? "image").replace(/[^a-z0-9_-]/gi, "_");
        const sec = sectionOf(im.index);
        images.push({
          name: sec ? `section-${sec}-${cat}.png` : `${String(im.index ?? 0).padStart(2, "0")}-${cat}.png`,
          url: im.image_url as string,
        });
      });
  } catch { /* none */ }
  if (!images.length) {
    return Response.json({ success: false, error: "No finished Stage 4 images on this run yet." }, { status: 400 });
  }

  try {
    // Folder name mirrors the master doc's tab name ("P55 - Wall Lamp");
    // falls back to "<code> - <product name>" when the doc has no tab yet.
    const code = run.product_code ?? "";
    const tabTitle = await docTabTitleForCode(code);
    const folderName = tabTitle ?? `${code} - ${(run.brand_name ?? run.product_name ?? "product").trim()}`;
    const folders = await ensureProductFolders(code, folderName);
    const targetFolderId = wantAds ? folders.adsFolderId : folders.imagesFolderId;
    const folderKey = wantAds ? folders.adsFolderName : "Images";

    // Ads keep the same file name across regenerations, so a plain
    // skip-if-exists would leave the OLD picture in Drive for good. Track what
    // this run uploaded under each name; when the image behind a name has
    // changed, bin the superseded file and upload the new one. Stage 4 images
    // stay strictly append-only.
    let driveState: Record<string, Record<string, string>> = {};
    if (wantAds) {
      try { const v = JSON.parse(run.ads_drive_state ?? "{}"); if (v && typeof v === "object") driveState = v as Record<string, Record<string, string>>; } catch { /* fresh */ }
    }
    const sent = { ...(driveState[folderKey] ?? {}) };
    const existing = wantAds ? null : await existingFileNames(targetFolderId);
    const byName = wantAds ? await existingFilesByName(targetFolderId) : null;

    const results: Array<{ name: string; status: "uploaded" | "replaced" | "already-there" | "error"; detail?: string }> = [];
    for (const im of images) {
      const onDrive = wantAds ? byName!.has(im.name) : existing!.has(im.name);
      if (onDrive && (!wantAds || sent[im.name] === im.url)) { results.push({ name: im.name, status: "already-there" }); continue; }
      const replacing = wantAds && onDrive;
      try {
        if (replacing) await trashFile(byName!.get(im.name)!);
        await uploadImageFromUrl(targetFolderId, im.name, im.url);
        if (wantAds) sent[im.name] = im.url;
        results.push({ name: im.name, status: replacing ? "replaced" : "uploaded" });
      } catch (err) {
        results.push({ name: im.name, status: "error", detail: err instanceof Error ? err.message : String(err) });
      }
    }
    if (wantAds) {
      driveState[folderKey] = sent;
      await updateRun(runId, { ads_drive_state: JSON.stringify(driveState), last_updated_at: new Date().toISOString() }).catch(() => {});
    }

    return Response.json({
      success: true,
      folder: folders.productFolderName,
      subfolder: wantAds ? folders.adsFolderName : "Images",
      createdFolder: folders.createdProductFolder,
      uploaded: results.filter((r) => r.status === "uploaded").length,
      replaced: results.filter((r) => r.status === "replaced").length,
      skipped: results.filter((r) => r.status === "already-there").length,
      errors: results.filter((r) => r.status === "error"),
    });
  } catch (err) {
    return Response.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
