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

// @purity pure
function covers(item, point) {
  return point.x >= item.x - CLEAR_MARGIN_PX && point.x <= item.x + item.width + CLEAR_MARGIN_PX
    && point.y >= item.y - CLEAR_MARGIN_PX && point.y <= item.y + item.height + CLEAR_MARGIN_PX;
}

// An Answer on top of another item is hard to read (spec FR-029),
// so move the point down until no item covers it.
// @purity pure
function clearOfItems(point, items, gapPx) {
  let y = point.y;
  for (let i = 0; i < MAX_MOVES; i += 1) {
    const hit = items.find((item) => covers(item, { x: point.x, y }));
    if (!hit) break;
    y = hit.y + hit.height + Math.max(gapPx, CLEAR_MARGIN_PX + 1);
  }
  return Object.freeze({ x: point.x, y });
}

// @purity pure
function placeAnswer(items, ownIds, gapPx) {
  if (items.length === 0) return Object.freeze({ x: 0, y: 0 });
  const bottom = Math.max(...items.map((item) => item.y + item.height));
  const others = items.filter((item) => !ownIds.has(item.id));
  const anchor = newest(others.length > 0 ? others : items);
  return clearOfItems({ x: anchor.x, y: bottom + gapPx }, items, gapPx);
}

module.exports = { placeAnswer, clearOfItems };
