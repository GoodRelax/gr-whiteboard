"use strict";

// Summary: Tests the command line: output lines, JSON, exit codes and the baseline ratchet.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { main } = require("../cli");
const { headerLine } = require("../lib/standard");

const FIXTURES = path.join(__dirname, "..", "fixtures");
const FIXTURE_CONFIG = path.join(FIXTURES, "comment-lint.config.json");

function run(args, cwd = FIXTURES) {
  let stdout = "";
  let stderr = "";
  const code = main(args, cwd, { write: (text) => { stdout += text; } }, { write: (text) => { stderr += text; } });
  return { code, stdout, stderr };
}

test("a passing file exits 0 with the header and the total line", () => {
  const { code, stdout } = run(["--config", FIXTURE_CONFIG, "r3-kind/pass-kinds.js"]);
  assert.equal(code, 0);
  const lines = stdout.trim().split("\n");
  assert.equal(lines[0], headerLine());
  assert.match(lines[0], /51958f0/);
  assert.match(lines[0], /2026-11-08T10:11:13\+09:00/);
  assert.match(lines[1], /^0 violations in 0 of 1 files/);
});

test("a failing file exits 1 with one path:line:col line per violation", () => {
  const { code, stdout } = run(["--config", FIXTURE_CONFIG, "r3-summary"]);
  assert.equal(code, 1);
  const lines = stdout.trim().split("\n");
  assert.deepEqual(lines.slice(1, 4).map((line) => line.split(" ").slice(0, 2).join(" ")), [
    "r3-summary/fail-summary.js:3:4: R3-comment-summary",
    "r3-summary/fail-summary.js:9:4: R3-comment-summary",
    "r3-summary/fail-summary.js:16:4: R3-comment-summary",
  ]);
  assert.match(lines[4], /^3 violations in 1 of 2 files/);
  assert.ok(/^[\x20-\x7e\n]*$/.test(stdout), "the output is ASCII");
});

test("--json carries the same violations", () => {
  const text = run(["--config", FIXTURE_CONFIG, "r3-summary"]);
  const json = run(["--config", FIXTURE_CONFIG, "--json", "r3-summary"]);
  assert.equal(json.code, 1);
  const report = JSON.parse(json.stdout);
  assert.equal(report.standard.commit, "51958f0");
  assert.equal(report.totals.violations, 3);
  assert.deepEqual(report.violations.map((violation) => `${violation.file}:${violation.line}:${violation.column}: ${violation.rule} ${violation.message}`),
    text.stdout.trim().split("\n").slice(1, -1));
  assert.equal(report.violations[0].severity, "SHOULD");
});

test("a file that does not parse exits 2", () => {
  const { code, stdout } = run(["--config", FIXTURE_CONFIG, "parsing"]);
  assert.equal(code, 2);
  assert.match(stdout, /parsing\/error-syntax\.js:2:7: error cannot parse/);
});

test("an unknown option, a missing path and a bad config exit 2", () => {
  assert.equal(run(["--config", FIXTURE_CONFIG, "--nope"]).code, 2);
  assert.equal(run(["--config", FIXTURE_CONFIG, "no-such-folder"]).code, 2);
  assert.equal(run(["--config", path.join(FIXTURES, "spec.md")]).code, 2);
});

test("the baseline ratchet fails only when a count rises", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comment-lint-"));
  try {
    fs.writeFileSync(path.join(dir, "spec.md"), "FR-001\n");
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({
      root: ".", paths: ["src"], spec: { files: ["spec.md"], idPattern: "\\bFR-\\d{3}\\b" }, baseline: "baseline.json",
    }));
    fs.mkdirSync(path.join(dir, "src"));
    const file = path.join(dir, "src", "a.js");
    fs.writeFileSync(file, "function a() {\n  return 1;\n}\n");
    const config = path.join(dir, "config.json");
    assert.equal(run(["--config", config, "--update-baseline"], dir).code, 0);
    const baseline = JSON.parse(fs.readFileSync(path.join(dir, "baseline.json"), "utf8"));
    assert.deepEqual(baseline.files, { "src/a.js": { "R7-purity-tag": 1 } });
    assert.equal(run(["--config", config], dir).code, 0);
    fs.writeFileSync(file, "function a() {\n  return 1;\n}\nfunction b() {\n  return 2;\n}\n");
    const rose = run(["--config", config], dir);
    assert.equal(rose.code, 1);
    assert.match(rose.stdout, /2 violations over the baseline in 1 file\/rule pairs/);
    assert.equal(run(["--config", config, "--no-baseline"], dir).code, 1);
    fs.writeFileSync(file, "// @purity pure\nfunction a() {\n  return 1;\n}\n");
    const fell = run(["--config", config], dir);
    assert.equal(fell.code, 0);
    assert.match(fell.stdout, /below the baseline/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
