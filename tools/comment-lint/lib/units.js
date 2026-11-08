"use strict";

// Summary: Splits the comments of one file into runs and kind units, with no parser involved.
// A comment is { line, column, endLine, style, text, isTrailing }; style is line, block, jsdoc or hashbang.
// Temporary: The summary has two sentences. Until: The design of comment-lint is in a specification.

const BUILT_IN_KINDS = Object.freeze([
  Object.freeze({ name: "Why", pattern: /^Why:/, continues: true }),
  Object.freeze({ name: "Spec", pattern: /^Spec:/, continues: true }),
  Object.freeze({ name: "Summary", pattern: /^Summary:/, continues: true }),
  Object.freeze({ name: "Temporary", pattern: /^Temporary:/, continues: true }),
  Object.freeze({ name: "Section", pattern: /^Section:/, continues: false }),
  Object.freeze({ name: "Consistency", pattern: /^Consistency:/, continues: true }),
  Object.freeze({ name: "@purity", pattern: /^@purity(?:\s|$)/, continues: false }),
]);

const JSDOC_TAG_KIND = Object.freeze({ name: "jsdoc-tag", pattern: /^@[A-Za-z]/, continues: true });

// @purity pure
function stripLinePrefix(rawLine, style, lineIndex) {
  const leading = rawLine.match(/^\s*/)[0].length;
  let body = rawLine.slice(leading);
  let offset = leading;
  const hasStar = style === "jsdoc" || (style === "block" && lineIndex > 0);
  const star = hasStar ? body.match(/^\*\s*/) : null;
  if (star) {
    offset += star[0].length;
    body = body.slice(star[0].length);
  }
  return { body: body.replace(/\s+$/, ""), offset };
}

// @purity pure
function sourceColumn(comment, lineIndex, offsetInLine) {
  // Why: The text of a comment starts after its two-character opener, but its later lines start at column 1.
  return lineIndex === 0 ? comment.column + 2 + offsetInLine : 1 + offsetInLine;
}

// @purity pure
function commentLines(comment) {
  return comment.text.split(/\r?\n/).map((raw, index) => {
    // @purity pure
    const { body, offset } = stripLinePrefix(raw, comment.style, index);
    return { body, raw, line: comment.line + index, column: sourceColumn(comment, index, offset), lineIndex: index };
  });
}

// @purity pure
function groupRuns(comments) {
  const runs = [];
  let current = null;
  for (const comment of comments) {
    const joins = current !== null && comment.style === "line" && !comment.isTrailing
      && current.style === "line" && !current.lastTrailing && comment.line === current.lastLine + 1;
    if (joins) {
      current.comments.push(comment);
      current.lastLine = comment.line;
    } else {
      current = { style: comment.style, comments: [comment], lastLine: comment.endLine, lastTrailing: comment.isTrailing };
      runs.push(current);
    }
  }
  return runs.map((run) => ({ style: run.style, comments: run.comments }));
}

// @purity pure
function matchKind(body, kinds, style) {
  for (const kind of kinds) if (kind.pattern.test(body)) return kind;
  if (style === "jsdoc" && JSDOC_TAG_KIND.pattern.test(body)) return JSDOC_TAG_KIND;
  return null;
}

// @purity pure
function splitUnits(run, kinds) {
  const units = [];
  const strays = [];
  let current = null;
  for (const comment of run.comments) {
    for (const line of commentLines(comment)) {
      if (line.body === "") continue;
      const kind = matchKind(line.body, kinds, run.style);
      if (kind !== null) {
        current = { kind: kind.name, line: line.line, column: line.column, lines: [line], continues: kind.continues };
        units.push(current);
      } else if (current !== null && current.continues) {
        current.lines.push(line);
      } else {
        strays.push(line);
      }
    }
  }
  return {
    units: units.map((unit) => ({
      kind: unit.kind, line: unit.line, column: unit.column, lines: unit.lines,
      text: unit.lines.map((line) => line.body).join(" "),
    })),
    strays,
  };
}

module.exports = { BUILT_IN_KINDS, commentLines, groupRuns, splitUnits, stripLinePrefix };
