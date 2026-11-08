"use strict";

// Summary: The ratchet: counts violations per file and rule, and finds the counts that rose above the baseline.

const { TOOL_NAME, TOOL_VERSION, STANDARD } = require("./standard");

// @purity pure
function countViolations(violations) {
  const files = {};
  for (const violation of violations) {
    const perFile = files[violation.file] || (files[violation.file] = {});
    perFile[violation.rule] = (perFile[violation.rule] || 0) + 1;
  }
  return files;
}

// @purity pure
function baselineDocument(violations) {
  const counts = countViolations(violations);
  const files = {};
  for (const file of Object.keys(counts).sort()) {
    files[file] = {};
    for (const rule of Object.keys(counts[file]).sort()) files[file][rule] = counts[file][rule];
  }
  return { tool: `${TOOL_NAME} ${TOOL_VERSION}`, standard: { ...STANDARD }, files };
}

// @purity pure
function compareToBaseline(violations, baseline) {
  const counts = countViolations(violations);
  const allowedFiles = baseline && baseline.files ? baseline.files : {};
  const over = [];
  const under = [];
  for (const file of Object.keys(counts)) {
    for (const rule of Object.keys(counts[file])) {
      const allowed = (allowedFiles[file] && allowedFiles[file][rule]) || 0;
      if (counts[file][rule] > allowed) over.push({ file, rule, count: counts[file][rule], allowed });
    }
  }
  for (const file of Object.keys(allowedFiles)) {
    for (const rule of Object.keys(allowedFiles[file])) {
      const count = (counts[file] && counts[file][rule]) || 0;
      if (count < allowedFiles[file][rule]) under.push({ file, rule, count, allowed: allowedFiles[file][rule] });
    }
  }
  return { over, under };
}

// @purity pure
function violationsOver(violations, over) {
  const keys = new Set(over.map((entry) => `${entry.file}\n${entry.rule}`));
  return violations.filter((violation) => keys.has(`${violation.file}\n${violation.rule}`));
}

module.exports = { countViolations, baselineDocument, compareToBaseline, violationsOver };
