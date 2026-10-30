"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { placeAnswer, clearOfItems, estimateSize } = require("../../skills/whiteboard-server/scripts/lib/answer-placement");

// @purity pure
function item(id, x, y, height, updatedMs, type = "text") {
  return { id, type, x, y, width: 10, height, text: type === "text" ? "t" : null, containerId: null, updatedMs };
}

test("empty board puts the answer at (0, 0)", () => {
  assert.deepEqual(placeAnswer([], new Set(), 40), { x: 0, y: 0 });
});

test("chat style: right below the newest Message, indentPx to the left (SC-020)", () => {
  const items = [item("a", 100, 900, 100, 1), item("msg", 1410, 500, 25, 5), item("own", 700, 600, 20, 9)];
  assert.deepEqual(placeAnswer(items, new Set(["own"]), 12, 170), { x: 1240, y: 537 });
});

test("the newest Message wins over a newer drawing", () => {
  const items = [item("msg", 400, 100, 25, 1), item("pen", 0, 0, 50, 9, "freedraw")];
  assert.deepEqual(placeAnswer(items, new Set(), 10, 100), { x: 300, y: 135 });
});

test("a second Answer to the same Message goes below the first", () => {
  const items = [item("msg", 400, 100, 25, 1), item("ans1", 300, 135, 25, 2)];
  const point = placeAnswer(items, new Set(["ans1"]), 10, 100, { width: 50, height: 25 });
  assert.deepEqual(point, { x: 300, y: 171 });
});

test("only own items: below the newest own item, with no indent", () => {
  const items = [item("o1", 10, 0, 20, 1), item("o2", 30, 50, 20, 2)];
  assert.deepEqual(placeAnswer(items, new Set(["o1", "o2"]), 0, 170), { x: 30, y: 70 + 11 });
});

test("a point on an existing item moves below it (FR-029)", () => {
  const items = [item("a", 0, 100, 25, 1), item("b", 0, 165, 50, 2)];
  // (5, 110) is on "a"; below "a" is (5, 165), which is on "b"; below "b" is free.
  assert.deepEqual(clearOfItems({ x: 5, y: 110 }, items, 40), { x: 5, y: 255 });
  assert.deepEqual(clearOfItems({ x: 500, y: 110 }, items, 40), { x: 500, y: 110 });
});

test("the whole expected box of the Answer must be free, not only its corner", () => {
  const items = [item("right", 200, 100, 25, 1)];
  assert.deepEqual(clearOfItems({ x: 0, y: 100 }, items, 10), { x: 0, y: 100 });
  assert.deepEqual(clearOfItems({ x: 0, y: 100 }, items, 10, { width: 250, height: 25 }), { x: 0, y: 136 });
});

test("estimateSize counts the longest line and the lines", () => {
  assert.deepEqual(estimateSize("ab\nabcd", 20), { width: 44, height: 50 });
});
