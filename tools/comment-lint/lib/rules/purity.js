"use strict";

// Summary: Rule R7-purity-tag: every function and method has exactly one @purity tag with one of the 4 values.
// A function site is { line, column, name, isSingleExpression, commentIndexes } from a parser adapter.
// Temporary: The summary has two sentences. Until: The design of comment-lint is in a specification.

const { commentLines } = require("../units");

const RULE_ID = "R7-purity-tag";
const VALUES = Object.freeze(["pure", "semi-pure-immutable", "semi-pure-mutable", "non-pure"]);
const LEGACY_VALUES = Object.freeze(["semi-pure", "semi-pure-a", "semi-pure-b"]);
const TAG = /^@purity(?:\s+(\S+))?/;

// @purity pure
function findTags(comment) {
  const tags = [];
  for (const line of commentLines(comment)) {
    const match = TAG.exec(line.body);
    if (match !== null) tags.push({ line: line.line, column: line.column, value: match[1] });
  }
  return tags;
}

// @purity pure
function valueViolation(tag) {
  let message = null;
  if (tag.value === undefined) message = "@purity tag has no value";
  else if (LEGACY_VALUES.includes(tag.value)) message = `@purity value ${tag.value} is a legacy value; use one of ${VALUES.join(", ")}`;
  else if (!VALUES.includes(tag.value)) message = `@purity value ${tag.value} is unknown; use one of ${VALUES.join(", ")}`;
  return message === null ? null : { rule: RULE_ID, line: tag.line, column: tag.column, message };
}

// @purity pure
function judgePurity(comments, functions, options) {
  const violations = [];
  const tagsByComment = comments.map(findTags);
  for (const tags of tagsByComment) {
    for (const tag of tags) {
      const violation = valueViolation(tag);
      if (violation !== null) violations.push(violation);
    }
  }
  if (options.isExemptFile) return violations;
  const attached = new Set();
  for (const site of functions) {
    for (const index of site.commentIndexes) attached.add(index);
    if (site.isSingleExpression && options.exemptSingleExpressionLambdas) continue;
    const count = site.commentIndexes.reduce((sum, index) => sum + tagsByComment[index].length, 0);
    if (count === 1) continue;
    const name = site.name === null ? "anonymous function" : `function ${site.name}`;
    violations.push({
      rule: RULE_ID,
      line: site.line,
      column: site.column,
      message: count === 0 ? `${name} has no @purity tag` : `${name} has ${count} @purity tags; exactly one is allowed`,
    });
  }
  for (const [index, tags] of tagsByComment.entries()) {
    if (attached.has(index)) continue;
    for (const tag of tags) {
      violations.push({ rule: RULE_ID, line: tag.line, column: tag.column, message: "@purity tag is not attached to a function or method" });
    }
  }
  return violations;
}

module.exports = { RULE_ID, VALUES, LEGACY_VALUES, findTags, judgePurity };
