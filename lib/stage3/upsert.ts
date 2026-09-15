import { db } from "@/lib/db";

// Merge one image into a JSON array column by index, read-modify-write with a
// retry on a busy database. Several images generate at once, so per-image
// saves must never clobber each other; the batch's authoritative full-array
// write at the end repairs the one lost update that is still possible.
async function upsertInto(column: "stage3_remaining_images" | "ads_images", runId: number, image: { index: number }, extra?: Record<string, string>): Promise<Array<{ index?: number }>> {
  for (let attempt = 0; ; attempt++) {
    try {
      const row = await db.execute({ sql: `SELECT ${column} FROM runs WHERE id = ?`, args: [runId] });
      let arr: Array<{ index?: number }> = [];
      try {
        const raw = (row.rows[0] as unknown as Record<string, string | null>)?.[column];
        const parsed = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) arr = parsed;
      } catch { /* treat unparseable as empty */ }
      const i = arr.findIndex((x) => x?.index === image.index);
      if (i >= 0) arr[i] = image;
      else { arr.push(image); arr.sort((a, b) => (a.index ?? 0) - (b.index ?? 0)); }
      const sets = [`${column} = ?`, "last_updated_at = ?"];
      const args: (string | number | null)[] = [JSON.stringify(arr), new Date().toISOString()];
      for (const [k, v] of Object.entries(extra ?? {})) { sets.push(`${k} = ?`); args.push(v); }
      args.push(runId);
      await db.execute({ sql: `UPDATE runs SET ${sets.join(", ")} WHERE id = ?`, args });
      return arr;
    } catch (e) {
      const busy = e instanceof Error && /SQLITE_BUSY|database is locked/i.test(e.message);
      if (busy && attempt < 4) { await new Promise((r) => setTimeout(r, 80 * (attempt + 1))); continue; }
      throw e;
    }
  }
}

export function upsertStage3Image(runId: number, image: { index: number }, currentStep?: string) {
  return upsertInto("stage3_remaining_images", runId, image, currentStep ? { current_step: currentStep } : undefined);
}

export function upsertAdImage(runId: number, image: { index: number }, adsStep?: string) {
  return upsertInto("ads_images", runId, image, adsStep ? { ads_step: adsStep } : undefined);
}
