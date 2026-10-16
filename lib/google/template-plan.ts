// Rebuild the template tab ("P0 - TEMPLATE") inside a tab the app made.
//
// The Docs API can't duplicate a tab, so a tab the app adds starts empty and
// the copy had nowhere to go. Instead the app reads the template and writes
// the same thing into the new tab: headings, overview lines, the three tables
// with their grey label rows, widths and styles. Then the normal fill runs.
//
// Everything is inserted at index 1, last element first: each insert pushes
// what is already there down, so every new element's indices are known the
// moment it lands (style requests follow their insert in the same batch). A
// table's cell indices aren't predictable, so the caller reads the tab after
// each table insert and passes the table in. Pure (tested).

type Req = Record<string, unknown>;

interface Run { startIndex?: number; endIndex?: number; textRun?: { content?: string; textStyle?: Record<string, unknown> } }
interface Para { elements?: Run[]; paragraphStyle?: Record<string, unknown> }
interface Cell { content?: El[]; tableCellStyle?: Record<string, unknown> }
export interface El {
  startIndex?: number;
  endIndex?: number;
  sectionBreak?: unknown;
  paragraph?: Para;
  table?: { rows?: number; columns?: number; tableRows?: Array<{ tableCells?: Cell[] }>; tableStyle?: { tableColumnProperties?: Array<Record<string, unknown>> } };
}

const TEXT_FIELDS = ["bold", "italic", "underline", "strikethrough", "smallCaps", "fontSize", "foregroundColor", "backgroundColor", "weightedFontFamily", "baselineOffset"];
const PARA_FIELDS = ["namedStyleType", "alignment", "lineSpacing", "direction", "spaceAbove", "spaceBelow", "avoidWidowAndOrphan", "indentStart", "indentEnd", "indentFirstLine", "keepLinesTogether", "keepWithNext"];
const CELL_FIELDS = ["backgroundColor", "paddingLeft", "paddingRight", "paddingTop", "paddingBottom", "contentAlignment"];

/** A dimension read back without a magnitude means zero; send it explicitly. */
function fixDims(style: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(style)) {
    out[k] = v && typeof v === "object" && "unit" in v && !("magnitude" in v) ? { ...(v as object), magnitude: 0 } : v;
  }
  return out;
}
function pick(style: Record<string, unknown> | undefined, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) if (style && style[f] !== undefined) out[f] = style[f];
  return fixDims(out);
}

function paraText(p?: Para): string {
  return (p?.elements ?? []).map((e) => e.textRun?.content ?? "").join("");
}
export function isEmptyParagraph(el: El): boolean {
  return Boolean(el.paragraph) && paraText(el.paragraph) === "\n";
}

/** The template's elements to rebuild: no section break, and no final empty
 *  line (the target tab already ends with one). */
export function templateBlocks(content: El[]): El[] {
  const blocks = content.filter((el) => el.paragraph || el.table);
  if (blocks.length && isEmptyParagraph(blocks[blocks.length - 1])) blocks.pop();
  return blocks;
}

/** Style requests for a paragraph whose first character sits at `at`. */
function styleParagraph(el: El, tabId: string, at: number): Req[] {
  const p = el.paragraph!;
  const len = paraText(p).length;
  const reqs: Req[] = [{
    updateParagraphStyle: {
      range: { startIndex: at, endIndex: at + len, tabId },
      paragraphStyle: pick(p.paragraphStyle, PARA_FIELDS),
      fields: PARA_FIELDS.join(","),
    },
  }];
  let off = 0;
  for (const r of p.elements ?? []) {
    const n = r.textRun?.content?.length ?? 0;
    if (n) {
      reqs.push({
        updateTextStyle: {
          range: { startIndex: at + off, endIndex: at + off + n, tabId },
          textStyle: pick(r.textRun?.textStyle, TEXT_FIELDS),
          fields: TEXT_FIELDS.join(","),
        },
      });
    }
    off += n;
  }
  return reqs;
}

/** Insert one template paragraph at `at`, then set its styles. With
 *  `existing`, the empty line is already there (made by a table insert). */
