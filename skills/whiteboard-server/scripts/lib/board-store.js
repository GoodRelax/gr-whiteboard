"use strict";

// BoardStore (Entity). Holds the Board: every Excalidraw element, deleted ones too,
// so that all pages agree on what was deleted. See spec 3.3.

const MAX_ID_CHARS = 64;
// The marker that Answers carry, so they are never reported as Messages (FR-014).
const ANSWER_MARK = "answer";

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
  return Boolean(element.customData && element.customData.whiteboardChat === ANSWER_MARK);
}

// The Item view of the Board (spec 3.4): no deleted elements, numbers only where needed.
// @purity pure
function toItems(elements) {
  const items = [];
  for (const element of elements.values()) {
    if (element.isDeleted) continue;
    items.push(Object.freeze({
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
    }));
  }
  return items;
}

// Deleted elements are kept for a while, so that a page that was away also deletes them.
// @purity pure
function pruneDeleted(list, nowMs, keepMs) {
  return list.filter((element) => !(element.isDeleted && nowMs - (Number(element.updated) || 0) > keepMs));
}

module.exports = { ANSWER_MARK, isElement, isNewer, mergeElements, toItems, pruneDeleted };
