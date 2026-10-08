// The only Docs batchUpdate requests the app may send. None can remove or
// overwrite content: insert text, add a tab, rename a tab. Pure (tested).

const ALLOWED_REQUESTS = new Set(["insertText", "addDocumentTab", "updateDocumentTabProperties"]);

export function assertNonDestructive(requests: Array<Record<string, unknown>>): void {
  for (const r of requests) {
    for (const k of Object.keys(r)) {
      if (!ALLOWED_REQUESTS.has(k)) throw new Error(`Refusing potentially destructive Docs request: ${k}`);
    }
  }
}
