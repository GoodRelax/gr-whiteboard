"use strict";

// Summary: Rule R3-comment-kind (english): a comment holds only printable ASCII, the approximation of English.

const { commentLines } = require("../units");

const RULE_ID = "R3-comment-kind";
const NON_ASCII = /[^\t\x20-\x7e]/u;

// @purity pure
function hexCodePoint(char) {
  return `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
}

// @purity pure
function judgeEnglish(comments) {
  const violations = [];
  for (const comment of comments) {
    for (const line of commentLines(comment)) {
      const match = NON_ASCII.exec(line.raw);
      if (match === null) continue;
      const column = line.lineIndex === 0 ? comment.column + 2 + match.index : 1 + match.index;
      violations.push({
        rule: RULE_ID,
        check: "english",
        line: line.line,
        column,
        message: `comment is not in English: non-ASCII character ${hexCodePoint(match[0])}`,
      });
      break;
    }
  }
  return violations;
}

module.exports = { RULE_ID, judgeEnglish };
