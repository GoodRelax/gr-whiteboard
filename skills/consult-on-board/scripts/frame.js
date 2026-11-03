#!/usr/bin/env node
"use strict";

// FrameBuilder. Makes the Skeletons of a framework template drawn with lines, not boxes. Pure.
// The output goes to the draw_skeletons tool as is. Usage:
//   node frame.js spec.json        (or the spec JSON on stdin)
// Spec: { shape, prefix, title, guide, examples, color, ... } (see BUILDERS), or a list of specs with at: { x, y }.
// Room matters more than fit: the frames leave wide space for the person to write in.
// guide: one or two gray lines under the title that say what the frame is for.
// examples: gray sample texts, one per writable slot of the shape (in the slot order of each builder);
// an empty string leaves that slot blank. They show how to write and are deleted once the person writes.

// Excalidraw sizes: M (body, the default font of a person's text), L (labels, headers), XL (titles).
const FONT_SIZE_PX = 20;
const LABEL_SIZE_PX = 28;
const TITLE_SIZE_PX = 36;
const NARROW_EM = 0.6;
const WIDE_EM = 1.0;
const LINE_EM = 1.25;
const LINE_PX = Math.round(LABEL_SIZE_PX * LINE_EM);
const PAD_PX = 24;
const MIN_ROW_PX = 120;
const COLORS = Object.freeze({
  blue: "#1971c2",
  red: "#e03131",
  green: "#2f9e44",
  orange: "#f08c00",
  gray: "#868e96",
  black: "#1e1e1e",
});
// Guide and example texts are gray, so they read as help, not as content.
const HELP_COLOR = COLORS.gray;
// Venn: center distance as a share of the radius. Simulated so that the middle (all sets) is about as large
// as one set alone; circles cannot make the pair areas larger than about 9 % of the whole.
const VENN3_GAP = 0.85;
const VENN2_GAP = 0.8;
// Centroids of the seven areas of the three-set Venn at VENN3_GAP, in radii from the middle of the three centers
// (simulated): set 1, 2, 3 alone, pairs 1-2, 1-3, 2-3, then all. Examples are centered there, away from the lines.
const VENN3_SPOTS = Object.freeze([
  [-0.9, -0.52], [0.9, -0.52], [0, 1.03], [0, -0.72], [-0.62, 0.36], [0.62, 0.36], [0, 0],
]);

// @purity pure
function textWidthPx(text, size = LABEL_SIZE_PX) {
  let widest = 0;
  for (const line of String(text).split("\n")) {
    let em = 0;
    for (const char of line) em += char.codePointAt(0) < 128 ? NARROW_EM : WIDE_EM;
    widest = Math.max(widest, em * size);
  }
  return Math.ceil(widest);
}

// @purity pure
function textHeightPx(text, size = LABEL_SIZE_PX) {
  return Math.ceil(String(text).split("\n").length * size * LINE_EM);
}

// @purity pure
function line(id, x1, y1, x2, y2, stroke, width = 2) {
  return { id, type: "line", x: x1, y: y1, points: [[0, 0], [x2 - x1, y2 - y1]], strokeColor: stroke, strokeWidth: width, roughness: 0 };
}

// An axis: a line with an arrowhead at both ends, so the plus sign reads as coordinates.
// @purity pure
function axis(id, x1, y1, x2, y2, stroke) {
  return {
    id, type: "arrow", x: x1, y: y1, width: x2 - x1, height: y2 - y1, points: [[0, 0], [x2 - x1, y2 - y1]],
    startArrowhead: "arrow", endArrowhead: "arrow", strokeColor: stroke, strokeWidth: 2, roughness: 0,
  };
}

// Frame texts are labels, so L by default.
// @purity pure
function text(id, x, y, value, stroke, size = LABEL_SIZE_PX) {
  return { id, type: "text", x, y, text: value, fontSize: size, strokeColor: stroke };
}

// Title on top, then the gray guide; returns the y where the body starts.
// @purity pure
function pushTitle(out, spec, stroke) {
  let y = 0;
  if (spec.title) {
    out.push(text(`${spec.prefix}-title`, 0, 0, spec.title, stroke, TITLE_SIZE_PX));
    y = textHeightPx(spec.title, TITLE_SIZE_PX) + PAD_PX / 2;
  }
  if (spec.guide) {
    out.push(text(`${spec.prefix}-guide`, 0, y, spec.guide, HELP_COLOR, FONT_SIZE_PX));
    y += textHeightPx(spec.guide, FONT_SIZE_PX);
  }
  return y ? y + 2 * PAD_PX : 0;
}

