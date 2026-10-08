import { test } from "node:test";
import assert from "node:assert/strict";
import { codeNumber, isPriorityTitle, tabTitle } from "../lib/import/codes.ts";

test("plain code", () => assert.equal(codeNumber("P58 - Wall Lamp"), 58));
test("emoji prefix", () => assert.equal(codeNumber("💦 P90 - Lamp"), 90));
test("double emoji, no space", () => assert.equal(codeNumber("💦💦 P93-Mug"), 93));
test("leading zeros and lowercase", () => assert.equal(codeNumber("p007"), 7));
test("no code", () => assert.equal(codeNumber("Template"), null));
test("malformed", () => assert.equal(codeNumber("P 7x"), null));
test("null and empty", () => { assert.equal(codeNumber(null), null); assert.equal(codeNumber(""), null); });
test("word starting with P is not a code", () => assert.equal(codeNumber("Pricing notes"), null));
test("priority is 💦 only", () => {
  assert.ok(isPriorityTitle("💦 P1 - A"));
  assert.ok(!isPriorityTitle("💧 P1 - A"));
  assert.ok(!isPriorityTitle("P1 - A"));
});
test("tab title", () => {
  assert.equal(tabTitle("P92", "Mug", true), "💦 P92 - Mug");
  assert.equal(tabTitle("P92", "  Mug ", false), "P92 - Mug");
});

import { sameCode } from "../lib/import/codes.ts";
test("sameCode matches a 💦 tab to a plain run code", () => {
  assert.ok(sameCode("💦 P93 - Mug", "P93"));
  assert.ok(sameCode("P093 - Mug", "p93"));
  assert.ok(!sameCode("P930 - Mug", "P93"));
  assert.ok(!sameCode("Template", "P93"));
  assert.ok(!sameCode("Template", ""));
});
