"use strict";

// MermaidPick (Entity). Finds the Mermaid blocks and the tables of a Markdown text, takes out the style
// statements that the Board Server refuses, and replaces the not-equal sign. Pure. See spec 4.12.3.

const NOT_EQUAL = String.fromCharCode(0x2260);
const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
// Statements that FR-093a refuses for styles, links, and classes.
const STYLE_WORDS = /^(classDef|class|cssClass|style|linkStyle|click)\b/i;
const DIRECTIVE = /%%\{[\s\S]*?\}%%/g;
const CLASS_SHORTHAND = /:::[A-Za-z0-9_-]+/g;
const MAX_LISTED_BLOCKS = 10;

// Replaces each not-equal sign (U+2260) with "!=" (FR-133). Returns { text, replaced }.
// @purity pure
function replaceNotEqual(text) {
  const parts = String(text).split(NOT_EQUAL);
  return { text: parts.join("!="), replaced: parts.length - 1 };
}

// The headings and the fenced blocks of a Markdown text, in order.
// Each block: { info, body, heading, headingLevel, index (from 1 among blocks with the same info) }.
// @purity pure
function scanMarkdown(markdown) {
  const lines = String(markdown).replace(/\r\n?/g, "\n").split("\n");
  const headings = [];
  const blocks = [];
  let heading = "";
  let headingLevel = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const fence = FENCE.exec(lines[i]);
    if (fence) {
      const mark = fence[1];
      const body = [];
      let j = i + 1;
      while (j < lines.length && !new RegExp(`^ {0,3}${mark[0]}{${mark.length},}\\s*$`).test(lines[j])) {
        body.push(lines[j]);
        j += 1;
      }
      blocks.push({ info: fence[2].toLowerCase(), body: body.join("\n"), heading, headingLevel, line: i + 1, headingOrder: headings.length });
      i = j;
      continue;
    }
    const found = HEADING.exec(lines[i]);
    if (found) {
      heading = found[2];
      headingLevel = found[1].length;
      headings.push({ text: heading, level: headingLevel, line: i + 1 });
    }
  }
  return { lines, headings, blocks };
}

// The Mermaid blocks of a Markdown text: [{ number, heading, source }] (number from 1).
// @purity pure
function mermaidBlocks(markdown) {
  return scanMarkdown(markdown).blocks
    .filter((block) => block.info === "mermaid")
    .map((block, i) => ({ number: i + 1, heading: block.heading, source: block.body, line: block.line, headingOrder: block.headingOrder }));
}

// A short list of the Mermaid blocks, for an error message (FR-139).
// @purity pure
function listBlocks(blocks) {
  const shown = blocks.slice(0, MAX_LISTED_BLOCKS).map((b) => `${b.number}:${JSON.stringify(b.heading.slice(0, 40))}`);
  const more = blocks.length > MAX_LISTED_BLOCKS ? ` +${blocks.length - MAX_LISTED_BLOCKS}` : "";
  return `blocks=${blocks.length}${shown.length > 0 ? ` ${shown.join(" ")}` : ""}${more}`;
}

// Picks one Mermaid block by number or by heading (FR-137, FR-139).
// Returns { source, number, heading } or { error }.
// @purity pure
function pickMermaid(markdown, { block, heading }) {
  const scanned = scanMarkdown(markdown);
  const blocks = mermaidBlocks(markdown);
  if (block !== undefined) {
    const found = blocks[block - 1];
    if (!found) return { error: `the file has no mermaid block ${block}; ${listBlocks(blocks)}` };
    return { source: found.source, number: found.number, heading: found.heading };
  }
  const wanted = String(heading).toLowerCase();
  const index = scanned.headings.findIndex((h) => h.text.toLowerCase().includes(wanted));
  if (index >= 0) {
    const start = scanned.headings[index];
    const end = scanned.headings.slice(index + 1).find((h) => h.level <= start.level);
    const found = blocks.find((b) => b.line > start.line && (!end || b.line < end.line));
    if (found) return { source: found.source, number: found.number, heading: found.heading };
  }
  return { error: `no mermaid block under a heading with ${JSON.stringify(heading)}; ${listBlocks(blocks)}` };
}

