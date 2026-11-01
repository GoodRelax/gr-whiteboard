"use strict";

// TableBuilder (Entity). Makes the Skeletons of a table from rows of cell texts. Pure. See spec 4.12.2.
// The MCP Server cannot measure text (only the Leader page can, ADR-003), so it estimates a little wide.

const FONT_SIZE_PX = 20;
const NARROW_EM = 0.6;
const WIDE_EM = 1.0;
const LINE_PX = 25;
const PAD_PX = 20;
const MAX_COL_PX = 400;
const MIN_COL_PX = 60;
const TITLE_GAP_PX = 12;
// Colors by name only (closed list): the line and text color, and the light tone of the header row.
const COLORS = Object.freeze({
  blue: { stroke: "#1971c2", light: "#d0ebff" },
  red: { stroke: "#e03131", light: "#ffc9c9" },
  green: { stroke: "#2f9e44", light: "#b2f2bb" },
  orange: { stroke: "#f08c00", light: "#ffec99" },
  gray: { stroke: "#868e96", light: "#e9ecef" },
  black: { stroke: "#1e1e1e", light: "#e9ecef" },
});

// @purity pure
function lineWidthPx(line) {
  let em = 0;
  for (const char of line) em += char.codePointAt(0) < 128 ? NARROW_EM : WIDE_EM;
  return em * FONT_SIZE_PX;
}

// The estimated size of a cell text with its padding.
// @purity pure
function cellSize(text) {
  const lines = String(text).split("\n");
  return {
    width: Math.ceil(Math.max(...lines.map(lineWidthPx)) + 2 * PAD_PX),
    height: Math.ceil(lines.length * LINE_PX + 2 * PAD_PX),
  };
}

// rows: list of lists of strings. options: { header (default true), title, colWidths, color (name), prefix }.
// Returns { skeletons, ids, prefix }. Cell IDs are `<prefix>-r<row>c<col>` (from 1).
// @purity pure
function buildTable(rows, options = {}) {
  const prefix = options.prefix;
  const header = options.header !== false;
  const color = COLORS[options.color || "blue"];
  const cols = Math.max(...rows.map((row) => row.length));
  const grid = rows.map((row) => Array.from({ length: cols }, (_, c) => (row[c] === undefined ? "" : String(row[c]))));
  const widths = Array.from({ length: cols }, (_, c) => {
    const given = Array.isArray(options.colWidths) ? options.colWidths[c] : undefined;
    if (Number.isFinite(given) && given > 0) return Math.round(given);
    const widest = Math.max(...grid.map((row) => cellSize(row[c]).width));
    return Math.min(MAX_COL_PX, Math.max(MIN_COL_PX, widest));
  });
  const heights = grid.map((row) => Math.max(...row.map((text) => cellSize(text).height)));
  const skeletons = [];
  let top = 0;
  if (options.title) {
    skeletons.push({ id: `${prefix}-title`, type: "text", x: 0, y: 0, text: options.title, fontSize: 24, strokeColor: color.stroke });
    top = 30 + TITLE_GAP_PX;
  }
  let y = top;
  grid.forEach((row, r) => {
    let x = 0;
    row.forEach((text, c) => {
      const skeleton = {
        id: `${prefix}-r${r + 1}c${c + 1}`, type: "rectangle", x, y, width: widths[c], height: heights[r],
        strokeColor: color.stroke, roughness: 0,
      };
      if (header && r === 0) Object.assign(skeleton, { backgroundColor: color.light, fillStyle: "solid" });
      if (text.trim() !== "") skeleton.label = { text, textAlign: "left", strokeColor: color.stroke };
      skeletons.push(skeleton);
      x += widths[c];
    });
    y += heights[r];
  });
  return { skeletons, ids: skeletons.map((s) => s.id), prefix, width: widths.reduce((a, b) => a + b, 0), height: y };
}

module.exports = { COLORS, buildTable, cellSize };
