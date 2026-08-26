// Which product photos Stage 3 may use as references.
//
// Candidates are the user-uploaded source images plus any scraped product
// images, deduped. The operator can exclude individual photos per run
// (runs.stage3_source_blacklist, a JSON array of URLs) — e.g. a photo
// Higgsfield's moderation rejects, or a supplier shot that misleads the
// prompt writer. Uploads default to included; the blacklist is the exception
// list, so newly added photos are always live until excluded.

interface SourceFields {
  uploaded_source_images: string | null;
  scraper_data: string | null;
  stage3_source_blacklist: string | null;
}

function jsonArr(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : [];
  } catch {
    return [];
  }
}

/** Every candidate photo, deduped, unfiltered — what the picker UI lists. */
export function stage3SourceCandidates(run: SourceFields): string[] {
  const uploaded = jsonArr(run.uploaded_source_images);
  let scraped: string[] = [];
  try {
    const sd = run.scraper_data ? JSON.parse(run.scraper_data) : null;
    if (Array.isArray(sd?.images)) scraped = sd.images.filter((x: unknown): x is string => typeof x === "string");
  } catch { /* no scraped images */ }
  return [...uploaded, ...scraped].filter((u, i, a) => u && a.indexOf(u) === i);
}

/** The photos Stage 3 actually uses: candidates minus the operator's blacklist. */
export function stage3ActiveSourceImages(run: SourceFields, limit = 5): string[] {
  const blacklist = new Set(jsonArr(run.stage3_source_blacklist));
  return stage3SourceCandidates(run).filter((u) => !blacklist.has(u)).slice(0, limit);
}
