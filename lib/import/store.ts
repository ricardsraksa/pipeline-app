// Import items: products waiting to be started, with provisional P numbers.
//
// The store takes its libsql client as an argument (lib/import/db-store.ts
// passes the app's), so tests run it against a temp file DB.
//
// Numbering is only safe if the base (the highest number already used) is
// read and acted on in one step. So every write runs in an in-process queue,
// and the base is computed INSIDE that step: the store reads the runs itself
// and asks the caller only for the doc's numbers, passing the tab ids Import
// items own so those provisional numbers don't count. Starting a run claims
// the item, numbers it and creates the run in that same step.

import type { Client, Transaction } from "@libsql/client";
import { assignCodes, codeForStart } from "./numbering.ts";
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
  /** The overview lines were written into the tab. */
  docOverview: boolean;
  createdAt: string;
  updatedAt: string;
  runId: number | null;
}

export type NewItem = { name: string; urls: string[]; priority: boolean };
export type AdoptedItem = NewItem & { docTabId: string; docTitle: string };
/** Product numbers used by doc tabs that are not in `ownedTabIds`. May throw. */
export type DocNumbers = (ownedTabIds: Set<string>) => Promise<number[]>;

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
    doc_overview INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    run_id INTEGER
  )`;

// run_id = CLAIMED while a Start is creating the run.
const CLAIMED = -1;

type Row = Record<string, unknown>;
type Exec = Pick<Client, "execute"> | Transaction;

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
    docOverview: Number(r.doc_overview) === 1,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    runId: r.run_id == null ? null : Number(r.run_id),
  };
}

export function createImportStore(client: Client) {
  // In-process write queue: one numbering step at a time.
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

  async function openRows(ex: Exec): Promise<ImportItem[]> {
    const r = await ex.execute("SELECT * FROM import_items WHERE run_id IS NULL");
    return (r.rows as unknown as Row[]).map(toItem);
  }

  async function runBase(ex: Exec): Promise<number> {
    const r = await ex.execute("SELECT product_code FROM runs WHERE product_code IS NOT NULL");
    let max = 0;
    for (const row of r.rows as unknown as Row[]) {
      const n = codeNumber(row.product_code as string);
      if (n && n > max) max = n;
    }
    return max;
  }

  async function ownedTabIds(ex: Exec): Promise<Set<string>> {
    const r = await ex.execute("SELECT doc_tab_id FROM import_items WHERE doc_tab_id IS NOT NULL");
    return new Set((r.rows as unknown as Row[]).map((x) => String(x.doc_tab_id)));
  }

  /** Doc numbers, read BEFORE any transaction opens (it can take seconds;
   *  a write lock held that long would stall the pipeline's own writes). */
  async function docMax(docNumbers: DocNumbers, alsoOwned: string[] = []): Promise<number> {
    const owned = await ownedTabIds(client);
    for (const t of alsoOwned) owned.add(t);
    return Math.max(0, ...(await docNumbers(owned)));
  }

  async function renumber(ex: Exec, b: number): Promise<void> {
    const items = await openRows(ex);
    const target = assignCodes(b, items);
    for (const it of items) {
      const code = target.get(it.id)!;
      if (code !== it.productCode) {
        await ex.execute({ sql: "UPDATE import_items SET product_code = ? WHERE id = ?", args: [code, it.id] });
      }
    }
  }

  /** One queued step: read the doc's numbers, then in one transaction apply
   *  `fn` and renumber from base = max(runs, doc). */
  async function write<T>(docNumbers: DocNumbers, fn: (tx: Transaction) => Promise<T>, alsoOwned: string[] = []): Promise<T> {
    return serial(async () => {
      const doc = await docMax(docNumbers, alsoOwned);
      const tx = await client.transaction("write");
      try {
        const out = await fn(tx);
        await renumber(tx, Math.max(await runBase(tx), doc));
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

  async function byIds(ids: number[]): Promise<ImportItem[]> {
    if (!ids.length) return [];
    const r = await client.execute({
      sql: `SELECT * FROM import_items WHERE id IN (${ids.map(() => "?").join(",")})`,
      args: ids,
    });
    return (r.rows as unknown as Row[]).map(toItem);
  }

  async function insert(tx: Transaction, rows: Array<NewItem & { docTabId?: string; docTitle?: string }>): Promise<number[]> {
    const ids: number[] = [];
    for (const row of rows) {
      const at = stamp();
      const r = await tx.execute({
        sql: `INSERT INTO import_items (name, urls, priority, doc_tab_id, doc_title, doc_overview, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        // An adopted tab already has its overview lines.
        args: [row.name.trim(), JSON.stringify(row.urls), row.priority ? 1 : 0, row.docTabId ?? null, row.docTitle ?? null, row.docTabId ? 1 : 0, at, at],
      });
      ids.push(Number(r.lastInsertRowid));
    }
    return ids;
  }

  return {
    async init(): Promise<void> {
      await client.execute(SCHEMA);
      // Added after the first version of the table.
      try { await client.execute("ALTER TABLE import_items ADD COLUMN doc_overview INTEGER NOT NULL DEFAULT 0"); } catch { /* exists */ }
    },

    /** Highest product number used by a run (0 when none). */
    async runBase(): Promise<number> {
      return runBase(client);
    },

    async ownedTabIds(): Promise<Set<string>> {
      return ownedTabIds(client);
    },

    async get(id: number): Promise<ImportItem | null> {
      return (await byIds([id]))[0] ?? null;
    },

    /** Open items, in code order. */
    async listOpen(): Promise<ImportItem[]> {
      const items = await openRows(client);
      return items.sort((a, b) => (codeNumber(a.productCode) ?? 0) - (codeNumber(b.productCode) ?? 0));
    },

    /** Every item, open and started (the doc sync checks them all). */
    async listAll(): Promise<ImportItem[]> {
      const r = await client.execute("SELECT * FROM import_items WHERE run_id IS NULL OR run_id <> -1");
      return (r.rows as unknown as Row[]).map(toItem);
    },

    /** Insert new items (table order kept). Returns them, numbered. */
    async add(rows: NewItem[], docNumbers: DocNumbers): Promise<ImportItem[]> {
      return byIds(await write(docNumbers, (tx) => insert(tx, rows)));
    },

    /** Existing doc tabs brought in as items, keeping their tab. Tabs another item already owns are skipped. */
    async adopt(rows: AdoptedItem[], docNumbers: DocNumbers): Promise<ImportItem[]> {
      return byIds(await write(docNumbers, async (tx) => {
        const owned = await ownedTabIds(tx);
        return insert(tx, rows.filter((r) => !owned.has(r.docTabId)));
      }, rows.map((r) => r.docTabId)));
    },

    /** Edit name/links/priority of an open item. */
    async update(id: number, patch: Partial<NewItem>, docNumbers: DocNumbers): Promise<ImportItem | null> {
      await write(docNumbers, async (tx) => {
        const sets: string[] = [];
        const args: (string | number)[] = [];
        if (patch.name !== undefined) { sets.push("name = ?"); args.push(patch.name.trim()); }
        if (patch.urls !== undefined) { sets.push("urls = ?"); args.push(JSON.stringify(patch.urls)); }
        if (patch.priority !== undefined) { sets.push("priority = ?"); args.push(patch.priority ? 1 : 0); }
        sets.push("updated_at = ?"); args.push(stamp());
        await tx.execute({ sql: `UPDATE import_items SET ${sets.join(", ")} WHERE id = ? AND run_id IS NULL`, args: [...args, id] });
      });
      return (await byIds([id]))[0] ?? null;
    },

    /**
     * Start a run from an item: claim it, take the next number, create the
     * run, then renumber the rest — all in one queued step, so two Starts
     * (or a Start and an import) can never hand out the same number.
     */
    async start(id: number, docNumbers: DocNumbers, createRun: (code: string, item: ImportItem) => Promise<number>): Promise<{ runId: number; code: string; item: ImportItem }> {
      return serial(async () => {
        const claim = await client.execute({ sql: "UPDATE import_items SET run_id = ? WHERE id = ? AND run_id IS NULL", args: [CLAIMED, id] });
        if (claim.rowsAffected !== 1) {
          throw new Error((await byIds([id])).length ? "Already started" : "Import item not found");
        }
        let runId: number | null = null;
        try {
          const b = Math.max(await runBase(client), await docMax(docNumbers));
          const code = codeForStart(b);
          const item = (await byIds([id]))[0];
          runId = await createRun(code, item);
          // From here the run exists: the item is never released again.
          await client.execute({ sql: "UPDATE import_items SET run_id = ?, product_code = ?, updated_at = ? WHERE id = ?", args: [runId, code, stamp(), id] });
          const tx = await client.transaction("write");
          try {
            await renumber(tx, b + 1);
            await tx.commit();
          } finally {
            tx.close();
          }
          return { runId, code, item: { ...item, runId, productCode: code } };
        } catch (err) {
          if (runId === null) {
            await client.execute({ sql: "UPDATE import_items SET run_id = NULL WHERE id = ? AND run_id = ?", args: [id, CLAIMED] }).catch(() => {});
          }
          throw err;
        }
      });
    },

    /** Queued with the numbering steps: a tab id landing mid-step would
     *  otherwise count as an unowned doc number. */
    async setDocState(id: number, s: { docTabId?: string; docTitle?: string; docError: string | null; docOverview?: boolean }): Promise<void> {
      await serial(() => client.execute({
        sql: `UPDATE import_items SET doc_tab_id = COALESCE(?, doc_tab_id), doc_title = COALESCE(?, doc_title), doc_error = ?,
              doc_overview = COALESCE(?, doc_overview) WHERE id = ?`,
        args: [s.docTabId ?? null, s.docTitle ?? null, s.docError, s.docOverview === undefined ? null : s.docOverview ? 1 : 0, id],
      }));
    },
  };
}

export type ImportStore = ReturnType<typeof createImportStore>;
