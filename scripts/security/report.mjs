// Turns tests/security/.results.jsonl into Markdown tables (summary + every case with evidence).
// Usage: npm run security:report > tests/security/results.md
import { readFileSync } from "node:fs";

const lines = readFileSync(new URL("../../tests/security/.results.jsonl", import.meta.url), "utf8").trim().split("\n");
// Keep the latest result for each case (the suite may have been rerun after fixes).
const latest = new Map();
for (const line of lines) {
  const r = JSON.parse(line);
  latest.set(`${r.category}|${r.name}`, r);
}
const results = [...latest.values()].sort((a, b) => a.category.localeCompare(b.category));
const status = (r) => (r.na ? "N/A" : r.pass ? "PASS" : "FAIL");
const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");

const byCategory = new Map();
for (const r of results) {
  const c = byCategory.get(r.category) ?? { tests: 0, pass: 0, fail: 0, na: 0 };
  c.tests += 1;
  c[status(r) === "PASS" ? "pass" : status(r) === "FAIL" ? "fail" : "na"] += 1;
  byCategory.set(r.category, c);
}
console.log("| Category | Tests | Pass | Fail | N/A |\n|---|---:|---:|---:|---:|");
const total = { tests: 0, pass: 0, fail: 0, na: 0 };
for (const [name, c] of byCategory) {
  console.log(`| ${name} | ${c.tests} | ${c.pass} | ${c.fail} | ${c.na} |`);
  for (const k of Object.keys(total)) total[k] += c[k];
}
console.log(`| **Total** | **${total.tests}** | **${total.pass}** | **${total.fail}** | **${total.na}** |\n`);

for (const [name] of byCategory) {
  console.log(`#### ${name}\n\n| Status | Test | Request | Expected | Actual |\n|---|---|---|---|---|`);
  for (const r of results.filter((x) => x.category === name)) {
    console.log(`| ${status(r)} | ${cell(r.name)} | ${cell(r.request)} | ${cell(r.expected)} | ${cell(r.actual)} |`);
  }
  console.log("");
}
