"use strict";

// Summary: Rule R3-comment-spec: every ID of a Spec unit is found in the specification.

const RULE_ID = "R3-comment-spec";

// @purity pure
function extractSpecIds(text, idPattern) {
  const ids = new Set();
  for (const match of text.matchAll(new RegExp(idPattern.source, "g"))) ids.add(match[0]);
  return ids;
}

// @purity pure
function judgeSpec(units, specIds, idPattern) {
  const violations = [];
  for (const unit of units) {
    if (unit.kind !== "Spec") continue;
    const body = unit.text.replace(/^Spec:\s*/, "");
    const ids = [...extractSpecIds(body, idPattern)];
    if (ids.length === 0) {
      violations.push({
        rule: RULE_ID,
        line: unit.line,
        column: unit.column,
        message: `Spec comment has no ID of the form /${idPattern.source}/`,
      });
      continue;
    }
    for (const id of ids) {
      if (specIds.has(id)) continue;
      violations.push({
        rule: RULE_ID,
        line: unit.line,
        column: unit.column,
        message: `Spec ID ${id} is not in the specification`,
      });
    }
  }
  return violations;
}

module.exports = { RULE_ID, extractSpecIds, judgeSpec };
