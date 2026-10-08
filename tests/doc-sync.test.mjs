import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { createImportStore } from "../lib/import/store.ts";
import { createDocSync } from "../lib/import/doc-sync.ts";

let store, calls, fail;
const ops = {
  async createTab(title, overview) { calls.push(["create", title, overview]); if (fail.create) throw new Error("Docs API 500"); return { tabId: `t.${calls.length}` }; },
  async renameTab(tabId, title) { calls.push(["rename", tabId, title]); if (fail.rename) throw new Error("Docs API 503"); },
  async listTabs() { return [
    { tabId: "t.old1", title: "P91 - Old", code: 91 },
    { tabId: "t.own", title: "💦 P95 - Mine", code: 95 },
    { tabId: "t.tpl", title: "Template", code: null },
  ]; },
};
beforeEach(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "doc-sync-"));
  const client = createClient({ url: `file:${path.join(dir, "t.db")}` });
  await client.execute("CREATE TABLE runs (id INTEGER PRIMARY KEY, product_code TEXT)");
  store = createImportStore(client);
  await store.init();
  calls = []; fail = {};
});
const row = (name, priority = false) => ({ name, urls: [`https://${name}.com`], priority });

test("createsMissingTab with title and overview", async () => {
  const sync = createDocSync({ store, ops, configured: () => true });
  const [mug] = await store.add([row("mug", true)], 91);
  await sync.syncItems([mug]);
  assert.deepEqual(calls, [["create", "💦 P92 - mug", { productName: "mug", links: ["https://mug.com"] }]]);
  const got = await store.get(mug.id);
  assert.equal(got.docTabId, "t.1");
  assert.equal(got.docTitle, "💦 P92 - mug");
  assert.equal(got.docError, null);
});

test("renamesChangedTitle only when it differs", async () => {
  const sync = createDocSync({ store, ops, configured: () => true });
  const [lamp] = await store.add([row("lamp")], 91);
  await sync.syncItems([lamp]);
  await sync.syncItems([await store.get(lamp.id)]);
  assert.equal(calls.length, 1, "no-op when title already matches");
  const changed = await store.update(lamp.id, { priority: true }, 91);
  await sync.syncItems(changed);
  assert.deepEqual(calls[1], ["rename", "t.1", "💦 P92 - lamp"]);
});

test("syncRecordsErrorAndRetries", async () => {
  const sync = createDocSync({ store, ops, configured: () => true });
  const [a] = await store.add([row("a")], 91);
  fail.create = true;
  await sync.syncItems([a]);
  assert.match((await store.get(a.id)).docError, /500/);
  fail.create = false;
  await sync.syncItems([await store.get(a.id)]);
  const got = await store.get(a.id);
  assert.equal(got.docError, null);
  assert.equal(got.docTabId, "t.2");
});

test("one failure does not stop the rest", async () => {
  const sync = createDocSync({ store, ops, configured: () => true });
  const items = await store.add([row("a"), row("b")], 91);
  let n = 0;
  const flaky = { ...ops, async createTab(t, o) { n++; if (n === 1) throw new Error("boom"); return ops.createTab(t, o); } };
  await createDocSync({ store, ops: flaky, configured: () => true }).syncItems(items);
  const [a, b] = await Promise.all(items.map((i) => store.get(i.id)));
  assert.match(a.docError, /boom/);
  assert.ok(b.docTabId);
  assert.ok(sync);
});

test("not configured: no calls, no error", async () => {
  const sync = createDocSync({ store, ops, configured: () => false });
  const [a] = await store.add([row("a")], 91);
  await sync.syncItems([a]);
  assert.deepEqual(calls, []);
  assert.equal((await store.get(a.id)).docError, null);
});

test("docNumbers excludes tabs owned by import items", async () => {
  const sync = createDocSync({ store, ops, configured: () => true });
  await store.adopt([{ ...row("mine"), docTabId: "t.own", docTitle: "💦 P95 - Mine" }], 91);
  assert.deepEqual(await sync.docNumbers(), [91]);
});

test("docNumbers is empty when Google fails or is off", async () => {
  const broken = { ...ops, async listTabs() { throw new Error("403"); } };
  assert.deepEqual(await createDocSync({ store, ops: broken, configured: () => true }).docNumbers(), []);
  assert.deepEqual(await createDocSync({ store, ops, configured: () => false }).docNumbers(), []);
});
