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

const row = (name, priority = false) => ({ name, urls: [`https://${name}.com`], priority });
const codes = (items) => items.map((i) => `${i.productCode} ${i.name}`);

test("runBase reads the highest run code", async () => {
  assert.equal(await store.runBase(), 91);
});

test("addKeepsRowOrder", async () => {
  await store.add([row("lamp"), row("bowl")], 91);
  assert.deepEqual(codes(await store.listOpen()), ["P92 lamp", "P93 bowl"]);
});

test("priorityToggleRenumbers (spec example)", async () => {
  await store.add([row("lamp"), row("bowl")], 91);
  const [mug] = await store.add([row("mug")], 91);
  const changed = await store.update(mug.id, { priority: true }, 91);
  assert.deepEqual(codes(await store.listOpen()), ["P92 mug", "P93 lamp", "P94 bowl"]);
  assert.deepEqual(changed.map((i) => i.name).sort(), ["bowl", "lamp", "mug"]);
});

test("update with no position change reports nothing changed", async () => {
  const [lamp] = await store.add([row("lamp")], 91);
  const changed = await store.update(lamp.id, { name: "Lamp 2" }, 91);
  assert.deepEqual(changed.map((i) => i.name), ["Lamp 2"]);
  assert.equal((await store.listOpen())[0].productCode, "P92");
});

test("markStartedLeavesList and lower row takes next number", async () => {
  const [a, b, c] = await store.add([row("a"), row("b"), row("c")], 91);
  await store.markStarted(c.id, 500, "P92", 92);
  assert.deepEqual(codes(await store.listOpen()), ["P93 a", "P94 b"]);
  const started = await store.get(c.id);
  assert.equal(started.runId, 500);
  assert.equal(started.productCode, "P92");
  assert.ok(a && b);
});

test("concurrentImportsStayContiguous", async () => {
  await Promise.all([store.add([row("a"), row("b")], 91), store.add([row("c"), row("d")], 91)]);
  const got = (await store.listOpen()).map((i) => i.productCode);
  assert.deepEqual(got, ["P92", "P93", "P94", "P95"]);
});

test("doc state round-trips", async () => {
  const [a] = await store.add([row("a", true)], 91);
  await store.setDocState(a.id, { docTabId: "t.1", docTitle: "💦 P92 - a", docError: null });
  const got = await store.get(a.id);
  assert.equal(got.docTabId, "t.1");
  assert.equal(got.docTitle, "💦 P92 - a");
  assert.equal(got.priority, true);
  assert.deepEqual(got.urls, ["https://a.com"]);
});

test("adoptDocTabs keeps the tab id", async () => {
  const [x] = await store.adopt([{ ...row("x"), docTabId: "t.9", docTitle: "P93 - x" }], 91);
  assert.equal(x.docTabId, "t.9");
  assert.equal(x.productCode, "P92");
});
