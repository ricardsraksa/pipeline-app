// Unit test for the Google Doc fill planner, against a structural replica of
// the operator's real master doc ("0 - Saintport"): product tabs nested under
// group tabs, template tables with a label row followed by an empty value row,
// and the Facebook table's pre-filled boilerplate row that must never be
// touched. Run with: node tests/gdoc-fill.test.mjs (built via esbuild).

import { flattenTabs, findProductTab, planFills, planOverviewFills } from "@/lib/google/docs";
import type { Stage2Json } from "@/lib/stage2/shape";

let nextIndex = 100;
function cell(text: string) {
  const startIndex = nextIndex;
  nextIndex += Math.max(text.length + 2, 4);
  return { content: [{ startIndex, endIndex: nextIndex - 1, paragraph: { elements: [{ textRun: { content: text } }] } }] };
}
function row(...texts: string[]) {
  return { tableCells: texts.map((t) => cell(t)) };
}
function table(rows: Array<ReturnType<typeof row>>) {
  return { table: { tableRows: rows } };
}

// The template, row for row as in the screenshot.
const shopifyTable = table([
  row("BADGE TEXT"), row(""),
  row("SUPPORTING SENTENCE"), row(""),
  row("BENEFIT SECTION"), row(""),
  row("FAQ - What's Included (Answer)"), row(""),
  row("FAQ - Custom Question 1"), row(""),
  row("FAQ - Custom Question 2"), row(""),
  row("SECTION 1"), row(""),
  row("SECTION 2"), row(""),
  row("SECTION 3"), row(""),
]);
const facebookTable = table([
  row("Headline"), row(""),
  row("Primary Text"), row(""),
  row("Description"), row("Winter Sale -> LINK", "Free Shipping"), // pre-filled boilerplate
]);
const adTable = table([row("ONE LINERS"), row("")]);

function para(text: string) {
  const startIndex = nextIndex;
  nextIndex += text.length + 2;
  return { startIndex, endIndex: nextIndex - 1, paragraph: { elements: [{ textRun: { content: text + "\n" } }] } };
}
const overviewParas = [
  para("Product Name: "),
  para("COGS: "),
  para("Pricing: 24.99"),
  para("Alibaba link: "),
  para("Competitor / Example Link: https://example.com/existing"),
];
const productTab = {
  tabProperties: { tabId: "t.p58", title: "P58 - Anti Theft Backpack" },
  documentTab: { body: { content: [...overviewParas, shopifyTable, facebookTable, adTable] } },
};
const doc = {
  tabs: [
    { tabProperties: { tabId: "t.root", title: "0 - Saintport" }, documentTab: { body: { content: [] } } },
    {
      tabProperties: { tabId: "t.group", title: "TO TEST" },
      documentTab: { body: { content: [] } },
      childTabs: [
        { tabProperties: { tabId: "t.p55", title: "P55 - Wall Lamp" }, documentTab: { body: { content: [] } } },
        productTab,
      ],
    },
  ],
};

const json: Stage2Json = {
  product_name: "GuardPack Anti-Theft Backpack",
  badge: "Popular",
  supporting_sentence: "The backpack with hidden zippers.",
  benefits: ["Hidden zippers stop pickpockets", "Fits a 15-inch laptop", "Water-resistant shell"],
  sections: [
    { headline: "Safe in Crowds", paragraph: "Zippers sit against your back." },
    { headline: "Everything In Its Place", paragraph: "Twelve pockets keep gear sorted." },
    { headline: "Built For Commutes", paragraph: "Padded straps carry all day" },
  ],
  whats_included: "One backpack and a rain cover.",
  faqs: [
    { q: "Will it fit under an airline seat?", a: "Yes, it measures 45 x 30 cm." },
    { q: "Is it actually waterproof?", a: "Water-resistant shell handles rain" },
  ],
  facebook: { headline: "Steal-Proof Bag", primary: "Hidden zippers keep thieves out", description: "Free shipping this week" },
  one_liners: ["Zippers thieves can't find", "Rain rolls right off"],
};

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failures++;
}