// Takes out the style statements that FR-093a refuses (FR-138): classDef, class, cssClass, style, linkStyle,
// and click statements, %%{...}%% directives, and ":::name" after a node. A class diagram block
// "class Animal { +name }" becomes the member lines "Animal : +name", which the Board Server takes.
// Returns { source, stripped, dropped }. stripped: the number of statements taken out or rewritten.
// dropped: classes of a class diagram that are gone from the drawing, because their only statement was a
// declaration ("class Foo", or "class Foo {}" with no members) that FR-093a refuses.
// @purity pure
function stripStyles(source) {
  let stripped = 0;
  const declared = [];
  const isClassDiagram = /^\s*(%%[^\n]*\n\s*)*classDiagram\b/.test(String(source));
  let text = String(source).replace(/\r\n?/g, "\n").replace(DIRECTIVE, () => {
    stripped += 1;
    return "";
  });
  text = text.replace(CLASS_SHORTHAND, () => {
    stripped += 1;
    return "";
  });
  const out = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const block = /^(\s*)class\s+([A-Za-z0-9_~<>,-]+)\s*\{(.*)$/.exec(line);
    if (block) {
      // "class Name {" ... "}" -> "Name : member" for each member.
      const [, indent, name, rest] = block;
      const members = [];
      let tail = rest;
      while (!tail.includes("}") && i + 1 < lines.length) {
        if (tail.trim() !== "") members.push(tail.trim());
        i += 1;
        tail = lines[i];
      }
      const inside = tail.split("}")[0].trim();
      if (inside !== "") members.push(inside);
      for (const member of members) out.push(`${indent}${name.split("~")[0]} : ${member}`);
      if (members.length === 0) declared.push(name.split("~")[0]);
      stripped += 1;
      continue;
    }
    const statements = line.split(";");
    const kept = statements.filter((statement) => {
      if (STYLE_WORDS.test(statement.trim())) {
        stripped += 1;
        const declaration = /^class\s+([A-Za-z0-9_-]+)(~[^~]*~)?\s*$/.exec(statement.trim());
        if (isClassDiagram && declaration) declared.push(declaration[1]);
        return false;
      }
      return true;
    });
    // A line that had only style statements goes away.
    if (kept.length < statements.length && kept.every((s) => s.trim() === "")) continue;
    out.push(kept.join(";"));
  }
  const result = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  // A declared class that no other statement names is gone from the drawing.
  const body = result.replace(/^\s*classDiagram\b/, "");
  const dropped = new Set(declared.filter((name) => !new RegExp(`(^|[^A-Za-z0-9_-])${name}([^A-Za-z0-9_-]|$)`).test(body))).size;
  return { source: result, stripped, dropped };
}

// Splits one Markdown table row into cells: "| a | b \| c |" -> ["a", "b | c"].
// @purity pure
function splitRow(line) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let current = "";
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed[i] === "\\" && trimmed[i + 1] === "|") {
      current += "|";
      i += 1;
    } else if (trimmed[i] === "|") {
      cells.push(current);
      current = "";
    } else {
      current += trimmed[i];
    }
  }
  cells.push(current);
  return cells.map((c) => c.trim().replace(/`/g, "").replace(/\*\*/g, "").replace(/<br\s*\/?>/gi, "\n"));
}

// The Markdown tables of a text: [{ number, heading, rows }]. A table is a header row, a separator row
// ("|---|:--:|"), and the rows after it, outside fenced blocks.
// @purity pure
function markdownTables(markdown) {
  const { lines, blocks } = scanMarkdown(markdown);
  const inFence = new Set();
  for (const block of blocks) {
    const count = block.body === "" ? 0 : block.body.split("\n").length;
    for (let k = block.line - 1; k <= block.line + count; k += 1) inFence.add(k);
  }
  const tables = [];
  let heading = "";
  for (let i = 0; i < lines.length; i += 1) {
    if (inFence.has(i)) continue;
    const found = HEADING.exec(lines[i]);
    if (found) heading = found[2];
    const isRow = (k) => k < lines.length && !inFence.has(k) && /^\s*\|.*\|\s*$/.test(lines[k]);
    const isSeparator = (k) => isRow(k) && /^\s*\|(\s*:?-+:?\s*\|)+\s*$/.test(lines[k]);
    if (isRow(i) && isSeparator(i + 1)) {
      const rows = [splitRow(lines[i])];
      let k = i + 2;
      while (isRow(k)) {
        rows.push(splitRow(lines[k]));
        k += 1;
      }
      tables.push({ number: tables.length + 1, heading, rows });
      i = k - 1;
    }
  }
  return tables;
}

module.exports = {
  NOT_EQUAL, replaceNotEqual, scanMarkdown, mermaidBlocks, pickMermaid, stripStyles, markdownTables, listBlocks,
};
