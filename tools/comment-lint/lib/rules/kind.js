"use strict";

// Summary: Rule R3-comment-kind (kind): every comment line belongs to a unit that starts with a kind.

const RULE_ID = "R3-comment-kind";

// @purity pure
function judgeKind(splitRuns) {
  const violations = [];
  for (const { strays } of splitRuns) {
    let previousLine = -2;
    for (const stray of strays) {
      // Why: One report per block of adjacent stray lines keeps a long untyped comment to one finding.
      if (stray.line !== previousLine + 1) {
        violations.push({
          rule: RULE_ID,
          check: "kind",
          line: stray.line,
          column: stray.column,
          message: "comment does not start with a kind (Why:, Spec:, Summary:, Temporary:, Section:, Consistency:, @purity, or a kind from the config)",
        });
      }
      previousLine = stray.line;
    }
  }
  return violations;
}

module.exports = { RULE_ID, judgeKind };
