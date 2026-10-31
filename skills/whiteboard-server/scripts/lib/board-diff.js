"use strict";

// BoardDiff (Entity). Compares the Board with the Baseline (the Board at the last Send) and lists
// what changed, so that no change gets past the Agent unseen (FR-070 to FR-077).
// The owner's order: first the added texts in the order they were written, then every other change.

// Smaller moves and size changes are noise (a click that nudges an item).
const MOVE_MIN_PX = 3;
const ANGLE_MIN_RAD = 0.01;
const STYLE_FIELDS = Object.freeze([
  "strokeColor", "backgroundColor", "fillStyle", "strokeWidth", "strokeStyle", "roughness", "opacity",
  "fontSize", "fontFamily", "textAlign", "fileId",
]);
const KIND_ORDER = Object.freeze({ edited: 0, deletedText: 1, added: 2, changed: 3, deleted: 4 });
const ANSWER_MARK = "answer";
const CLAUDE_MARK = "claude";

// @purity pure
function round(value) {
  return Math.round(Number(value) || 0);
}

// The part of an Element that the diff looks at. Small, so it can be saved as the Baseline.
// @purity pure
function summarize(element) {
  const style = {};
  for (const field of STYLE_FIELDS) {
    if (element[field] !== undefined) style[field] = element[field];
  }
  return Object.freeze({
    id: element.id,
    type: element.type,
    x: round(element.x),
    y: round(element.y),
    width: round(element.width),
    height: round(element.height),
    angle: Number(element.angle) || 0,
    text: element.type === "text" && typeof element.text === "string" ? element.text : null,
    containerId: element.containerId || null,
    isAnswer: Boolean(element.customData && element.customData.whiteboardChat === ANSWER_MARK),
    byClaude: Boolean(element.customData && [ANSWER_MARK, CLAUDE_MARK].includes(element.customData.whiteboardChat)),
    style: Object.freeze(style),
    shape: Array.isArray(element.points) ? element.points.map((p) => `${round(p[0])},${round(p[1])}`).join(" ") : "",
  });
}

// Summaries of every Element that is not deleted, as a Map id -> summary.
// @purity pure
function summarizeBoard(elements) {
  const out = new Map();
  for (const element of elements) {
    if (!element.isDeleted) out.set(element.id, summarize(element));
  }
  return out;
}

// @purity pure
function isBlank(text) {
  return typeof text !== "string" || text.trim() === "";
}

// @purity pure
function where(item) {
  return { id: item.id, type: item.type, x: item.x, y: item.y, isAnswer: item.isAnswer, byClaude: Boolean(item.byClaude) };
}

// What changed in one Element that is on both Boards; an empty list means "nothing worth telling".
// @purity pure
function differences(before, now) {
  const what = [];
  if (Math.abs(now.x - before.x) >= MOVE_MIN_PX || Math.abs(now.y - before.y) >= MOVE_MIN_PX) what.push("moved");
  // Text and Answers get their size from their words, so a size change alone says nothing new.
  const sizeFollowsText = now.type === "text";
  if (!sizeFollowsText && (Math.abs(now.width - before.width) >= MOVE_MIN_PX || Math.abs(now.height - before.height) >= MOVE_MIN_PX)) {
    what.push("resized");
  }
  if (Math.abs(now.angle - before.angle) >= ANGLE_MIN_RAD) what.push("rotated");
  const style = STYLE_FIELDS.filter((field) => now.style[field] !== before.style[field]);
  if (style.length > 0) what.push("restyled");
  if (now.shape !== before.shape && !what.includes("resized")) what.push("reshaped");
  return { what, style };
}

// @purity pure
function byPosition(a, b) {
  return a.y - b.y || a.x - b.x;
}

// baseline, current: Map id -> summary. firstSeenMs: Map id -> when the Server first got the Element.
// skipIds: Elements that someone is typing in now; they are left for later (FR-013).
// Returns { messages, changes }: messages = added texts in the order they were written;
// changes = everything else, sorted by kind (edited texts, deleted texts, added drawings, changed, deleted drawings).
// @purity pure
function diffBoards(baseline, current, firstSeenMs, skipIds) {
  const messages = [];
  const changes = [];
  const movedIds = new Set();
  for (const [id, now] of current) {
    if (skipIds.has(id)) continue;
    const before = baseline.get(id);
    if (!before) {
      if (now.type === "text") {
        if (!isBlank(now.text) && !now.byClaude) messages.push({ id, text: now.text, x: now.x, y: now.y, inShape: now.containerId !== null });
      } else {
        changes.push({ kind: "added", ...where(now), width: now.width, height: now.height });
      }
      continue;
    }
    const { what, style } = differences(before, now);
    if (what.includes("moved")) movedIds.add(id);
    const textChanged = now.text !== before.text;
    if (!textChanged && what.length === 0) continue;
    const entry = { kind: textChanged ? "edited" : "changed", ...where(now) };
    if (now.text !== null) entry.text = now.text;
    if (textChanged) entry.oldText = before.text;
    if (what.length > 0) entry.what = what;
    if (what.includes("moved")) entry.from = { x: before.x, y: before.y };
    if (style.length > 0) entry.style = style;
    changes.push(entry);
  }
  for (const [id, before] of baseline) {
    if (current.has(id) || skipIds.has(id)) continue;
    const entry = { kind: "deleted", ...where(before) };
    if (before.text !== null) entry.text = before.text;
    changes.push(entry);
  }
  // A text inside a shape moves with the shape; say it once, for the shape.
  const kept = changes.filter((entry) => {
    if (entry.kind !== "changed" || !entry.what || entry.what.join() !== "moved") return true;
    const now = current.get(entry.id);
    return !(now && now.containerId && movedIds.has(now.containerId));
  });
  messages.sort((a, b) => (firstSeenMs.get(a.id) || 0) - (firstSeenMs.get(b.id) || 0) || byPosition(a, b));
  const rank = (entry) => KIND_ORDER[entry.kind === "deleted" && entry.text !== undefined ? "deletedText" : entry.kind];
  kept.sort((a, b) => rank(a) - rank(b) || byPosition(a, b));
  return { messages, changes: kept };
}

// @purity pure
function countOf(diff) {
  return diff.messages.length + diff.changes.length;
}

// @purity pure
function toSentEvent(diff) {
  return Object.freeze({ event: "MessagesSent", messages: diff.messages, changes: diff.changes });
}

module.exports = { summarize, summarizeBoard, diffBoards, countOf, toSentEvent, MOVE_MIN_PX };
