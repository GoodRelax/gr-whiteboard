"use strict";

// Summary: Judges the comments and function sites of one file against all rules, with no parser involved.

const { groupRuns, splitUnits } = require("./units");
const { judgeKind } = require("./rules/kind");
const { judgeEnglish } = require("./rules/english");
const { judgeSpec } = require("./rules/spec");
const { judgeSummary } = require("./rules/summary");
const { judgeTemporary } = require("./rules/temporary");
const { judgePurity } = require("./rules/purity");

// @purity pure
function skippedComments(comments, options) {
  const skipped = new Set();
  for (const [index, comment] of comments.entries()) {
    if (comment.style === "hashbang" && options.allowShebang) skipped.add(index);
  }
  // Why: A license header is not our own comment; only the first run of the file can be one.
  const firstIndex = comments.findIndex((comment) => comment.style !== "hashbang");
  if (firstIndex >= 0 && options.licenseHeaderPattern !== null) {
    const firstRun = groupRuns(comments.slice(firstIndex))[0];
    if (firstRun.comments.some((comment) => options.licenseHeaderPattern.test(comment.text))) {
      firstRun.comments.forEach((_, offset) => skipped.add(firstIndex + offset));
    }
  }
  return skipped;
}

// @purity pure
function compareViolations(left, right) {
  return left.line - right.line || left.column - right.column || left.rule.localeCompare(right.rule);
}

// @purity pure
function judgeFile(input, options) {
  const skipped = skippedComments(input.comments, options);
  const kept = input.comments.filter((_, index) => !skipped.has(index));
  const splitRuns = groupRuns(kept).map((run) => splitUnits(run, options.kinds));
  const runUnits = splitRuns.map((split) => split.units);
  const units = runUnits.flat();
  return [
    ...judgeKind(splitRuns),
    ...judgeEnglish(kept),
    ...judgeSpec(units, options.specIds, options.specIdPattern),
    ...judgeSummary(runUnits),
    ...judgeTemporary(units),
    ...judgePurity(input.comments, input.functions, {
      isExemptFile: options.isPurityExemptFile,
      exemptSingleExpressionLambdas: options.exemptSingleExpressionLambdas,
    }),
  ].sort(compareViolations);
}

module.exports = { judgeFile };
