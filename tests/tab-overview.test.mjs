import { test } from "node:test";
import assert from "node:assert/strict";
import { readTabOverview } from "../lib/import/tab-overview.ts";

test("reads overview lines", () => {
  const o = readTabOverview(["Product name: Mug\n", "Competitor/example link: https://a.com https://b.com\n", "Alibaba link:\n"]);
  assert.deepEqual(o, { productName: "Mug", links: ["https://a.com", "https://b.com"], alibabaLink: null });
});
test("filled alibaba link and spaced label", () => {
  const o = readTabOverview(["Competitor / example link: https://a.com", "Alibaba link: https://aliexpress.com/item/1.html"]);
  assert.equal(o.alibabaLink, "https://aliexpress.com/item/1.html");
  assert.equal(o.productName, null);
});
test("non-url text in link line is ignored", () => {
  assert.deepEqual(readTabOverview(["Competitor/example link: see reel"]).links, []);
});
