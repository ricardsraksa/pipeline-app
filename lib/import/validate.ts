// Rows from the Import table → items to store, or per-row errors. Pure.
import { splitLinks } from "./links.ts";
import type { NewItem } from "./store.ts";

export type RowInput = { name?: unknown; links?: unknown; priority?: unknown };

export function validateRows(rows: unknown[]): { items: NewItem[]; errors: Array<{ index: number; message: string }> } {
  const items: NewItem[] = [];
  const errors: Array<{ index: number; message: string }> = [];
  rows.forEach((raw, index) => {
    const r = (raw && typeof raw === "object" ? raw : {}) as RowInput;
    const name = typeof r.name === "string" ? r.name.trim().slice(0, 200) : "";
    const links = typeof r.links === "string" ? r.links : "";
    if (!name && !links.trim()) return; // empty row
    const { references, competitors, invalid } = splitLinks(links);
    const urls = [...references, ...competitors];
    if (!name) errors.push({ index, message: "Add a product name" });
    else if (invalid.length) errors.push({ index, message: `Not a link: ${invalid.slice(0, 2).join(", ")}` });
    else if (!urls.length) errors.push({ index, message: "Add at least one link" });
    else items.push({ name, urls, priority: r.priority === true });
  });
  return { items, errors };
}
