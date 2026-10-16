// The only Docs batchUpdate requests the app may send. None can remove or
// overwrite content: insert text or a table, add or rename a tab, and set the
// look of text, paragraphs, cells and columns (used only on the template the
// app rebuilds in a new tab). Pure (tested).

const ALLOWED_REQUESTS = new Set([
  "insertText", "insertTable", "addDocumentTab", "updateDocumentTabProperties",
  "updateTextStyle", "updateParagraphStyle", "updateTableCellStyle", "updateTableColumnProperties",
]);

export function assertNonDestructive(requests: Array<Record<string, unknown>>): void {
  for (const r of requests) {
    for (const k of Object.keys(r)) {
      if (!ALLOWED_REQUESTS.has(k)) throw new Error(`Refusing potentially destructive Docs request: ${k}`);
    }
  }
}
