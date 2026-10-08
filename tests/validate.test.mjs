import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRows } from "../lib/import/validate.ts";

test("fully empty rows are ignored", () => {
  const r = validateRows([{ name: "", links: "  ", priority: false }, { name: "Mug", links: "https://a.com", priority: true }]);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.items, [{ name: "Mug", urls: ["https://a.com"], priority: true }]);
});
test("missing name or link is flagged by row index", () => {
  const r = validateRows([{ name: "Mug", links: "", priority: false }, { name: "", links: "https://a.com", priority: false }]);
  assert.deepEqual(r.errors.map((e) => e.index), [0, 1]);
  assert.match(r.errors[0].message, /link/i);
  assert.match(r.errors[1].message, /name/i);
});
test("non-link text is flagged", () => {
  const r = validateRows([{ name: "Mug", links: "https://a.com see reel", priority: false }]);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /see/);
});
test("keeps references and competitors, deduped, in urls", () => {
  const r = validateRows([{ name: "Mug", links: "https://instagram.com/reel/x https://a.com https://a.com", priority: false }]);
  assert.deepEqual(r.items[0].urls, ["https://instagram.com/reel/x", "https://a.com"]);
});
test("name is capped at 200 chars", () => {
  const r = validateRows([{ name: "x".repeat(300), links: "https://a.com", priority: false }]);
  assert.equal(r.items[0].name.length, 200);
});
test("garbage input shape is rejected per row", () => {
  const r = validateRows([null, { name: 5 }]);
  assert.equal(r.items.length, 0);
});
