"use strict";

// Summary: Tests the parser-free core with hand-made comment records, as a port to another parser would feed it.

const test = require("node:test");
const assert = require("node:assert/strict");
const { BUILT_IN_KINDS, groupRuns, splitUnits } = require("../lib/units");
const { judgeFile } = require("../lib/judge");
const { countSentences } = require("../lib/rules/summary");
const { extractSpecIds } = require("../lib/rules/spec");
const { globToRegExp, matchesAny } = require("../lib/glob");
const { ConfigError, normalizeConfig } = require("../lib/config");
const { baselineDocument, compareToBaseline, violationsOver } = require("../lib/baseline");

const ID_PATTERN = /\bFR-\d{3}\b/;

function lineComment(line, text, extra = {}) {
  return { line, column: 1, endLine: line, style: "line", text: ` ${text}`, isTrailing: false, ...extra };
}

function options(extra = {}) {
  return {
    kinds: BUILT_IN_KINDS,
    allowShebang: true,
    licenseHeaderPattern: null,
    specIds: new Set(["FR-001"]),
    specIdPattern: ID_PATTERN,
    isPurityExemptFile: false,
    exemptSingleExpressionLambdas: true,
    ...extra,
  };
}

test("adjacent own-line comments form one run; a gap or a trailing comment starts another", () => {
  const runs = groupRuns([
    lineComment(1, "Why: a"),
    lineComment(2, "b"),
    lineComment(4, "Why: c"),
    lineComment(5, "Why: d", { isTrailing: true, column: 10 }),
  ]);
  assert.deepEqual(runs.map((run) => run.comments.map((comment) => comment.line)), [[1, 2], [4], [5]]);
});

test("a line without a kind continues the unit before it, except after @purity", () => {
  const [run] = groupRuns([lineComment(1, "Why: a"), lineComment(2, "b"), lineComment(3, "@purity pure"), lineComment(4, "c")]);
  const { units, strays } = splitUnits(run, BUILT_IN_KINDS);
  assert.deepEqual(units.map((unit) => [unit.kind, unit.text]), [["Why", "Why: a b"], ["@purity", "@purity pure"]]);
  assert.deepEqual(strays.map((stray) => stray.line), [4]);
});

test("JSDoc tag lines are allowed and the description needs a kind", () => {
  const comment = { line: 1, column: 1, endLine: 4, style: "jsdoc", text: "*\n * Reads.\n * @param x the input\n ", isTrailing: false };
  const violations = judgeFile({ comments: [comment], functions: [] }, options());
  assert.deepEqual(violations.map((violation) => [violation.line, violation.column, violation.check]), [[2, 4, "kind"]]);
});

test("sentences are counted without dots in code, quotes, numbers and abbreviations", () => {
  assert.equal(countSentences("Summary: One."), 1);
  assert.equal(countSentences("Summary: No final dot"), 1);
  assert.equal(countSentences("Summary: Read config.json, e.g. `a.b`, and 1.5 \"x. y\" values. Then stop!"), 2);
  assert.equal(countSentences("Summary: One. Two? Three! Four."), 4);
});

test("spec IDs are found with the configured pattern", () => {
  assert.deepEqual([...extractSpecIds("FR-001, FR-002 and XFR-003", ID_PATTERN)], ["FR-001", "FR-002"]);
});

test("the judge works on records with no parser involved", () => {
  const comments = [
    lineComment(1, "Spec: FR-002"),
    lineComment(3, "Temporary: no condition"),
    lineComment(5, "@purity semi-pure"),
  ];
  const functions = [
    { line: 6, column: 1, name: "f", isSingleExpression: false, commentIndexes: [2] },
    { line: 9, column: 1, name: null, isSingleExpression: false, commentIndexes: [] },
    { line: 12, column: 5, name: null, isSingleExpression: true, commentIndexes: [] },
  ];
  const found = judgeFile({ comments, functions }, options()).map((violation) => [violation.line, violation.rule]);
  assert.deepEqual(found, [
    [1, "R3-comment-spec"],
    [3, "R3-comment-temporary"],
    [5, "R7-purity-tag"],
    [9, "R7-purity-tag"],
  ]);
});

test("a purity-exempt file still reports legacy values but no missing tags", () => {
  const comments = [lineComment(1, "@purity semi-pure-b")];
  const functions = [{ line: 5, column: 1, name: "g", isSingleExpression: false, commentIndexes: [] }];
  const found = judgeFile({ comments, functions }, options({ isPurityExemptFile: true }));
  assert.deepEqual(found.map((violation) => violation.line), [1]);
});

test("a single-expression lambda needs a tag when the exemption is off", () => {
  const functions = [{ line: 2, column: 3, name: null, isSingleExpression: true, commentIndexes: [] }];
  const found = judgeFile({ comments: [], functions }, options({ exemptSingleExpressionLambdas: false }));
  assert.equal(found.length, 1);
});

test("hashbang and license header comments are skipped when configured", () => {
  const comments = [
    { line: 1, column: 1, endLine: 1, style: "hashbang", text: "/usr/bin/env node", isTrailing: false },
    lineComment(2, "Copyright 2026 Someone \u00e9"),
    lineComment(3, "All rights reserved."),
  ];
  assert.deepEqual(judgeFile({ comments, functions: [] }, options({ licenseHeaderPattern: /Copyright/ })), []);
  assert.equal(judgeFile({ comments, functions: [] }, options({ allowShebang: false })).length, 3);
});

test("globs match ** across folders and * within one", () => {
  assert.ok(globToRegExp("test/**").test("test/unit/a.test.js"));
  assert.ok(matchesAny("skills/x/node_modules/y.js", ["**/node_modules/**"]));
  assert.ok(matchesAny("a.test.js", ["**/*.test.js"]));
  assert.ok(!matchesAny("skills/a.js", ["*.js"]));
});

test("a bad config is a ConfigError", () => {
  assert.throws(() => normalizeConfig([], "."), ConfigError);
  assert.throws(() => normalizeConfig({ spec: {} }, "."), ConfigError);
  assert.throws(() => normalizeConfig({ spec: { idPattern: "(" } }, "."), ConfigError);
  assert.throws(() => normalizeConfig({ spec: { idPattern: "x" }, extraKinds: [{ name: "a" }] }, "."), ConfigError);
  assert.throws(() => normalizeConfig({ spec: { idPattern: "x" }, paths: "skills" }, "."), ConfigError);
});

test("the baseline fails only counts that rose, per file and rule", () => {
  const before = [
    { file: "a.js", rule: "R7-purity-tag" },
    { file: "a.js", rule: "R7-purity-tag" },
    { file: "b.js", rule: "R3-comment-kind" },
  ];
  const baseline = baselineDocument(before);
  assert.deepEqual(baseline.files, { "a.js": { "R7-purity-tag": 2 }, "b.js": { "R3-comment-kind": 1 } });
  assert.deepEqual(compareToBaseline(before, baseline), { over: [], under: [] });
  const after = [{ file: "a.js", rule: "R7-purity-tag" }, { file: "b.js", rule: "R3-comment-kind" }, { file: "b.js", rule: "R3-comment-kind" }];
  const { over, under } = compareToBaseline(after, baseline);
  assert.deepEqual(over, [{ file: "b.js", rule: "R3-comment-kind", count: 2, allowed: 1 }]);
  assert.deepEqual(under, [{ file: "a.js", rule: "R7-purity-tag", count: 1, allowed: 2 }]);
  assert.equal(violationsOver(after, over).length, 2);
});
