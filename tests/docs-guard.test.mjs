import { test } from "node:test";
import assert from "node:assert/strict";
import { assertNonDestructive } from "../lib/google/guard.ts";

test("allows insert, tab create and tab rename", () => {
  assert.doesNotThrow(() => assertNonDestructive([
    { insertText: {} }, { addDocumentTab: {} }, { updateDocumentTabProperties: {} },
  ]));
});
test("assertNonDestructiveRejectsDelete", () => {
  assert.throws(() => assertNonDestructive([{ deleteTab: {} }]), /deleteTab/);
  assert.throws(() => assertNonDestructive([{ deleteContentRange: {} }]), /deleteContentRange/);
  assert.throws(() => assertNonDestructive([{ replaceAllText: {} }]), /replaceAllText/);
});
