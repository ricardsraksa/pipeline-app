import { requireSession } from "@/lib/auth";
import { getRun } from "@/lib/db";
import { driveConfigured, ensureProductFolders, existingFileNames, uploadImageFromUrl } from "@/lib/google/drive";
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

  const { runId } = (await req.json()) as { runId?: number };
  if (typeof runId !== "number" || !Number.isInteger(runId)) {
    return Response.json({ success: false, error: "runId (integer) required" }, { status: 400 });
  }
  const run = await getRun(runId);
  if (!run) return Response.json({ success: false, error: "Run not found" }, { status: 404 });

  const images: Array<{ name: string; url: string }> = [];
  if (run.stage3_hero_image_url) images.push({ name: "01-hero.png", url: run.stage3_hero_image_url });
  try {
    const rem = JSON.parse(run.stage3_remaining_images ?? "[]") as Array<{ index?: number; category?: string; image_url?: string; status?: string }>;
    rem
      .filter((im) => im?.image_url && im.status === "done")
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .forEach((im) => images.push({
        name: `${String(im.index ?? 0).padStart(2, "0")}-${(im.category ?? "image").replace(/[^a-z0-9_-]/gi, "_")}.png`,
        url: im.image_url as string,
      }));
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
    const existing = await existingFileNames(folders.imagesFolderId);

    const results: Array<{ name: string; status: "uploaded" | "already-there" | "error"; detail?: string }> = [];
    for (const im of images) {
      if (existing.has(im.name)) { results.push({ name: im.name, status: "already-there" }); continue; }
      try {
        await uploadImageFromUrl(folders.imagesFolderId, im.name, im.url);
        results.push({ name: im.name, status: "uploaded" });
      } catch (err) {
        results.push({ name: im.name, status: "error", detail: err instanceof Error ? err.message : String(err) });
      }
    }

    return Response.json({
      success: true,
      folder: folders.productFolderName,
      createdFolder: folders.createdProductFolder,
      uploaded: results.filter((r) => r.status === "uploaded").length,
      skipped: results.filter((r) => r.status === "already-there").length,
      errors: results.filter((r) => r.status === "error"),
    });
  } catch (err) {
    return Response.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
