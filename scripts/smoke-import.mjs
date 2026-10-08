// Smoke test for the Import API against the LOCAL test server
// (.claude/dev-test.sh: file DB, test password, Google off).
// Run: node --env-file=data/dev-test.env scripts/smoke-import.mjs
import assert from "node:assert/strict";

const BASE = process.env.SMOKE_URL ?? "http://localhost:3100";
assert.ok(/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE), "smoke runs against a local server only");

const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: process.env.PIPELINE_PASSWORD }) });
assert.equal(login.status, 200, "login");
const cookie = login.headers.get("set-cookie").split(";")[0];
const call = async (path, method = "GET", body) => {
  const r = await fetch(`${BASE}${path}`, { method, headers: { cookie, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const tag = Date.now().toString(36);

// Bad rows are refused, with row indexes.
let r = await call("/api/import", "POST", { rows: [{ name: "x", links: "", priority: false }, { name: "", links: "https://a.com" }] });
assert.equal(r.status, 400);
assert.deepEqual(r.json.errors.map((e) => e.index), [0, 1]);

// Import lamp, bowl, then a priority mug.
const before = (await call("/api/import")).json.items.length;
r = await call("/api/import", "POST", { rows: [
  { name: `lamp-${tag}`, links: "https://lamp.example.com", priority: false },
  { name: `bowl-${tag}`, links: "https://www.instagram.com/reel/abc", priority: false },
  { name: "", links: "", priority: false },
] });
assert.equal(r.status, 200, JSON.stringify(r.json));
assert.equal(r.json.added, 2);
r = await call("/api/import", "POST", { rows: [{ name: `mug-${tag}`, links: "https://mug.example.com", priority: true }] });
assert.equal(r.status, 200);

let items = (await call("/api/import")).json.items;
assert.equal(items.length, before + 3);
const mine = items.filter((i) => i.name.endsWith(tag));
const num = (c) => Number(c.slice(1));
const nums = items.map((i) => num(i.productCode));
assert.deepEqual(nums, nums.map((_, k) => nums[0] + k), "codes contiguous in list order");
assert.ok(items[0].priority, "priority first");
console.log("list:", mine.map((i) => `${i.productCode} ${i.name}${i.priority ? " 💦" : ""}`).join(" | "));

// Toggle mug off priority → it goes back by date (after lamp and bowl).
const mug = mine.find((i) => i.name.startsWith("mug"));
r = await call(`/api/import/${mug.id}`, "PATCH", { priority: false });
assert.equal(r.status, 200);
items = (await call("/api/import")).json.items;
const order = items.filter((i) => i.name.endsWith(tag)).map((i) => i.name.split("-")[0]);
assert.deepEqual(order, ["lamp", "bowl", "mug"]);

// Start the bowl (a lower row; reel link) → takes the next number.
const firstCode = items[0].productCode;
const bowl = items.find((i) => i.name === `bowl-${tag}`);
r = await call(`/api/import/${bowl.id}/start`, "POST", { productUrl: "https://www.aliexpress.com/item/1005001.html" });
assert.equal(r.status, 200, JSON.stringify(r.json));
assert.equal(r.json.code, firstCode, "a started row takes the next number");
const run = (await call(`/api/runs/${r.json.runId}`)).json;
const runRow = run.run ?? run;
assert.equal(runRow.product_code, firstCode);
assert.equal(runRow.competitor_urls, null, "reel is not a competitor");
assert.deepEqual(JSON.parse(runRow.reference_urls), ["https://www.instagram.com/reel/abc"]);

// Starting twice is refused.
r = await call(`/api/import/${bowl.id}/start`, "POST", { productUrl: "https://www.aliexpress.com/item/1005001.html" });
assert.equal(r.status, 409);

// Remaining list still contiguous, now after the started run.
items = (await call("/api/import")).json.items;
assert.equal(num(items[0].productCode), num(firstCode) + 1);
console.log("smoke OK");
