import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { createImportStore } from "../lib/import/store.ts";
import { createDocSync } from "../lib/import/doc-sync.ts";

let client, store, calls, fail, tabs, linked;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const noDoc = async () => [];
function fakeOps(delay = 0) {
  return {
    async addTab(title) { await sleep(delay); calls.push(["add", title]); if (fail.add) throw new Error("Docs API 500"); const id = `t.${calls.length}`; tabs.push({ tabId: id, title, code: Number(title.match(/P(\d+)/)[1]) }); return id; },
    async writeOverview(tabId, o) { calls.push(["overview", tabId, o]); if (fail.overview) throw new Error("Docs API 429"); },
    async renameTab(tabId, title) { calls.push(["rename", tabId, title]); if (fail.rename) throw new Error("Docs API 503"); },
    async listTabTitles() { if (fail.list) throw new Error("Docs API 502"); return tabs; },
  };
}
const make = (ops = fakeOps(), configured = true) =>
  createDocSync({ store, ops, configured: () => configured, linkRun: async (runId, tabId) => { linked.push([runId, tabId]); } });
const row = (name, priority = false) => ({ name, urls: [`https://${name}.com`], priority });

beforeEach(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "doc-sync-"));
  client = createClient({ url: `file:${path.join(dir, "t.db")}` });
  await client.execute("CREATE TABLE runs (id INTEGER PRIMARY KEY, product_code TEXT)");
  await client.execute("INSERT INTO runs (product_code) VALUES ('P91')");
  store = createImportStore(client);
  await store.init();
  calls = []; fail = {}; tabs = [{ tabId: "t.old", title: "P91 - Old", code: 91 }, { tabId: "t.tpl", title: "Template", code: null }]; linked = [];
});

test("creates the tab, then writes the overview", async () => {
  const sync = make();
  await store.add([row("mug", true)], noDoc);
  await sync.requestSync();
  assert.deepEqual(calls.map((c) => c[0]), ["add", "overview"]);
  assert.equal(calls[0][1], "💦 P92 - mug");
  const [it] = await store.listAll();
  assert.equal(it.docTitle, "💦 P92 - mug");
  assert.equal(it.docOverview, true);
  assert.equal(it.docError, null);
});

test("overlapping sync requests create one tab per item", async () => {
  const sync = make(fakeOps(15));
  await store.add([row("a"), row("b"), row("c")], noDoc);
  await Promise.all([sync.requestSync(), sync.requestSync(), sync.requestSync()]);
  assert.equal(calls.filter((c) => c[0] === "add").length, 3);
});

test("tab id is kept when the overview fails; retry writes only the overview", async () => {
  const sync = make();
  await store.add([row("a")], noDoc);
  fail.overview = true;
  await sync.requestSync();
  let [it] = await store.listAll();
  assert.ok(it.docTabId);
  assert.match(it.docError, /429/);
  fail.overview = false;
  await sync.requestSync();
  [it] = await store.listAll();
  assert.equal(calls.filter((c) => c[0] === "add").length, 1);
  assert.equal(it.docOverview, true);
  assert.equal(it.docError, null);
});

test("renames when the number changes, and retries a failed rename without a new change", async () => {
  const sync = make();
  await store.add([row("lamp")], noDoc);
  await sync.requestSync();
  const [mug] = await store.add([row("mug")], noDoc);
  fail.rename = true;
  await store.update(mug.id, { priority: true }, noDoc);
  await sync.requestSync();
  assert.ok((await store.listAll()).find((i) => i.name === "lamp").docError);
  fail.rename = false;
  await sync.requestSync();
  const lamp = (await store.listAll()).find((i) => i.name === "lamp");
  assert.equal(lamp.docTitle, "P93 - lamp");
  assert.equal(lamp.docError, null);
});

test("a started item's stale title is fixed and its run is linked", async () => {
  const sync = make();
  const [a, b] = await store.add([row("a"), row("b")], noDoc);
  await sync.requestSync();
  const createRun = async (code) => Number((await client.execute({ sql: "INSERT INTO runs (product_code) VALUES (?)", args: [code] })).lastInsertRowid);
  const { runId } = await store.start(b.id, noDoc, createRun);
  await sync.requestSync();
  const started = (await store.listAll()).find((i) => i.id === b.id);
  assert.equal(started.docTitle, "P92 - b");
  assert.deepEqual(linked.at(-1), [runId, started.docTabId]);
  assert.equal((await store.listAll()).find((i) => i.id === a.id).docTitle, "P93 - a");
});

test("not configured: no calls, no error", async () => {
  const sync = make(fakeOps(), false);
  await store.add([row("a")], noDoc);
  await sync.requestSync();
  assert.deepEqual(calls, []);
  assert.deepEqual(await sync.docNumbers(new Set()), []);
});

test("docNumbers skips owned tabs and falls back to the last known numbers", async () => {
  const sync = make();
  assert.deepEqual(await sync.docNumbers(new Set(["t.old"])), []);
  assert.deepEqual(await sync.docNumbers(new Set()), [91]);
  fail.list = true;
  assert.deepEqual(await sync.docNumbers(new Set()), [91]);
});

test("docNumbers throws when the doc has never been read", async () => {
  fail.list = true;
  await assert.rejects(make().docNumbers(new Set()), /502/);
});
