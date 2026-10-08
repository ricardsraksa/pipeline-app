import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { createImportStore } from "../lib/import/store.ts";

let client, store;
beforeEach(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "import-store-"));
  client = createClient({ url: `file:${path.join(dir, "t.db")}` });
  await client.execute("CREATE TABLE runs (id INTEGER PRIMARY KEY, product_code TEXT)");
  await client.execute("INSERT INTO runs (product_code) VALUES ('P90'), ('P91'), (NULL)");
  store = createImportStore(client);
  await store.init();
});

const noDoc = async () => [];
const row = (name, priority = false) => ({ name, urls: [`https://${name}.com`], priority });
const codes = (items) => items.map((i) => `${i.productCode} ${i.name}`);
const open = async () => codes(await store.listOpen());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const createRun = (delay = 0) => async (code) => {
  await sleep(delay);
  const r = await client.execute({ sql: "INSERT INTO runs (product_code) VALUES (?)", args: [code] });
  return Number(r.lastInsertRowid);
};
const runCodes = async () => (await client.execute("SELECT product_code FROM runs WHERE product_code IS NOT NULL ORDER BY id")).rows.map((r) => r.product_code);

test("addKeepsRowOrder", async () => {
  await store.add([row("lamp"), row("bowl")], noDoc);
  assert.deepEqual(await open(), ["P92 lamp", "P93 bowl"]);
});

test("base includes doc tabs no item owns", async () => {
  await store.add([row("lamp")], async () => [95]);
  assert.deepEqual(await open(), ["P96 lamp"]);
});

test("priorityToggleRenumbers (spec example)", async () => {
  await store.add([row("lamp"), row("bowl")], noDoc);
  const [mug] = await store.add([row("mug")], noDoc);
  await store.update(mug.id, { priority: true }, noDoc);
  assert.deepEqual(await open(), ["P92 mug", "P93 lamp", "P94 bowl"]);
});

test("startLowerRowTakesNextNumber", async () => {
  const [, , c] = await store.add([row("a"), row("b"), row("c")], noDoc);
  const out = await store.start(c.id, noDoc, createRun());
  assert.equal(out.code, "P92");
  assert.deepEqual(await open(), ["P93 a", "P94 b"]);
  const started = await store.get(c.id);
  assert.equal(started.runId, out.runId);
  assert.equal(started.productCode, "P92");
});

test("two starts at once never share a number", async () => {
  const [a, b] = await store.add([row("a"), row("b")], noDoc);
  const slowDoc = async () => { await sleep(20); return []; };
  const [x, y] = await Promise.all([store.start(b.id, slowDoc, createRun(10)), store.start(a.id, slowDoc, createRun(10))]);
  assert.notEqual(x.code, y.code);
  assert.deepEqual((await runCodes()).slice(-2).sort(), ["P92", "P93"]);
});

test("starting the same item twice creates one run", async () => {
  const [a] = await store.add([row("a")], noDoc);
  const results = await Promise.allSettled([store.start(a.id, noDoc, createRun(10)), store.start(a.id, noDoc, createRun(10))]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.match(results.find((r) => r.status === "rejected").reason.message, /already started/i);
  assert.equal((await runCodes()).length, 3);
});

test("start racing an import keeps numbers unique", async () => {
  const [a] = await store.add([row("a")], noDoc);
  const slowDoc = async () => { await sleep(15); return []; };
  await Promise.all([store.start(a.id, slowDoc, createRun(10)), store.add([row("x")], slowDoc)]);
  assert.deepEqual(await runCodes(), ["P90", "P91", "P92"]);
  assert.deepEqual(await open(), ["P93 x"]);
});

test("failed run creation releases the item", async () => {
  const [a] = await store.add([row("a")], noDoc);
  await assert.rejects(store.start(a.id, noDoc, async () => { throw new Error("db down"); }), /db down/);
  const again = await store.get(a.id);
  assert.equal(again.runId, null);
  assert.deepEqual(await open(), ["P92 a"]);
});

test("concurrentImportsStayContiguous", async () => {
  const slowDoc = async () => { await sleep(10); return []; };
  await Promise.all([store.add([row("a"), row("b")], slowDoc), store.add([row("c"), row("d")], slowDoc)]);
  assert.deepEqual((await store.listOpen()).map((i) => i.productCode), ["P92", "P93", "P94", "P95"]);
});

test("adopting doc tabs does not count their own numbers", async () => {
  const docTabs = [{ id: "t.92", n: 92 }, { id: "t.93", n: 93 }];
  const docNumbers = async (owned) => docTabs.filter((t) => !owned.has(t.id)).map((t) => t.n);
  await store.adopt(docTabs.map((t) => ({ ...row(`p${t.n}`), docTabId: t.id, docTitle: `P${t.n} - p${t.n}` })), docNumbers);
  assert.deepEqual(await open(), ["P92 p92", "P93 p93"]);
});

test("doc number failure fails the write", async () => {
  await assert.rejects(store.add([row("a")], async () => { throw new Error("Docs API 500"); }), /500/);
  assert.deepEqual(await open(), []);
});

test("doc state round-trips, listAll includes started", async () => {
  const [a] = await store.add([row("a", true)], noDoc);
  await store.setDocState(a.id, { docTabId: "t.1", docTitle: "💦 P92 - a", docError: null, docOverview: true });
  await store.start(a.id, noDoc, createRun());
  const got = (await store.listAll()).find((i) => i.id === a.id);
  assert.equal(got.docTabId, "t.1");
  assert.equal(got.docOverview, true);
  assert.ok(got.runId);
});