// A 2-axis template drawn as a plus sign of two double-headed arrows. spec: { width, height,
// axes: { left, right, top, bottom }, quadrants: [topLeft, topRight, bottomLeft, bottomRight] }.
// The quadrant labels sit in the outer corners, mirrored, so no quadrant looks first.
// The quadrants stay empty for the person. Slots: the four quadrants, in the order of quadrants.
// @purity pure
function buildCross(spec, slots = []) {
  const stroke = COLORS[spec.color || "blue"];
  const p = spec.prefix;
  const width = spec.width || 1200;
  const height = spec.height || 900;
  const axes = spec.axes || {};
  const quads = spec.quadrants || [];
  const out = [];
  const top = pushTitle(out, spec, stroke);
  // Room for the axis labels around the plus sign.
  const leftPad = axes.left ? textWidthPx(axes.left) + PAD_PX : 0;
  const topPad = axes.top ? LINE_PX + PAD_PX : 0;
  const x0 = leftPad;
  const y0 = top + topPad;
  const cx = x0 + width / 2;
  const cy = y0 + height / 2;
  out.push(axis(`${p}-h`, x0, cy, x0 + width, cy, stroke));
  out.push(axis(`${p}-v`, cx, y0, cx, y0 + height, stroke));
  if (axes.left) out.push(text(`${p}-axL`, 0, cy - LINE_PX / 2, axes.left, stroke));
  if (axes.right) out.push(text(`${p}-axR`, x0 + width + PAD_PX, cy - LINE_PX / 2, axes.right, stroke));
  if (axes.top) out.push(text(`${p}-axT`, cx - textWidthPx(axes.top) / 2, top, axes.top, stroke));
  if (axes.bottom) out.push(text(`${p}-axB`, cx - textWidthPx(axes.bottom) / 2, y0 + height + PAD_PX, axes.bottom, stroke));
  quads.forEach((label, i) => {
    if (!label || i > 3) return;
    const right = i % 2 === 1;
    const bottom = i >= 2;
    const qx = right ? x0 + width - PAD_PX - textWidthPx(label) : x0 + PAD_PX;
    const qy = bottom ? y0 + height - PAD_PX - textHeightPx(label) : y0 + PAD_PX;
    out.push(text(`${p}-q${i + 1}`, qx, qy, label, stroke));
  });
  // The example of a quadrant sits near the axes, away from its corner label.
  [[x0, y0], [cx, y0], [x0, cy], [cx, cy]].forEach(([qx, qy], i) => {
    slots.push({ x: qx + 2 * PAD_PX, y: i < 2 ? qy + LINE_PX + 3 * PAD_PX : qy + 2 * PAD_PX });
  });
  return out;
}

// A table drawn with lines. spec: { rows: [[cell, ...], ...], colWidths, rowHeights, header (default true),
// rowHeader (default true), frame (default false) }. Without a frame only the inner lines are drawn, so the
// table feels open. Header cells are L, the other cells M. An empty cell text leaves room to write.
// Cell text ids are PREFIX-rRcC (from 1). Slots: the empty body cells, row by row.
// @purity pure
function buildGrid(spec, slots = []) {
  const stroke = COLORS[spec.color || "blue"];
  const p = spec.prefix;
  const rows = spec.rows || [[""]];
  const cols = Math.max(...rows.map((row) => row.length));
  const header = spec.header !== false;
  const rowHeader = spec.rowHeader !== false;
  const sizeOf = (r, c) => ((header && r === 0) || (rowHeader && c === 0) ? LABEL_SIZE_PX : FONT_SIZE_PX);
  const widths = Array.from({ length: cols }, (_, c) => {
    const given = Array.isArray(spec.colWidths) ? spec.colWidths[c] : undefined;
    if (Number.isFinite(given) && given > 0) return Math.round(given);
    return Math.max(240, ...rows.map((row, r) => textWidthPx(row[c] || "", sizeOf(r, c)) + 2 * PAD_PX));
  });
  const heights = rows.map((row, r) => {
    const given = Array.isArray(spec.rowHeights) ? spec.rowHeights[r] : undefined;
    if (Number.isFinite(given) && given > 0) return Math.round(given);
    const least = header && r === 0 ? LINE_PX + 2 * PAD_PX : MIN_ROW_PX;
    return Math.max(least, ...row.map((cell, c) => textHeightPx(cell || "", sizeOf(r, c)) + 2 * PAD_PX));
  });
  const out = [];
  const top = pushTitle(out, spec, stroke);
  const totalW = widths.reduce((a, b) => a + b, 0);
  const totalH = heights.reduce((a, b) => a + b, 0);
  const frame = spec.frame === true;
  // Horizontal lines: the outer ones and the line under the header are thicker.
  let y = top;
  for (let r = 0; r <= rows.length; r += 1) {
    const outer = r === 0 || r === rows.length;
    if (frame || !outer) out.push(line(`${p}-h${r}`, 0, y, totalW, y, stroke, outer || (header && r === 1) ? 4 : 2));
    if (r < rows.length) y += heights[r];
  }
  let x = 0;
  for (let c = 0; c <= cols; c += 1) {
    const outer = c === 0 || c === cols;
    if (frame || !outer) out.push(line(`${p}-v${c}`, x, top, x, top + totalH, stroke, outer ? 4 : 2));
    if (c < cols) x += widths[c];
  }
  y = top;
  rows.forEach((row, r) => {
    x = 0;
    for (let c = 0; c < cols; c += 1) {
      const cell = row[c] || "";
      if (cell.trim() !== "") out.push(text(`${p}-r${r + 1}c${c + 1}`, x + PAD_PX, y + PAD_PX, cell, stroke, sizeOf(r, c)));
      else if (!(header && r === 0) && !(rowHeader && c === 0)) slots.push({ x: x + PAD_PX, y: y + PAD_PX });
      x += widths[c];
    }
    y += heights[r];
  });
  return out;
}

