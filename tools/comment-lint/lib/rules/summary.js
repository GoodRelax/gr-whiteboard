"use strict";

// Summary: Rule R3-comment-summary: a Summary unit has at most 3 sentences, and 2 or 3 need a Temporary right after.

const RULE_ID = "R3-comment-summary";
const MAX_SENTENCES = 3;
const ABBREVIATIONS = Object.freeze(["e.g.", "i.e.", "etc.", "vs.", "cf.", "approx."]);

// @purity pure
function countSentences(text) {
  // Why: Dots inside code spans, quoted strings, file names, numbers and abbreviations do not end a sentence.
  let plain = text.replace(/^Summary:\s*/, "").replace(/`[^`]*`/g, "x").replace(/"[^"]*"/g, "x");
  for (const abbreviation of ABBREVIATIONS) plain = plain.split(abbreviation).join(abbreviation.replace(/\./g, ""));
  return plain.split(/[.!?]+(?=\s|$)/).filter((part) => part.trim() !== "").length;
}

// @purity pure
function judgeSummary(runUnits) {
  const violations = [];
  for (const units of runUnits) {
    for (const [index, unit] of units.entries()) {
      if (unit.kind !== "Summary") continue;
      const count = countSentences(unit.text);
      const next = units[index + 1];
      const lastLine = unit.lines[unit.lines.length - 1].line;
      const hasTemporary = next !== undefined && next.kind === "Temporary" && next.line === lastLine + 1;
      if (count > MAX_SENTENCES) {
        violations.push({
          rule: RULE_ID,
          line: unit.line,
          column: unit.column,
          message: `Summary has ${count} sentences; split the processing (at most ${MAX_SENTENCES})`,
        });
      } else if (count >= 2 && !hasTemporary) {
        violations.push({
          rule: RULE_ID,
          line: unit.line,
          column: unit.column,
          message: `Summary has ${count} sentences but no Temporary on the next line`,
        });
      }
    }
  }
  return violations;
}

module.exports = { RULE_ID, countSentences, judgeSummary };
