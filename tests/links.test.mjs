import { test } from "node:test";
import assert from "node:assert/strict";
import { splitLinks } from "../lib/import/links.ts";

test("reel vs brand", () => {
  const r = splitLinks("https://www.instagram.com/reel/abc\nhttps://amazon.com/dp/X");
  assert.deepEqual(r.references, ["https://www.instagram.com/reel/abc"]);
  assert.deepEqual(r.competitors, ["https://amazon.com/dp/X"]);
  assert.deepEqual(r.invalid, []);
});
test("instagram /p/ post and bare host count as references", () => {
  const r = splitLinks(["https://instagram.com/p/xyz"]);
  assert.deepEqual(r.references, ["https://instagram.com/p/xyz"]);
});
test("splitLinksEdgeCases", () => {
  const brands = Array.from({ length: 7 }, (_, i) => `https://brand${i}.com`);
  const r = splitLinks(`\n\n  hello  \n${brands.join(" ")}\nhttps://brand0.com\n`);
  assert.deepEqual(r.invalid, ["hello"]);
  assert.equal(r.competitors.length, 5);
  assert.deepEqual(r.competitors, brands.slice(0, 5));
});
test("lookalike host is not instagram", () => {
  const r = splitLinks("https://notinstagram.com/reel/a");
  assert.deepEqual(r.references, []);
  assert.deepEqual(r.competitors, ["https://notinstagram.com/reel/a"]);
});
