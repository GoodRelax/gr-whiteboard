"use strict";

// Summary: The review standard this lint follows, and the table of its rule IDs.
const TOOL_NAME = "comment-lint";
const TOOL_VERSION = "1.0.0";

const STANDARD = Object.freeze({
  repository: "GoodRelax/gr-sw-maker",
  commit: "51958f0",
  file: "process-rules/review-standards-ja.md",
  version: "2026-11-08T10:11:13+09:00",
});

// Why: The standard numbers no items, so each rule ID is the name of its checklist row.
// The output must be ASCII, so each rule has an ASCII alias; the README maps them back.
const RULES = Object.freeze({
  "R3-comment-kind": Object.freeze({ checklistRow: "R3 \u30b3\u30e1\u30f3\u30c8\uff08\u7a2e\u985e\uff09", severity: "MUST", line: 877 }),
  "R3-comment-spec": Object.freeze({ checklistRow: "R3 \u30b3\u30e1\u30f3\u30c8\uff08Spec\uff09", severity: "MUST", line: 879 }),
  "R3-comment-summary": Object.freeze({ checklistRow: "R3 \u30b3\u30e1\u30f3\u30c8\uff08Summary\uff09", severity: "SHOULD", line: 880 }),
  "R3-comment-temporary": Object.freeze({ checklistRow: "R3 \u30b3\u30e1\u30f3\u30c8\uff08Temporary\uff09", severity: "MUST", line: 881 }),
  "R7-purity-tag": Object.freeze({ checklistRow: "R7 @purity \u30bf\u30b0", severity: "MUST", line: 906 }),
});

const RULE_IDS = Object.freeze(Object.keys(RULES));

// @purity pure
function headerLine() {
  return `${TOOL_NAME} ${TOOL_VERSION} standard ${STANDARD.repository}@${STANDARD.commit} ${STANDARD.file} version ${STANDARD.version}`;
}

module.exports = { TOOL_NAME, TOOL_VERSION, STANDARD, RULES, RULE_IDS, headerLine };
