import { test } from "node:test";
import assert from "node:assert/strict";
import { withTrailingEmpty, emptyRow } from "../lib/import/rows.ts";

const r = (name, links = "", priority = false) => ({ key: name || "k", name, links, priority });

test("adds an empty row when the last one has text", () => {
  const out = withTrailingEmpty([r("Mug")]);
  assert.equal(out.length, 2);
  assert.equal(out[1].name, "");
});
test("priority alone does not count as text", () => {
  assert.equal(withTrailingEmpty([{ ...emptyRow(), priority: true }]).length, 1);
});
test("collapses several trailing empty rows to one", () => {
  const out = withTrailingEmpty([r("Mug"), r(""), r(""), r("")]);
  assert.equal(out.length, 2);
});
test("keeps empty rows in the middle", () => {
  const out = withTrailingEmpty([r("A"), r(""), r("B")]);
  assert.deepEqual(out.map((x) => x.name), ["A", "", "B", ""]);
});
test("empty table gets one row", () => {
  assert.equal(withTrailingEmpty([]).length, 1);
});
test("emptyRow keys are unique", () => {
  assert.notEqual(emptyRow().key, emptyRow().key);
});
