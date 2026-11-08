"use strict";

// Summary: Rule R3-comment-temporary: a Temporary unit has a reason and then Until: with a condition.

const RULE_ID = "R3-comment-temporary";

// @purity pure
function judgeTemporary(units) {
  const violations = [];
  for (const unit of units) {
    if (unit.kind !== "Temporary") continue;
    const body = unit.text.replace(/^Temporary:\s*/, "");
    const at = body.indexOf("Until:");
    let message = null;
    if (at < 0) message = "Temporary has no Until: <condition>";
    else if (body.slice(0, at).trim() === "") message = "Temporary has no reason before Until:";
    else if (body.slice(at + "Until:".length).replace(/[.\s]/g, "") === "") message = "Temporary has an empty Until: condition";
    if (message !== null) violations.push({ rule: RULE_ID, line: unit.line, column: unit.column, message });
  }
  return violations;
}

module.exports = { RULE_ID, judgeTemporary };
