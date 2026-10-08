import { test } from "node:test";
import assert from "node:assert/strict";
import { orderItems, assignCodes, codeForStart } from "../lib/import/numbering.ts";

const lamp = { id: 1, priority: false, createdAt: "2026-10-08T10:00:00.000Z" };
const bowl = { id: 2, priority: false, createdAt: "2026-10-08T10:01:00.000Z" };
const mug = { id: 3, priority: true, createdAt: "2026-10-08T10:02:00.000Z" };

test("priority first, then oldest", () => {
  assert.deepEqual(orderItems([bowl, mug, lamp]).map((i) => i.id), [3, 1, 2]);
});
test("same timestamp falls back to id", () => {
  const a = { id: 5, priority: false, createdAt: "t" }, b = { id: 4, priority: false, createdAt: "t" };
  assert.deepEqual(orderItems([a, b]).map((i) => i.id), [4, 5]);
});
test("does not mutate input", () => {
  const arr = [bowl, lamp];
  orderItems(arr);
  assert.deepEqual(arr.map((i) => i.id), [2, 1]);
});
test("spec example: base 91 → mug P92, lamp P93, bowl P94", () => {
  const codes = assignCodes(91, [lamp, bowl, mug]);
  assert.equal(codes.get(3), "P92");
  assert.equal(codes.get(1), "P93");
  assert.equal(codes.get(2), "P94");
});
test("startLowerRowTakesNextNumber", () => {
  // base 91, open A P92, B P93, C P94; start C → C gets P92, A/B shift to P93/P94.
  const A = { id: 1, priority: false, createdAt: "1" }, B = { id: 2, priority: false, createdAt: "2" };
  assert.equal(codeForStart(91), "P92");
  const after = assignCodes(92, [A, B]);
  assert.equal(after.get(1), "P93");
  assert.equal(after.get(2), "P94");
});