// A line through several points (absolute), optionally curved.
// @purity pure
function poly(id, pts, stroke, extra = {}) {
  const [x0, y0] = pts[0];
  return {
    id, type: "line", x: Math.round(x0), y: Math.round(y0), points: pts.map(([x, y]) => [Math.round(x - x0), Math.round(y - y0)]),
    strokeColor: stroke, strokeWidth: 2, roughness: 0, ...extra,
  };
}

// An arrow through several points (absolute). heads: "end" (default) or "both".
// The board refuses roundness, so a bent arrow is drawn as a polyline.
// @purity pure
function arrowPts(id, pts, stroke, heads = "end") {
  const a = poly(id, pts, stroke, { type: "arrow", endArrowhead: "arrow", startArrowhead: heads === "both" ? "arrow" : null });
  const last = a.points[a.points.length - 1];
  // The board refuses a negative width or height.
  Object.assign(a, { width: Math.abs(last[0]), height: Math.abs(last[1]) });
  return a;
}

// A text centered on (x, y).
// @purity pure
function centered(id, x, y, value, stroke, size = LABEL_SIZE_PX) {
  return text(id, Math.round(x - textWidthPx(value, size) / 2), Math.round(y - textHeightPx(value, size) / 2), value, stroke, size);
}

// Columns side by side to compare (As-Is / To-Be, KPT). spec: { columns, height, colWidth }. Slots: the columns.
// @purity pure
function buildContrast(spec, slots = []) {
  const cols = spec.columns || ["", ""];
  return buildGrid({
    ...spec, header: true, rowHeader: false, rows: [cols, cols.map(() => "")],
    colWidths: cols.map(() => spec.colWidth || 480), rowHeights: [LINE_PX + 2 * PAD_PX, spec.height || 600],
  }, slots);
}

// A checklist of items, each with a line to write on. spec: { items, width }. Slots: right of each item.
// @purity pure
function buildList(spec, slots = []) {
  const stroke = COLORS[spec.color || "blue"];
  const p = spec.prefix;
  const items = spec.items || [];
  const width = spec.width || 1000;
  const sx = Math.max(0, ...items.map((item) => textWidthPx(item))) + 2 * PAD_PX;
  const out = [];
  let y = pushTitle(out, spec, stroke);
  items.forEach((item, i) => {
    out.push(text(`${p}-i${i + 1}`, 0, y + PAD_PX, item, stroke));
    slots.push({ x: sx, y: y + PAD_PX + 4 });
    y += Math.max(MIN_ROW_PX, textHeightPx(item) + 2 * PAD_PX);
    out.push(line(`${p}-l${i + 1}`, 0, y, Math.max(width, sx + 400), y, stroke));
  });
  return out;
}

// Steps from left to right: one arrow, the step names above it, thin dividers below. spec: { steps, stepWidth, height }.
// Slots: under each step.
// @purity pure
function buildFlow(spec, slots = []) {
  const stroke = COLORS[spec.color || "blue"];
  const p = spec.prefix;
  const steps = spec.steps || [];
  const w = spec.stepWidth || 300;
  const h = spec.height || 500;
  const out = [];
  const top = pushTitle(out, spec, stroke);
  const ay = top + 2 * LINE_PX + PAD_PX;
  steps.forEach((step, i) => {
    out.push(centered(`${p}-s${i + 1}`, i * w + w / 2, top + LINE_PX, step, stroke));
    slots.push({ x: i * w + PAD_PX, y: ay + 2 * PAD_PX });
  });
  out.push(arrowPts(`${p}-a`, [[0, ay], [steps.length * w, ay]], stroke));
  for (let i = 1; i < steps.length; i += 1) out.push(line(`${p}-d${i}`, i * w, ay + PAD_PX, i * w, ay + h, stroke, 1));
  return out;
}

