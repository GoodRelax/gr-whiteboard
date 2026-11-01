"use strict";

// BoardStore (Entity). Holds the Board: every Excalidraw element, deleted ones too,
// so that all pages agree on what was deleted. See spec 3.3.

const MAX_ID_CHARS = 64;
// The marker that Answers carry, so they are never reported as Messages (FR-014).
const ANSWER_MARK = "answer";
// The marker that Claude Items carry: Elements that the Agent drew with draw or mermaid (FR-091).
const CLAUDE_MARK = "claudeItem";
const LINEAR_TYPES = Object.freeze(["arrow", "line"]);

// @purity pure
function isElement(value) {
  return value !== null && typeof value === "object"
    && typeof value.id === "string" && value.id.length > 0 && value.id.length <= MAX_ID_CHARS
    && typeof value.type === "string"
    && Number.isInteger(value.version) && value.version >= 0
    && Number.isFinite(value.versionNonce);
}

// Excalidraw's rule: the higher version wins; for the same version, the lower versionNonce wins.
// @purity pure
function isNewer(incoming, current) {
  if (!current) return true;
  if (incoming.version !== current.version) return incoming.version > current.version;
  return incoming.versionNonce < current.versionNonce;
}

// Changes `elements` (a Map of id -> element) and returns the elements of `incoming` that changed it.
// The caller sends them to the other pages.
// @purity non-pure
function mergeElements(elements, incoming) {
  const changed = [];
  for (const element of incoming) {
    if (!isElement(element)) continue;
    if (!isNewer(element, elements.get(element.id))) continue;
    elements.set(element.id, element);
    changed.push(element);
  }
  return changed;
}

// @purity pure
function isAnswer(element) {
  return Boolean(element.customData && element.customData.grwbKind === ANSWER_MARK);
}

// Answers and Claude Items are "by Claude" (FR-091, FR-108).
// @purity pure
function isByClaude(element) {
  const mark = element.customData && element.customData.grwbKind;
  return mark === ANSWER_MARK || mark === CLAUDE_MARK;
}

// @purity pure
function boundId(binding) {
  return binding && typeof binding.elementId === "string" ? binding.elementId : null;
}

// The points of an arrow or line, relative to its x and y, rounded to 0.1 px (FR-119). Null when there are none.
// @purity pure
function pointsOf(element) {
  if (!Array.isArray(element.points)) return null;
  const points = element.points
    .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
  return points.length > 0 ? points : null;
}

// The box of an Item on the Board. For an arrow or line, the box of its points:
// its width and height can be old, and its points can go left of or above x and y (FR-119).
// @purity pure
function boundsOf(item) {
  if (!Array.isArray(item.points) || item.points.length === 0) {
    return { x: item.x, y: item.y, width: item.width, height: item.height };
  }
  const xs = item.points.map((p) => p[0]);
  const ys = item.points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: item.x + minX, y: item.y + minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

// The Item view of the Board (spec 3.4): no deleted elements, numbers only where needed.
// @purity pure
function toItems(elements) {
  const items = [];
  for (const element of elements.values()) {
    if (element.isDeleted) continue;
    const item = {
      id: element.id,
      type: element.type,
      x: Number(element.x) || 0,
      y: Number(element.y) || 0,
      width: Number(element.width) || 0,
      height: Number(element.height) || 0,
      text: element.type === "text" && typeof element.text === "string" ? element.text : null,
      containerId: element.containerId || null,
      updatedMs: Number(element.updated) || 0,
      isAnswer: isAnswer(element),
      byClaude: isByClaude(element),
      angle: Number(element.angle) || 0,
      strokeColor: typeof element.strokeColor === "string" ? element.strokeColor : null,
      backgroundColor: typeof element.backgroundColor === "string" ? element.backgroundColor : null,
    };
    if (LINEAR_TYPES.includes(element.type)) {
      item.startId = boundId(element.startBinding);
      item.endId = boundId(element.endBinding);
      const points = pointsOf(element);
      if (points) {
        item.points = points;
        const box = boundsOf(item);
        item.width = box.width;
        item.height = box.height;
      }
    }
    items.push(Object.freeze(item));
  }
  return items;
}

// Deleted elements are kept for a while, so that a page that was away also deletes them.
// @purity pure
function pruneDeleted(list, nowMs, keepMs) {
  return list.filter((element) => !(element.isDeleted && nowMs - (Number(element.updated) || 0) > keepMs));
}

module.exports = { ANSWER_MARK, CLAUDE_MARK, isElement, isByClaude, isNewer, mergeElements, toItems, boundsOf, pruneDeleted };
