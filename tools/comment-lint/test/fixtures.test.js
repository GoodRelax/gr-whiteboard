"use strict";

// Summary: Runs every fixture file through the adapter and the judge and compares with fixtures/expected.json.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeConfig } = require("../lib/config");
const { ParseError, parseSource } = require("../lib/acorn-adapter");
const { judgeFile } = require("../lib/judge");
const { extractSpecIds } = require("../lib/rules/spec");
const { matchesAny } = require("../lib/glob");
const { STANDARD } = require("../lib/standard");

const FIXTURES = path.join(__dirname, "..", "fixtures");
const expected = JSON.parse(fs.readFileSync(path.join(FIXTURES, "expected.json"), "utf8"));
const config = normalizeConfig(JSON.parse(fs.readFileSync(path.join(FIXTURES, expected.config), "utf8")), FIXTURES);
const specIds = new Set();
for (const file of config.specFiles) for (const id of extractSpecIds(fs.readFileSync(file, "utf8"), config.specIdPattern)) specIds.add(id);

function lintFixture(relative) {
  const input = parseSource(fs.readFileSync(path.join(FIXTURES, relative), "utf8"), path.extname(relative));
  return judgeFile(input, {
    kinds: config.kinds,
    allowShebang: config.allowShebang,
    licenseHeaderPattern: config.licenseHeaderPattern,
    specIds,
    specIdPattern: config.specIdPattern,
    isPurityExemptFile: matchesAny(relative, config.purityExclude),
    exemptSingleExpressionLambdas: config.exemptSingleExpressionLambdas,
  }).map((violation) => {
    const entry = { line: violation.line, column: violation.column, rule: violation.rule };
    if (violation.check !== undefined) entry.check = violation.check;
    return entry;
  });
}

test("expected.json names the standard this lint follows", () => {
  assert.deepEqual(expected.standard, { ...STANDARD });
});

test("expected.json lists every fixture file", () => {
  const onDisk = fs.readdirSync(FIXTURES, { recursive: true })
    .map((file) => file.split(path.sep).join("/"))
    .filter((file) => /\.[cm]?js$/.test(file))
    .sort();
  assert.deepEqual(onDisk, [...Object.keys(expected.files), ...expected.errors].sort());
});

for (const [relative, violations] of Object.entries(expected.files)) {
  test(`fixture ${relative}`, () => {
    assert.deepEqual(lintFixture(relative), violations);
  });
}

for (const relative of expected.errors) {
  test(`fixture ${relative} is a parse error`, () => {
    assert.throws(() => lintFixture(relative), ParseError);
  });
}

test("each rule has a passing and a failing fixture", () => {
  const rules = ["R3-comment-kind", "R3-comment-spec", "R3-comment-summary", "R3-comment-temporary", "R7-purity-tag"];
  for (const rule of rules) {
    const failing = Object.entries(expected.files).filter(([, list]) => list.some((entry) => entry.rule === rule));
    assert.ok(failing.length > 0, `no failing fixture for ${rule}`);
  }
  for (const check of ["kind", "english"]) {
    assert.ok(Object.values(expected.files).some((list) => list.some((entry) => entry.check === check)), `no failing fixture for ${check}`);
  }
  for (const folder of ["r3-kind", "r3-english", "r3-spec", "r3-summary", "r3-temporary", "r7-purity"]) {
    const names = Object.keys(expected.files).filter((file) => file.startsWith(`${folder}/`));
    assert.ok(names.some((file) => /\/pass-/.test(file) && expected.files[file].length === 0), `no passing fixture in ${folder}`);
    assert.ok(names.some((file) => /\/fail-/.test(file) && expected.files[file].length > 0), `no failing fixture in ${folder}`);
  }
});
