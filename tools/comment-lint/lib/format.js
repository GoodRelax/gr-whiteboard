"use strict";

// Summary: Formats a lint report as text lines or as JSON with the same content, all in ASCII.

const { TOOL_NAME, TOOL_VERSION, STANDARD, RULES, RULE_IDS, headerLine } = require("./standard");

// @purity pure
function totalsOf(violations) {
  const byRule = {};
  for (const rule of RULE_IDS) byRule[rule] = 0;
  const byCheck = { kind: 0, english: 0 };
  for (const violation of violations) {
    byRule[violation.rule] += 1;
    if (violation.check !== undefined) byCheck[violation.check] += 1;
  }
  return { violations: violations.length, files: new Set(violations.map((violation) => violation.file)).size, byRule, byCheck };
}

// @purity pure
function formatText(report) {
  const lines = [headerLine()];
  for (const error of report.errors) lines.push(`${error.display}:${error.line}:${error.column}: error ${error.message}`);
  for (const violation of report.shown) {
    lines.push(`${violation.display}:${violation.line}:${violation.column}: ${violation.rule} ${violation.message}`);
  }
  const totals = totalsOf(report.violations);
  const byRule = RULE_IDS.map((rule) => `${rule} ${totals.byRule[rule]}`).join(", ");
  let summary = `${totals.violations} violations in ${totals.files} of ${report.fileCount} files (${byRule})`;
  if (report.baseline !== null) {
    summary += `; ${report.shown.length} violations over the baseline in ${report.baseline.over.length} file/rule pairs`;
    if (report.baseline.under.length > 0) summary += `; ${report.baseline.under.length} file/rule pairs are below the baseline (run with --update-baseline to lower it)`;
  }
  if (report.errors.length > 0) summary += `; ${report.errors.length} errors`;
  lines.push(summary);
  return `${lines.join("\n")}\n`;
}

// @purity pure
function jsonViolation(violation) {
  const entry = { file: violation.display, line: violation.line, column: violation.column, rule: violation.rule };
  if (violation.check !== undefined) entry.check = violation.check;
  entry.severity = RULES[violation.rule].severity;
  entry.message = violation.message;
  return entry;
}

// @purity pure
function formatJson(report) {
  const document = {
    tool: TOOL_NAME,
    version: TOOL_VERSION,
    standard: { ...STANDARD },
    fileCount: report.fileCount,
    errors: report.errors.map((error) => ({ file: error.display, line: error.line, column: error.column, message: error.message })),
    violations: report.shown.map(jsonViolation),
    totals: totalsOf(report.violations),
  };
  if (report.baseline !== null) document.baseline = { file: report.baseline.display, over: report.baseline.over, under: report.baseline.under };
  // Why: The output stays ASCII even if a file name has other characters.
  return `${JSON.stringify(document, null, 2).replace(/[\u0080-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`)}\n`;
}

module.exports = { formatText, formatJson, totalsOf };