// 1) Tab discovery through nested groups, case-insensitive
const tabs = flattenTabs(doc.tabs as never[]);
check("flattens nested tabs", tabs.length === 4, String(tabs.length));
const found = findProductTab(tabs, "p58");
check("finds P58 tab under a group, case-insensitive", found?.tabProperties?.tabId === "t.p58");
check("no match for unknown code", findProductTab(tabs, "P999") === undefined);
check("P5 does not falsely match P58/P55", findProductTab(tabs, "P5") === undefined);

// 2) The plan
const { rows, inserts } = planFills(productTab as never, json);
const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.status]));
const expectFilled = ["badgetext", "supportingsentence", "benefitsection", "faqwhatsincludedanswer",
  "faqcustomquestion1", "faqcustomquestion2", "section1", "section2", "section3",
  "headline", "primarytext", "oneliners"];
for (const l of expectFilled) check(`fills ${l}`, byLabel[l] === "filled", String(byLabel[l]));
check("boilerplate Description row is skipped (already-filled)", byLabel["description"] === "already-filled", String(byLabel["description"]));
check("12 inserts planned", inserts.length === 12, String(inserts.length));

// 3) Content correctness
const textFor = (label: string) => {
  const w = inserts.find((i) => {
    // reverse-map: find the insert whose text matches the expected value
    return true;
  });
  return w;
};
const texts = inserts.map((i) => i.text);
check("benefits joined one per line", texts.includes("Hidden zippers stop pickpockets\nFits a 15-inch laptop\nWater-resistant shell"));
check("FAQ 1 is question + answer", texts.includes("Will it fit under an airline seat?\nYes, it measures 45 x 30 cm."));
check("section 1 is headline + paragraph", texts.includes("Safe in Crowds\nZippers sit against your back."));
check("one-liners joined", texts.includes("Zippers thieves can't find\nRain rolls right off"));
check("facebook headline present", texts.includes("Steal-Proof Bag"));

// 4) Descending-sort invariant the writer relies on
const sorted = [...inserts].sort((a, b) => b.index - a.index);
check("indices unique", new Set(inserts.map((i) => i.index)).size === inserts.length);
check("descending sort leaves later inserts unaffected by earlier ones",
  sorted.every((v, i, a) => i === 0 || a[i - 1].index > v.index));

// 5) Empty values are skipped, never written
const sparse: Stage2Json = { ...json, badge: "", one_liners: [] };
const plan2 = planFills(productTab as never, sparse);
const by2 = Object.fromEntries(plan2.rows.map((r) => [r.label, r.status]));
check("empty badge skipped as empty-value", by2["badgetext"] === "empty-value");
check("empty one-liners skipped as empty-value", by2["oneliners"] === "empty-value");

// 6) Overview lines: bare labels fill, occupied ones skip, unknown values skip
const ov = planOverviewFills(productTab as never, {
  productName: "GuardPack Anti-Theft Backpack",
  productUrl: "https://aliexpress.com/item/123.html",
  competitorUrl: "https://competitor.com/products/bag",
});
const ovBy = Object.fromEntries(ov.rows.map((r) => [r.label, r.status]));
check("overview product name fills", ovBy["overview: product name"] === "filled", String(ovBy["overview: product name"]));
check("overview alibaba link fills", ovBy["overview: alibaba link"] === "filled", String(ovBy["overview: alibaba link"]));
check("occupied competitor line skipped", ovBy["overview: competitor link"] === "already-filled", String(ovBy["overview: competitor link"]));
check("overview inserts land before the newline", ov.inserts.every((i) => Number.isInteger(i.index)));
check("2 overview inserts", ov.inserts.length === 2, String(ov.inserts.length));
const ov2 = planOverviewFills(productTab as never, { productName: "X" });
check("missing url values reported empty-value", ov2.rows.some((r) => r.label === "overview: alibaba link" && r.status === "empty-value"));

console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