// A funnel: bands that narrow from top to bottom. spec: { stages, width, bandHeight }. Slots: right of each band.
// @purity pure
function buildFunnel(spec, slots = []) {
  const stroke = COLORS[spec.color || "blue"];
  const p = spec.prefix;
  const stages = spec.stages || [];
  const w = spec.width || 900;
  const bh = spec.bandHeight || 110;
  const out = [];
  const top = pushTitle(out, spec, stroke);
  const h = stages.length * bh;
  const inset = (y) => (w * 0.35 * (y - top)) / h;
  out.push(poly(`${p}-L`, [[0, top], [w * 0.35, top + h]], stroke));
  out.push(poly(`${p}-R`, [[w, top], [w * 0.65, top + h]], stroke));
  stages.forEach((stage, i) => {
    const y = top + (i + 1) * bh;
    out.push(line(`${p}-b${i + 1}`, inset(y), y, w - inset(y), y, stroke));
    out.push(centered(`${p}-s${i + 1}`, w / 2, y - bh / 2, stage, stroke));
    slots.push({ x: w + 2 * PAD_PX, y: y - bh / 2 - FONT_SIZE_PX / 2 });
  });
  out.unshift(line(`${p}-b0`, 0, top, w, top, stroke));
  return out;
}

// A tree from left to right with elbow lines. spec: { root, children: [{ label, children }] }.
// Slots: the nodes with an empty label, in drawing order (leaves first, depth first).
// @purity pure
function buildTree(spec, slots = []) {
  const stroke = COLORS[spec.color || "blue"];
  const p = spec.prefix;
  const dx = spec.levelWidth || 380;
  const dy = spec.leafHeight || 120;
  const out = [];
  const top = pushTitle(out, spec, stroke);
  let leaf = 0;
  let n = 0;
  // Returns the y of the node; places the children first.
  const place = (node, depth) => {
    const kids = node.children || [];
    const ys = kids.map((kid) => place(kid, depth + 1));
    const y = ys.length ? (ys[0] + ys[ys.length - 1]) / 2 : top + dy / 2 + dy * leaf++;
    const x = depth * dx;
    n += 1;
    // An empty label leaves the place blank for the person to write.
    if (node.label) out.push(text(`${p}-n${n}`, x, y - LINE_PX / 2, node.label, stroke));
    else slots.push({ x, y: y - FONT_SIZE_PX / 2 });
    if (ys.length) {
      const jx = x + Math.min((node.label ? textWidthPx(node.label) : 120) + PAD_PX, dx - 40);
      const mx = (depth + 1) * dx - 30;
      out.push(line(`${p}-e${n}`, jx, y, mx, y, stroke));
      if (ys.length > 1) out.push(line(`${p}-k${n}`, mx, ys[0], mx, ys[ys.length - 1], stroke));
      ys.forEach((ky, i) => out.push(line(`${p}-c${n}_${i + 1}`, mx, ky, mx + 20, ky, stroke)));
    }
    return y;
  };
  place({ label: spec.root || "", children: spec.children || [] }, 0);
  return out;
}

// A fishbone: a spine arrow to the effect, bones slanting into the spine. spec: { effect, causes, width, height }.
// Slots: beside each bone.
// @purity pure
function buildFishbone(spec, slots = []) {
  const stroke = COLORS[spec.color || "blue"];
  const p = spec.prefix;
  const causes = spec.causes || [];
  const w = spec.width || 1300;
  const h = spec.height || 620;
  const out = [];
  const top = pushTitle(out, spec, stroke);
  const sy = top + h / 2;
  out.push(arrowPts(`${p}-spine`, [[0, sy], [w, sy]], stroke));
  out.push(text(`${p}-effect`, w + PAD_PX, sy - LINE_PX / 2, spec.effect || "", stroke));
  const pairs = Math.ceil(causes.length / 2);
  const step = w / (pairs + 1);
  causes.forEach((cause, i) => {
    const up = i % 2 === 0;
    const bx = step * (Math.floor(i / 2) + 1);
    const ey = up ? top + LINE_PX + PAD_PX : top + h - LINE_PX - PAD_PX;
    const ex = bx - (h / 2 - LINE_PX) * 0.6;
    out.push(poly(`${p}-b${i + 1}`, [[ex, ey], [bx, sy]], stroke));
    out.push(centered(`${p}-c${i + 1}`, ex, up ? ey - LINE_PX / 2 - 4 : ey + LINE_PX / 2 + 4, cause, stroke));
    slots.push({ x: (ex + bx) / 2 + PAD_PX, y: (ey + sy) / 2 - FONT_SIZE_PX / 2 });
  });
  return out;
}

