import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canBuildInto, paragraphRequests, tableFillRequests, tableInsertRequest, templateBlocks } from "../lib/google/template-plan.ts";

const template = JSON.parse(readFileSync(new URL("./fixtures/doc-template.json", import.meta.url), "utf8"));

test("template blocks: no section break, no final empty line", () => {
  const blocks = templateBlocks(template);
  assert.equal(blocks.length, template.length - 2);
  assert.equal(blocks.filter((b) => b.table).length, 3);
  assert.ok(blocks[0].paragraph);
});

test("heading paragraph: insert at 1, then style its exact range", () => {
  const heading = templateBlocks(template)[0];
  const reqs = paragraphRequests(heading, "t1", 1);
  assert.deepEqual(reqs[0], { insertText: { location: { index: 1, tabId: "t1" }, text: "Overview\n" } });
  const para = reqs[1].updateParagraphStyle;
  assert.deepEqual(para.range, { startIndex: 1, endIndex: 10, tabId: "t1" });
  assert.equal(para.paragraphStyle.namedStyleType, "HEADING_2");
  assert.equal(para.paragraphStyle.spaceAbove.magnitude, 0);
  assert.ok(!("headingId" in para.paragraphStyle));
  const text = reqs[2].updateTextStyle;
  assert.deepEqual(text.range, { startIndex: 1, endIndex: 10, tabId: "t1" });
  assert.equal(text.textStyle.fontSize.magnitude, 18);
});

test("an empty line made by a table insert is styled, not inserted again", () => {
  const blank = { paragraph: { elements: [{ textRun: { content: "\n", textStyle: {} } }], paragraphStyle: { namedStyleType: "NORMAL_TEXT" } } };
  const reqs = paragraphRequests(blank, "t1", 1, true);
  assert.ok(!reqs.some((r) => r.insertText));
  assert.deepEqual(reqs[0].updateParagraphStyle.range, { startIndex: 1, endIndex: 2, tabId: "t1" });
});

// An empty 2x2 table as the Docs API returns it after insertTable at 1.
function emptyTable(start, rows, cols) {
  let i = start + 1;
  const tableRows = [];
  for (let r = 0; r < rows; r++) {
    i++; // row
    const tableCells = [];
    for (let c = 0; c < cols; c++) {
      const cellStart = i++;
      tableCells.push({ startIndex: cellStart, content: [{ startIndex: i, endIndex: i + 1, paragraph: { elements: [{ startIndex: i, textRun: { content: "\n" } }] } }] });
      i++;
    }
    tableRows.push({ tableCells });
  }
  return { startIndex: start, endIndex: i, table: { rows, columns: cols, tableRows } };
}

test("table: labels in descending order, styles at shifted positions", () => {
  const tpl = templateBlocks(template).filter((b) => b.table)[2]; // ONE LINERS 2x2
  assert.deepEqual(tableInsertRequest(tpl, "t1", 1), { insertTable: { rows: 2, columns: 2, location: { index: 1, tabId: "t1" } } });
  const made = emptyTable(2, 2, 2);
  const reqs = tableFillRequests(tpl, made, "t1");

  const widths = reqs.filter((r) => r.updateTableColumnProperties);
  assert.equal(widths.length, 2);
  assert.equal(widths[0].updateTableColumnProperties.tableColumnProperties.width.magnitude, 250);
  assert.equal(widths[0].updateTableColumnProperties.tableStartLocation.index, 2);

  const cells = reqs.filter((r) => r.updateTableCellStyle);
  assert.equal(cells.length, 4);
  assert.ok(cells[0].updateTableCellStyle.tableCellStyle.backgroundColor.color);
  assert.deepEqual(cells[2].updateTableCellStyle.tableRange.tableCellLocation, { tableStartLocation: { index: 2, tabId: "t1" }, rowIndex: 1, columnIndex: 0 });

  const inserts = reqs.filter((r) => r.insertText).map((r) => r.insertText);
  assert.deepEqual(inserts, [{ location: { index: 5, tabId: "t1" }, text: "ONE LINERS" }]);

  // Cell (0,1) started at 7; after the 10-character label it starts at 17.
  const paraRanges = reqs.filter((r) => r.updateParagraphStyle).map((r) => r.updateParagraphStyle.range);
  assert.deepEqual(paraRanges.map((r) => [r.startIndex, r.endIndex]), [[5, 16], [17, 18], [20, 21], [22, 23]]);
  const label = reqs.find((r) => r.updateTextStyle && r.updateTextStyle.range.startIndex === 5).updateTextStyle;
  assert.equal(label.textStyle.bold, true);
  // Style requests come after every insert.
  const lastInsert = reqs.findLastIndex((r) => r.insertText);
  const firstStyle = reqs.findIndex((r) => r.updateParagraphStyle);
  assert.ok(lastInsert < firstStyle);
});

test("the big table gets every label once, back to front", () => {
  const tpl = templateBlocks(template).filter((b) => b.table)[0];
  const reqs = tableFillRequests(tpl, emptyTable(2, 18, 2), "t1");
  const inserts = reqs.filter((r) => r.insertText).map((r) => r.insertText);
  assert.equal(inserts.length, 9);
  assert.equal(inserts.at(-1).text, "BADGE TEXT");
  for (let i = 1; i < inserts.length; i++) assert.ok(inserts[i - 1].location.index > inserts[i].location.index);
});

test("only empty tabs or the old overview lines are built into", () => {
  const para = (t) => ({ paragraph: { elements: [{ textRun: { content: t } }] } });
  assert.equal(canBuildInto([{ sectionBreak: {} }, para("\n")]), true);
  assert.equal(canBuildInto([para("Product name: Mug\n"), para("Competitor/example link: https://a.com\n"), para("Alibaba link:\n"), para("\n")]), true);
  assert.equal(canBuildInto(template), false);
  assert.equal(canBuildInto([para("Some notes the operator typed\n")]), false);
});
