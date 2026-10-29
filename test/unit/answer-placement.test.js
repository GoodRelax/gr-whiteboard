"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { placeAnswer, clearOfItems } = require("../../skills/whiteboard-server/scripts/lib/answer-placement");

// @purity pure
function item(id, x, y, height, updatedMs) {
  return { id, type: "text", x, y, width: 10, height, text: "t", containerId: null, updatedMs };
}

test("empty board puts the answer at (0, 0)", () => {
  assert.deepEqual(placeAnswer([], new Set(), 40), { x: 0, y: 0 });
});

test("answer goes below everything, at the x of the newest other item (SC-020)", () => {
  const items = [item("a", 100, 900, 100, 1), item("b", 400, 500, 20, 5), item("own", 700, 600, 20, 9)];
  assert.deepEqual(placeAnswer(items, new Set(["own"]), 40), { x: 400, y: 1040 });
});

test("only own items: uses the newest own item", () => {
  const items = [item("o1", 10, 0, 20, 1), item("o2", 30, 50, 20, 2)];
  assert.deepEqual(placeAnswer(items, new Set(["o1", "o2"]), 0), { x: 30, y: 81 });
});

test("a point on an existing item moves below it (FR-029)", () => {
  const items = [item("a", 0, 100, 25, 1), item("b", 0, 165, 50, 2)];
  // (5, 110) is on "a"; below "a" is (5, 165), which is on "b"; below "b" is free.
  assert.deepEqual(clearOfItems({ x: 5, y: 110 }, items, 40), { x: 5, y: 255 });
  assert.deepEqual(clearOfItems({ x: 500, y: 110 }, items, 40), { x: 500, y: 110 });
});