// Steps on a ring, joined by curved arrows. spec: { steps, radius }. Slots: under each step.
// @purity pure
function buildCycle(spec, slots = []) {
  const stroke = COLORS[spec.color || "blue"];
  const p = spec.prefix;
  const steps = spec.steps || [];
  const r = spec.radius || 300;
  const out = [];
  const top = pushTitle(out, spec, stroke);
  const cx = r + 80;
  const cy = top + r + 40;
  const at = (k, rr) => {
    const a = -Math.PI / 2 + (2 * Math.PI * k) / steps.length;
    return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
  };
  steps.forEach((step, i) => {
    const [x, y] = at(i, r);
    out.push(centered(`${p}-s${i + 1}`, x, y, step, stroke));
    slots.push({ x: x - textWidthPx(step) / 2, y: y + textHeightPx(step) / 2 + PAD_PX / 2 });
    // An arc of short segments between this step and the next.
    const arc = [0.25, 0.375, 0.5, 0.625, 0.75].map((t) => at(i + t, r));
    out.push(arrowPts(`${p}-a${i + 1}`, arc, stroke));
  });
  return out;
}

// A pyramid cut into levels, top first. spec: { levels, width, height }. Slots: right of each level.
// @purity pure
function buildPyramid(spec, slots = []) {
  const stroke = COLORS[spec.color || "blue"];
  const p = spec.prefix;
  const levels = spec.levels || [];
  const w = spec.width || 900;
  const h = spec.height || 700;
  const out = [];
  const top = pushTitle(out, spec, stroke);
  out.push(poly(`${p}-edge`, [[0, top + h], [w / 2, top], [w, top + h]], stroke));
  const lh = h / levels.length;
  levels.forEach((level, i) => {
    const y = top + (i + 1) * lh;
    const half = (w / 2) * ((i + 1) / levels.length);
    out.push(line(`${p}-b${i + 1}`, w / 2 - half, y, w / 2 + half, y, stroke));
    out.push(centered(`${p}-s${i + 1}`, w / 2, y - lh / 2 + (i === 0 ? lh / 4 : 0), level, stroke));
    slots.push({ x: w / 2 + half - (w / 2 / levels.length) / 2 + 2 * PAD_PX, y: y - lh / 2 - FONT_SIZE_PX / 2 });
  });
  return out;
}

// Overlapping circles (Venn), 2 or 3 sets, close enough that the overlaps have room to write in.
// spec: { sets, radius }. Slots: each set alone, then each pair (1-2, 1-3, 2-3), then all sets.
// @purity pure
function buildVenn(spec, slots = []) {
  const stroke = COLORS[spec.color || "blue"];
  const p = spec.prefix;
  const sets = (spec.sets || []).slice(0, 3);
  const r = spec.radius || 300;
  const out = [];
  const top = pushTitle(out, spec, stroke);
  const oy = top + LINE_PX + PAD_PX;
  const d = r * (sets.length === 3 ? VENN3_GAP : VENN2_GAP);
  const centers = sets.length === 3
    ? [[r, oy + r], [r + d, oy + r], [r + d / 2, oy + r + (d * Math.sqrt(3)) / 2]]
    : [[r, oy + r], [r + d, oy + r]];
  const gx = centers.reduce((s, c) => s + c[0], 0) / centers.length;
  const gy = centers.reduce((s, c) => s + c[1], 0) / centers.length;
  sets.forEach((set, i) => {
    const [x, y] = centers[i];
    out.push({ id: `${p}-c${i + 1}`, type: "ellipse", x: Math.round(x - r), y: Math.round(y - r), width: 2 * r, height: 2 * r, strokeColor: stroke, strokeWidth: 2, roughness: 0, backgroundColor: "transparent" });
    const below = sets.length === 3 && i === 2;
    const lx = below ? x : x + (i === 0 ? -r * 0.35 : r * 0.35);
    out.push(centered(`${p}-s${i + 1}`, lx, below ? y + r + PAD_PX + LINE_PX / 2 : oy - PAD_PX, set, stroke));
  });
  // Two sets: each alone, then the lens. On the center line, the area of one set alone is centered one radius
  // from the middle.
  const spots = sets.length === 3 ? VENN3_SPOTS : [[-1, 0], [1, 0], [0, 0]];
  spots.forEach(([sx, sy]) => slots.push({ x: gx + sx * r, y: gy + sy * r, center: true }));
  return out;
}

