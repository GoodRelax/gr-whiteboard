"use strict";

// AnswerPlacement (Entity). Finds the Board Point for an Answer. See spec 4.6.

// Extra space around an item, so an Answer does not touch it.
const CLEAR_MARGIN_PX = 10;
const MAX_MOVES = 1000;

// @purity pure
function newest(items) {
  let best = null;
  for (const item of items) {
    if (best === null || item.updatedMs > best.updatedMs) best = item;
  }
  return best;
}

// True when the box (with a margin around the item) overlaps the item. A box with no size is a point.
// @purity pure
function covers(item, box) {
  return box.x <= item.x + item.width + CLEAR_MARGIN_PX && box.x + box.width >= item.x - CLEAR_MARGIN_PX
    && box.y <= item.y + item.height + CLEAR_MARGIN_PX && box.y + box.height >= item.y - CLEAR_MARGIN_PX;
}

// An Answer on top of another item is hard to read (spec FR-029),
// so move it down until no item covers it. `size` is the expected size of the Answer.
// @purity pure
function clearOfItems(point, items, gapPx, size = { width: 0, height: 0 }) {
  let y = point.y;
  for (let i = 0; i < MAX_MOVES; i += 1) {
    const hit = items.find((item) => covers(item, { x: point.x, y, width: size.width, height: size.height }));
    if (!hit) break;
    y = hit.y + hit.height + Math.max(gapPx, CLEAR_MARGIN_PX + 1);
  }
  return Object.freeze({ x: point.x, y });
}

// Like a chat on a phone: the Answer goes right below the newest Message, moved `indentPx`
// to the left (spec 4.6). Later Answers to the same Message go below the earlier ones.
// @purity pure
function placeAnswer(items, ownIds, gapPx, indentPx = 0, size = { width: 0, height: 0 }) {
  if (items.length === 0) return Object.freeze({ x: 0, y: 0 });
  const start = anchorPoint(items, ownIds, gapPx, indentPx);
  return clearOfItems(start, items, gapPx, size);
}

// Steps 3 and 4 of spec 4.6: the newest Message, else the newest other Item, else the newest own Item;
// the point right below it, `indentPx` to the left (no indent below an own Item). `items` is not empty.
// @purity pure
function anchorPoint(items, ownIds, gapPx, indentPx = 0) {
  const others = items.filter((item) => !ownIds.has(item.id));
  const messages = others.filter((item) => item.type === "text");
  const anchor = newest(messages.length > 0 ? messages : others.length > 0 ? others : items);
  const shift = ownIds.has(anchor.id) ? 0 : indentPx;
  return Object.freeze({ x: anchor.x - shift, y: anchor.y + anchor.height + gapPx });
}

// A rough size of an Answer before the page measures it: about 0.55 em per character, 1.25 em per line.
// @purity pure
function estimateSize(text, fontSizePx) {
  const lines = String(text).split("\n");
  const longest = Math.max(...lines.map((line) => line.length));
  return Object.freeze({ width: Math.ceil(longest * fontSizePx * 0.55), height: Math.ceil(lines.length * fontSizePx * 1.25) });
}

module.exports = { placeAnswer, anchorPoint, clearOfItems, estimateSize };