export function paragraphRequests(el: El, tabId: string, at: number, existing = false): Req[] {
  const text = paraText(el.paragraph);
  if (!text) return [];
  const insert: Req[] = existing ? [] : [{ insertText: { location: { index: at, tabId }, text } }];
  return [...insert, ...styleParagraph(el, tabId, at)];
}

export function tableInsertRequest(el: El, tabId: string, at: number): Req {
  const rows = el.table?.tableRows?.length ?? el.table?.rows ?? 1;
  const columns = el.table?.tableRows?.[0]?.tableCells?.length ?? el.table?.columns ?? 1;
  return { insertTable: { rows, columns, location: { index: at, tabId } } };
}

/** Labels, styles and widths for a table just inserted empty (`made`, read
 *  back from the doc) so it matches the template's table (`tpl`). */
export function tableFillRequests(tpl: El, made: El, tabId: string): Req[] {
  const tRows = tpl.table?.tableRows ?? [];
  const mRows = made.table?.tableRows ?? [];
  const start = made.startIndex;
  if (typeof start !== "number") throw new Error("The new table has no position.");
  const tableStartLocation = { index: start, tabId };
  const reqs: Req[] = [];

  // Column widths and cell looks don't move text — first.
  (tpl.table?.tableStyle?.tableColumnProperties ?? []).forEach((props, i) => {
    if (!props?.widthType) return;
    reqs.push({ updateTableColumnProperties: { tableStartLocation, columnIndices: [i], tableColumnProperties: fixDims(props), fields: "widthType,width" } });
  });
  tRows.forEach((row, r) => (row.tableCells ?? []).forEach((cell, c) => {
    if (!mRows[r]?.tableCells?.[c]) return;
    reqs.push({
      updateTableCellStyle: {
        tableCellStyle: pick(cell.tableCellStyle, CELL_FIELDS),
        fields: CELL_FIELDS.join(","),
        tableRange: { tableCellLocation: { tableStartLocation, rowIndex: r, columnIndex: c }, rowSpan: 1, columnSpan: 1 },
      },
    });
  }));

  // Each cell's text goes at the start of the new (empty) cell. Inserting
  // ascending shifts every later cell by the text before it, so track that.
  type Job = { at: number; tplCell: Cell };
  const jobs: Job[] = [];
  tRows.forEach((row, r) => (row.tableCells ?? []).forEach((cell, c) => {
    const target = mRows[r]?.tableCells?.[c];
    const at = target?.content?.find((e) => e.paragraph && typeof e.startIndex === "number")?.startIndex;
    if (typeof at === "number") jobs.push({ at, tplCell: cell });
  }));
  jobs.sort((a, b) => a.at - b.at);

  const inserts: Req[] = [];
  const styles: Req[] = [];
  let shift = 0;
  for (const j of jobs) {
    const paras = (j.tplCell.content ?? []).filter((e) => e.paragraph);
    const full = paras.map((e) => paraText(e.paragraph)).join("");
    const text = full.replace(/\n$/, "");
    const base = j.at + shift;
    if (text) inserts.push({ insertText: { location: { index: j.at, tabId }, text } });
    let off = 0;
    for (const e of paras) {
      styles.push(...styleParagraph(e, tabId, base + off));
      off += paraText(e.paragraph).length;
    }
    shift += text.length;
  }
  // Inserts back to front so each original index stays valid; styles use the
  // final positions, after every insert.
  inserts.reverse();
  return [...reqs, ...inserts, ...styles];
}

const OVERVIEW_LINE = /^(product name|competitor\s*\/?\s*example link|alibaba link)\s*:/i;

/** A tab the template may be built into: empty, or holding only the
 *  overview lines the app used to write. Never a tab someone worked in. */
export function canBuildInto(content: El[]): boolean {
  for (const el of content) {
    if (el.table) return false;
    if (!el.paragraph) continue;
    for (const line of paraText(el.paragraph).split(/[\n\v]/)) {
      const t = line.trim();
      if (t && !OVERVIEW_LINE.test(t)) return false;
    }
  }
  return true;
}