// Branches from a center (mind map). spec: { center, branches, radius }. Slots: the ends of the empty branches.
// @purity pure
function buildRadial(spec, slots = []) {
  const stroke = COLORS[spec.color || "blue"];
  const p = spec.prefix;
  const branches = spec.branches || [];
  const r = spec.radius || 380;
  const out = [];
  const top = pushTitle(out, spec, stroke);
  const cx = r + 120;
  const cy = top + r + 20;
  out.push(centered(`${p}-center`, cx, cy, spec.center || "", stroke, TITLE_SIZE_PX));
  branches.forEach((branch, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / branches.length;
    const [ux, uy] = [Math.cos(a), Math.sin(a)];
    out.push(poly(`${p}-l${i + 1}`, [[cx + 70 * ux, cy + 40 * uy], [cx + (r - 30) * ux, cy + (r - 30) * uy]], stroke));
    // An empty branch leaves the line only, for the person to write at its end.
    if (branch) out.push(centered(`${p}-b${i + 1}`, cx + r * ux, cy + r * uy, branch, stroke));
    else slots.push({ x: cx + r * ux - (ux < -0.3 ? 140 : ux > 0.3 ? 0 : 70), y: cy + r * uy - FONT_SIZE_PX / 2 });
  });
  return out;
}

// A center with forces around it (5 Forces, stakeholders). spec: { center, around (up to 4: top, right, bottom, left), gap }.
// Slots: under each label around, then under the center.
// @purity pure
function buildNetwork(spec, slots = []) {
  const stroke = COLORS[spec.color || "blue"];
  const p = spec.prefix;
  const around = (spec.around || []).slice(0, 4);
  const g = spec.gap || 420;
  const out = [];
  const top = pushTitle(out, spec, stroke);
  const cx = g + 120;
  const cy = top + g;
  out.push(centered(`${p}-center`, cx, cy, spec.center || "", stroke, TITLE_SIZE_PX));
  const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  around.forEach((label, i) => {
    const [ux, uy] = dirs[i];
    out.push(centered(`${p}-n${i + 1}`, cx + g * ux, cy + g * uy * 0.8, label, stroke));
    slots.push({ x: cx + g * ux - textWidthPx(label) / 2, y: cy + g * uy * 0.8 + textHeightPx(label) / 2 + PAD_PX / 2 });
    const from = [cx + (ux ? g - 90 : 0) * ux, cy + (uy ? g * 0.8 - 30 : 0) * uy];
    const to = [cx + (ux ? 100 : 0) * ux, cy + (uy ? 30 : 0) * uy];
    out.push(arrowPts(`${p}-a${i + 1}`, [from, to], stroke));
  });
  const center = spec.center || "";
  slots.push({ x: cx - textWidthPx(center, TITLE_SIZE_PX) / 2, y: cy + textHeightPx(center, TITLE_SIZE_PX) / 2 + PAD_PX / 2 });
  return out;
}

// A time axis on top with marks, lanes below divided by lines. spec: { marks, lanes, markWidth, laneHeight }.
// Slots: each lane and mark, lane by lane.
// @purity pure
function buildTimeline(spec, slots = []) {
  const stroke = COLORS[spec.color || "blue"];
  const p = spec.prefix;
  const marks = spec.marks || [];
  const lanes = spec.lanes || [];
  const mw = spec.markWidth || 280;
  const lh = spec.laneHeight || 150;
  const lw = Math.max(120, ...lanes.map((lane) => textWidthPx(lane) + 2 * PAD_PX));
  const out = [];
  const top = pushTitle(out, spec, stroke);
  const ay = top + LINE_PX + PAD_PX;
  const end = lw + marks.length * mw;
  out.push(arrowPts(`${p}-axis`, [[lw, ay], [end + 40, ay]], stroke));
  marks.forEach((mark, i) => {
    const x = lw + i * mw;
    out.push(text(`${p}-m${i + 1}`, x + 8, top, mark, stroke));
    out.push(line(`${p}-t${i + 1}`, x, ay - 8, x, ay + lanes.length * lh + PAD_PX, stroke, 1));
  });
  lanes.forEach((lane, i) => {
    const y = ay + PAD_PX + i * lh;
    out.push(text(`${p}-n${i + 1}`, 0, y + lh / 2 - LINE_PX / 2, lane, stroke));
    if (i > 0) out.push(line(`${p}-g${i}`, 0, y, end, y, stroke));
    marks.forEach((_, j) => slots.push({ x: lw + j * mw + PAD_PX / 2, y: y + PAD_PX }));
  });
  return out;
}

