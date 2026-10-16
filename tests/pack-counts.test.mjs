import { test } from "node:test";
import assert from "node:assert/strict";
import { packCount, splitPackOptions } from "../lib/product.ts";

test("pack counts are recognised", () => {
  for (const [v, n] of [["1pcs", 1], ["5PCS", 5], ["2 pcs", 2], ["3 Pieces", 3], ["Set of 4", 4], ["2 Pack", 2], ["Pack of 6", 6], ["2 pairs", 2], ["10pc", 10]]) assert.equal(packCount(v), n, v);
  for (const v of ["Red", "c-1pcs", "ab-2pcs", "38", "XL", "120cm", "2 in 1"]) assert.equal(packCount(v), null, v);
  assert.equal(packCount("3", "Quantity"), 3);
  assert.equal(packCount("38", "Size"), null);
});

test("a group of counts leaves the variants; real choices stay", () => {
  const out = splitPackOptions({ Color: ["1pcs", "5pcs", "2pcs", "3pcs"], Size: ["S", "M"] });
  assert.deepEqual(out.options, { Size: ["S", "M"] });
  assert.deepEqual(out.packCounts, [1, 2, 3, 5]);
  // A count attached to a real choice: the choice stays, the count goes.
  const mixed = splitPackOptions({ "Color Name": ["Browm-1pc", "Black-2pcs", "Browm-2pcs", "Grey-4pcs", "Black-1pc"] });
  assert.deepEqual(mixed.options, { "Color Name": ["Browm", "Black", "Grey"] });
  assert.deepEqual(mixed.packCounts, [1, 2, 4]);
  // A lone value is no choice.
  assert.deepEqual(splitPackOptions({ Color: ["2PCS"] }), { options: {}, packCounts: [2] });
  assert.deepEqual(splitPackOptions({ Color: ["Red"] }).options, {});
  // Shoe sizes are not counts.
  assert.deepEqual(splitPackOptions({ Size: ["38", "39", "40"] }).packCounts, []);
});
