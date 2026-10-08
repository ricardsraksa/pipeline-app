// Import table rows: there is always exactly one empty row at the end, so
// typing in it makes the next one appear. Pure.

export type DraftRow = { key: string; name: string; links: string; priority: boolean };

let seq = 0;
export function emptyRow(): DraftRow {
  seq += 1;
  return { key: `r${Date.now().toString(36)}${seq}`, name: "", links: "", priority: false };
}

const blank = (r: DraftRow) => !r.name.trim() && !r.links.trim();

export function withTrailingEmpty(rows: DraftRow[]): DraftRow[] {
  let end = rows.length;
  while (end > 0 && blank(rows[end - 1])) end--;
  const kept = rows.slice(0, end);
  return [...kept, rows[end] && blank(rows[end]) ? rows[end] : emptyRow()];
}