// Fixed areas on a board, drawn as shared lines without the outer frame. spec: { areas: [{ x, y, w, h, label }]
// in grid units, unit }. Each shared edge is drawn once. The areas of a named canvas live in data/frameworks.json.
// Slots: under the label of each area.
// @purity pure
function buildCanvas(spec, slots = []) {
  const stroke = COLORS[spec.color || "blue"];
  const p = spec.prefix;
  const cells = spec.areas || [];
  const u = spec.unit || 230;
  const out = [];
  const top = pushTitle(out, spec, stroke);
  const maxX = Math.max(...cells.map((c) => c.x + c.w));
  const maxY = Math.max(...cells.map((c) => c.y + c.h));
  // Unit segments on the inner edges, then merged into runs.
  const hs = new Set();
  const vs = new Set();
  cells.forEach((c) => {
    for (let x = c.x; x < c.x + c.w; x += 1) [c.y, c.y + c.h].forEach((y) => { if (y > 0 && y < maxY) hs.add(`${y},${x}`); });
    for (let y = c.y; y < c.y + c.h; y += 1) [c.x, c.x + c.w].forEach((x) => { if (x > 0 && x < maxX) vs.add(`${x},${y}`); });
  });
  let n = 0;
  const runs = (set, horizontal) => {
    const byLine = new Map();
    set.forEach((key) => {
      const [a, b] = key.split(",").map(Number);
      if (!byLine.has(a)) byLine.set(a, []);
      byLine.get(a).push(b);
    });
    [...byLine.keys()].sort((a, b) => a - b).forEach((a) => {
      const bs = byLine.get(a).sort((x, y) => x - y);
      let start = bs[0];
      bs.forEach((b, i) => {
        if (i + 1 < bs.length && bs[i + 1] === b + 1) return;
        n += 1;
        out.push(horizontal
          ? line(`${p}-e${n}`, start * u, top + a * u, (b + 1) * u, top + a * u, stroke)
          : line(`${p}-e${n}`, a * u, top + start * u, a * u, top + (b + 1) * u, stroke));
        start = bs[i + 1];
      });
    });
  };
  runs(hs, true);
  runs(vs, false);
  cells.forEach((c, i) => {
    out.push(text(`${p}-c${i + 1}`, c.x * u + PAD_PX / 2, top + c.y * u + PAD_PX / 2, c.label, stroke));
    slots.push({ x: c.x * u + PAD_PX / 2, y: top + c.y * u + PAD_PX + textHeightPx(c.label) });
  });
  return out;
}

// Two axes and a curve through points given from 0 to 1. spec: { xLabel, yLabel, points, labels: [{ x, text }], width, height }.
// Slots: above each phase label, under the curve.
// @purity pure
function buildGraph(spec, slots = []) {
  const stroke = COLORS[spec.color || "blue"];
  const p = spec.prefix;
  const w = spec.width || 1000;
  const h = spec.height || 500;
  const out = [];
  const top = pushTitle(out, spec, stroke) + LINE_PX;
  const ox = 40;
  const oy = top + h;
  out.push(arrowPts(`${p}-y`, [[ox, oy], [ox, top - LINE_PX]], stroke));
  out.push(arrowPts(`${p}-x`, [[ox, oy], [ox + w + 20, oy]], stroke));
  if (spec.yLabel) out.push(text(`${p}-yl`, ox + 10, top - LINE_PX * 2, spec.yLabel, stroke));
  if (spec.xLabel) out.push(text(`${p}-xl`, ox + w + 30, oy - LINE_PX / 2, spec.xLabel, stroke));
  const pts = (spec.points || []).map(([x, y]) => [ox + x * w, oy - y * h]);
  if (pts.length > 1) out.push(poly(`${p}-curve`, pts, stroke, { strokeWidth: 3 }));
  (spec.labels || []).forEach((label, i) => {
    out.push(centered(`${p}-lb${i + 1}`, ox + label.x * w, oy + LINE_PX, label.text, stroke));
    slots.push({ x: ox + label.x * w - 60, y: oy - 2 * LINE_PX });
    if (i > 0) out.push(line(`${p}-sep${i}`, ox + ((spec.labels[i - 1].x + label.x) / 2) * w, top, ox + ((spec.labels[i - 1].x + label.x) / 2) * w, oy, stroke, 1));
  });
  return out;
}

const BUILDERS = Object.freeze({
  cross: buildCross, grid: buildGrid, contrast: buildContrast, list: buildList, flow: buildFlow,
  funnel: buildFunnel, tree: buildTree, fishbone: buildFishbone, cycle: buildCycle, pyramid: buildPyramid,
  venn: buildVenn, radial: buildRadial, network: buildNetwork, timeline: buildTimeline, canvas: buildCanvas,
  graph: buildGraph,
});

// The writable slots of a frame, in order: { x, y } where an example text starts, or with center: true,
// the middle of the example text.
// @purity pure
function frameSlots(spec) {
  const slots = [];
  checkedBuilder(spec)(spec, slots);
  return slots;
}

// @purity pure
function checkedBuilder(spec) {
  const build = BUILDERS[spec && spec.shape];
  if (!build) throw new Error(`unknown shape: ${spec && spec.shape} (use ${Object.keys(BUILDERS).join(", ")})`);
  if (!/^[A-Za-z0-9_]{1,12}$/.test(spec.prefix || "")) throw new Error("prefix must be 1-12 letters, digits or _");
  return build;
}

