// Writes lib/changelog.json from the git history: one entry per "vX.Y.Z: …"
// commit (newest first), with the commit's "- " bullet lines as the items.
// Run before committing a release: `npm run changelog`. The JSON is committed
// because the Render build has no .git to read.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const raw = execFileSync("git", ["log", "--date=short", "--format=%ad%x1f%B%x1e"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const seen = new Set();
const entries = [];
for (const rec of raw.split("\x1e")) {
  const [date, body = ""] = rec.replace(/^\s+/, "").split("\x1f");
  const lines = body.split("\n");
  const m = /^v(\d+\.\d+\.\d+)\s*[:—-]\s*(.+)$/.exec((lines[0] ?? "").trim());
  if (!m || seen.has(m[1])) continue;
  seen.add(m[1]);
  const items = [];
  for (const line of lines.slice(1)) {
    if (/^Co-Authored-By:/i.test(line.trim())) break;
    if (/^\s*[-*] /.test(line)) items.push(line.replace(/^\s*[-*] /, "").trim());
    else if (/^\s{2,}\S/.test(line) && items.length) items[items.length - 1] += " " + line.trim();
  }
  entries.push({ version: m[1], date, title: m[2].trim(), items });
}

writeFileSync(new URL("../lib/changelog.json", import.meta.url), JSON.stringify(entries, null, 1) + "\n");
console.log(`${entries.length} versions → lib/changelog.json`);
