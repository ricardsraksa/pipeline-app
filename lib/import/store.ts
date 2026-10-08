// Import items: products waiting to be started, with provisional P numbers.
//
// The store takes its libsql client as an argument (lib/import/db-store.ts
// passes the app's), so tests run it against a temp file DB. Every write
// renumbers the open items in the same transaction, and writes are queued
// in-process, so two people importing at once still get contiguous numbers.
// `base` (highest number already used by runs / doc tabs) is computed by the
// caller, which keeps this module free of Google calls.

import type { Client, InStatement, Transaction } from "@libsql/client";
import { assignCodes } from "./numbering.ts";
import { codeNumber } from "./codes.ts";

export interface ImportItem {
  id: number;
  name: string;
  urls: string[];
  priority: boolean;
  productCode: string;
  docTabId: string | null;
  docTitle: string | null;
  docError: string | null;
  createdAt: string;
  updatedAt: string;
  runId: number | null;
}

export type NewItem = { name: string; urls: string[]; priority: boolean };
export type AdoptedItem = NewItem & { docTabId: string; docTitle: string };

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS import_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    urls TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    product_code TEXT,
    doc_tab_id TEXT,
    doc_title TEXT,
    doc_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    run_id INTEGER
  )`;

type Row = Record<string, unknown>;

function toItem(r: Row): ImportItem {
  let urls: string[] = [];
  try { urls = JSON.parse(String(r.urls ?? "[]")); } catch { urls = []; }
  return {
    id: Number(r.id),
    name: String(r.name ?? ""),
    urls,
    priority: Number(r.priority) === 1,
    productCode: String(r.product_code ?? ""),
    docTabId: (r.doc_tab_id as string | null) ?? null,
    docTitle: (r.doc_title as string | null) ?? null,
    docError: (r.doc_error as string | null) ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    runId: r.run_id == null ? null : Number(r.run_id),
  };
}

export function createImportStore(client: Client) {
  // In-process write queue: one transaction at a time.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => {});
    return next;
  };

  // Strictly increasing timestamps keep batch rows in table order.
  let lastStamp = "";
  const stamp = (): string => {
    let s = new Date().toISOString();
    if (s <= lastStamp) s = new Date(Date.parse(lastStamp) + 1).toISOString();
    lastStamp = s;
    return s;
  };

  async function openRows(tx: Transaction | Client): Promise<ImportItem[]> {
    const r = await tx.execute("SELECT * FROM import_items WHERE run_id IS NULL");
    return (r.rows as unknown as Row[]).map(toItem);
  }

  /** Recompute codes for open items; returns the ids whose code changed. */
  async function renumber(tx: Transaction, base: number): Promise<Set<number>> {
    const items = await openRows(tx);
    const target = assignCodes(base, items);
    const changed = new Set<number>();
    const stmts: InStatement[] = [];
    for (const it of items) {
      const code = target.get(it.id)!;
      if (code !== it.productCode) {
        changed.add(it.id);
        stmts.push({ sql: "UPDATE import_items SET product_code = ? WHERE id = ?", args: [code, it.id] });
      }
    }
    for (const s of stmts) await tx.execute(s);
    return changed;
  }

  async function write<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return serial(async () => {
      const tx = await client.transaction("write");
      try {
        const out = await fn(tx);
        await tx.commit();
        return out;
      } catch (err) {
        await tx.rollback().catch(() => {});
        throw err;
      } finally {
        tx.close();
      }
    });
  }

  async function byIds(ids: Iterable<number>): Promise<ImportItem[]> {
    const list = [...ids];
    if (!list.length) return [];
    const r = await client.execute({
      sql: `SELECT * FROM import_items WHERE id IN (${list.map(() => "?").join(",")})`,
      args: list,
    });
    return (r.rows as unknown as Row[]).map(toItem);
  }

  async function insert(tx: Transaction, rows: Array<NewItem & { docTabId?: string; docTitle?: string }>): Promise<number[]> {
    const ids: number[] = [];
    for (const row of rows) {
      const at = stamp();
      const r = await tx.execute({
        sql: `INSERT INTO import_items (name, urls, priority, doc_tab_id, doc_title, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [row.name.trim(), JSON.stringify(row.urls), row.priority ? 1 : 0, row.docTabId ?? null, row.docTitle ?? null, at, at],
      });
      ids.push(Number(r.lastInsertRowid));
    }
    return ids;
  }

  return {
    async init(): Promise<void> {
      await client.execute(SCHEMA);
    },

    /** Highest product number used by a run (0 when none). */
    async runBase(): Promise<number> {
      const r = await client.execute("SELECT product_code FROM runs WHERE product_code IS NOT NULL");
      let max = 0;
      for (const row of r.rows as unknown as Row[]) {
        const n = codeNumber(row.product_code as string);
        if (n && n > max) max = n;
      }
      return max;
    },

    async get(id: number): Promise<ImportItem | null> {
      return (await byIds([id]))[0] ?? null;
    },

    /** Open items, unordered — callers sort with orderItems. */
    async listOpen(): Promise<ImportItem[]> {
      const items = await openRows(client);
      return items.sort((a, b) => (a.productCode && b.productCode ? (codeNumber(a.productCode) ?? 0) - (codeNumber(b.productCode) ?? 0) : 0));
    },

    /** Insert new items (table order kept) and renumber. Returns the new items. */
    async add(rows: NewItem[], base: number): Promise<ImportItem[]> {
      const ids = await write(async (tx) => {
        const ids = await insert(tx, rows);
        await renumber(tx, base);
        return ids;
      });
      return byIds(ids);
    },

    /** Existing doc tabs brought in as items, keeping their tab. */
    async adopt(rows: AdoptedItem[], base: number): Promise<ImportItem[]> {
      const ids = await write(async (tx) => {
        const ids = await insert(tx, rows);
        await renumber(tx, base);
        return ids;
      });
      return byIds(ids);
    },

    /** Edit name/links/priority. Returns every item whose doc title may have changed. */
    async update(id: number, patch: Partial<NewItem>, base: number): Promise<ImportItem[]> {
      const changed = await write(async (tx) => {
        const sets: string[] = [];
        const args: (string | number)[] = [];
        if (patch.name !== undefined) { sets.push("name = ?"); args.push(patch.name.trim()); }
        if (patch.urls !== undefined) { sets.push("urls = ?"); args.push(JSON.stringify(patch.urls)); }
        if (patch.priority !== undefined) { sets.push("priority = ?"); args.push(patch.priority ? 1 : 0); }
        sets.push("updated_at = ?"); args.push(stamp());
        await tx.execute({ sql: `UPDATE import_items SET ${sets.join(", ")} WHERE id = ? AND run_id IS NULL`, args: [...args, id] });
        const changed = await renumber(tx, base);
        changed.add(id);
        return changed;
      });
      return byIds(changed);
    },

    /** The item became a run with `code`; the rest renumber from `base`. */
    async markStarted(id: number, runId: number, code: string, base: number): Promise<ImportItem[]> {
      const changed = await write(async (tx) => {
        await tx.execute({
          sql: "UPDATE import_items SET run_id = ?, product_code = ?, updated_at = ? WHERE id = ? AND run_id IS NULL",
          args: [runId, code, stamp(), id],
        });
        const changed = await renumber(tx, base);
        changed.add(id);
        return changed;
      });
      return byIds(changed);
    },

    async setDocState(id: number, s: { docTabId?: string; docTitle?: string; docError: string | null }): Promise<void> {
      await serial(() => client.execute({
        sql: `UPDATE import_items SET doc_tab_id = COALESCE(?, doc_tab_id), doc_title = COALESCE(?, doc_title), doc_error = ? WHERE id = ?`,
        args: [s.docTabId ?? null, s.docTitle ?? null, s.docError, id],
      }));
    },

    /** Tab ids owned by import items (open or started). */
    async ownedTabIds(): Promise<Set<string>> {
      const r = await client.execute("SELECT doc_tab_id FROM import_items WHERE doc_tab_id IS NOT NULL");
      return new Set((r.rows as unknown as Row[]).map((x) => String(x.doc_tab_id)));
    },
  };
}

export type ImportStore = ReturnType<typeof createImportStore>;