// The frame, then one gray example text per slot (ids PREFIX-exN, from 1). Extra examples are an error.
// @purity pure
function buildFrame(spec) {
  const slots = [];
  const out = checkedBuilder(spec)(spec, slots);
  const examples = spec.examples || [];
  if (examples.length > slots.length) throw new Error(`examples: ${examples.length} given, the shape has ${slots.length} slots`);
  examples.forEach((example, i) => {
    if (!example) return;
    const s = slots[i];
    const x = s.center ? s.x - textWidthPx(example, FONT_SIZE_PX) / 2 : s.x;
    const y = s.center ? s.y - textHeightPx(example, FONT_SIZE_PX) / 2 : s.y;
    out.push(text(`${spec.prefix}-ex${i + 1}`, Math.round(x), Math.round(y), example, HELP_COLOR, FONT_SIZE_PX));
  });
  return out;
}

// Several frames in one output; each spec may carry at: { x, y } to place it.
// @purity pure
function buildSheet(specs) {
  return specs.flatMap((spec) => {
    const dx = (spec.at && spec.at.x) || 0;
    const dy = (spec.at && spec.at.y) || 0;
    return buildFrame(spec).map((el) => ({ ...el, x: Math.round(el.x + dx), y: Math.round(el.y + dy) }));
  });
}

// The frame spec of one framework in data/frameworks.json: { shape, ...cells } with its name as title and its
// guide under it. lang "ja" (default) uses the Japanese name with the English name beside it, and guideJa;
// "en" uses name and summary. subject (what the talk is about) follows the name in the title, so every frame
// says which framework it is and what it is for ("SWOT Analysis  Sample Inc. products").
// @purity pure
function specFromData(data, id, prefix, lang = "ja", subject = "") {
  const found = data.frameworks.find((f) => f.id === id);
  if (!found) throw new Error(`unknown framework id: ${id}`);
  if (found.skill) throw new Error(`${id} has no frame: run the skill ${found.skill} of this plugin`);
  const ja = lang === "ja";
  const same = found.nameJa.toLowerCase().replace(/\s/g, "") === found.name.toLowerCase().replace(/\s/g, "");
  const name = ja && !same ? `${found.nameJa} ${found.name}` : found.name;
  return {
    shape: found.shape, prefix: prefix || id.replace(/[^A-Za-z0-9]/g, "").slice(0, 12),
    title: subject ? `${name}  ${subject}` : name, guide: ja ? found.guideJa : found.summary, ...found.cells,
  };
}

// The slot nearest to a point given from the top left of the frame (a text the person wrote, for example):
// { n (from 1), x, y, distance }. To map a board item to its place in the frame.
// @purity pure
function locateSlot(spec, x, y) {
  const best = frameSlots(spec)
    .map((s, i) => ({ n: i + 1, x: Math.round(s.x), y: Math.round(s.y), distance: Math.round(Math.hypot(s.x - x, s.y - y)) }))
    .sort((a, b) => a.distance - b.distance)[0];
  if (!best) throw new Error("the shape has no slots");
  return best;
}

// Usage:
//   node frame.js spec.json                  draw a spec (or the spec JSON on stdin)
//   node frame.js --id swot [--subject S] [--prefix P] [--lang en]   draw a framework of the data
//   node frame.js --spec swot [--subject S] [--lang en]    print the spec of a framework, to edit and draw with a file
//   node frame.js --slots spec.json          print the slots of a spec, to write its examples
//   node frame.js --locate spec.json X Y     print the slot nearest to X,Y (board place minus the frame's at)
// @purity non-pure
function main() {
  const fs = require("fs");
  const path = require("path");
  const args = process.argv.slice(2);
  const flag = (name) => (args.indexOf(name) > 0 ? args[args.indexOf(name) + 1] : undefined);
  const fromData = () => {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "frameworks.json"), "utf8"));
    return specFromData(data, args[1], flag("--prefix"), flag("--lang"), flag("--subject"));
  };
  const fromFile = (file) => JSON.parse(file ? fs.readFileSync(file, "utf8") : fs.readFileSync(0, "utf8"));
  let out;
  if (args[0] === "--id") out = buildFrame(fromData());
  else if (args[0] === "--spec") out = fromData();
  else if (args[0] === "--slots") out = frameSlots(fromFile(args[1])).map((s, i) => ({ n: i + 1, x: Math.round(s.x), y: Math.round(s.y) }));
  else if (args[0] === "--locate") out = locateSlot(fromFile(args[1]), Number(args[2]), Number(args[3]));
  else {
    const spec = fromFile(args[0]);
    out = Array.isArray(spec) ? buildSheet(spec) : buildFrame(spec);
  }
  process.stdout.write(JSON.stringify(out) + "\n");
}

if (require.main === module) main();

module.exports = { BUILDERS, buildCross, buildFrame, buildGrid, buildSheet, frameSlots, locateSlot, specFromData, textWidthPx };
