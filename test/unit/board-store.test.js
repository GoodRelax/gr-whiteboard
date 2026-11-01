"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { isElement, isNewer, mergeElements, toItems, boundsOf, pruneDeleted } = require("../../skills/whiteboard-server/scripts/lib/board-store");

// @purity pure
function element(id, version, versionNonce, extra = {}) {
  return { id, type: "text", version, versionNonce, x: 1, y: 2, width: 3, height: 4, text: "t", updated: 10, ...extra };
}

test("isElement needs id, type, version and versionNonce", () => {
  assert.equal(isElement(element("a", 1, 5)), true);
  assert.equal(isElement({ id: "a", type: "text", version: 1 }), false);
  assert.equal(isElement({ id: "", type: "text", version: 1, versionNonce: 1 }), false);
  assert.equal(isElement({ id: "x".repeat(65), type: "text", version: 1, versionNonce: 1 }), false);
  assert.equal(isElement(null), false);
});

test("higher version wins; same version: lower versionNonce wins (FR-021)", () => {
  assert.equal(isNewer(element("a", 2, 9), element("a", 1, 1)), true);
  assert.equal(isNewer(element("a", 1, 1), element("a", 2, 9)), false);
  assert.equal(isNewer(element("a", 3, 4), element("a", 3, 5)), true);
  assert.equal(isNewer(element("a", 3, 5), element("a", 3, 4)), false);
  assert.equal(isNewer(element("a", 3, 5), element("a", 3, 5)), false);
  assert.equal(isNewer(element("a", 1, 1), undefined), true);
});

test("mergeElements keeps the newer element and returns only the changed ones", () => {
  const board = new Map([["a", element("a", 2, 1)]]);
  const changed = mergeElements(board, [element("a", 1, 1), element("b", 1, 1), { id: "bad" }]);
  assert.deepEqual(changed.map((e) => e.id), ["b"]);
  assert.equal(board.get("a").version, 2);
  assert.equal(board.size, 2);
});

test("toItems leaves out deleted elements and marks Answers (FR-014)", () => {
  const board = new Map([
    ["a", element("a", 1, 1)],
    ["b", element("b", 1, 1, { isDeleted: true })],
    ["c", element("c", 1, 1, { customData: { whiteboardChat: "answer" } })],
    ["d", element("d", 1, 1, { type: "freedraw", text: undefined, containerId: "box" })],
  ]);
  const items = toItems(board);
  assert.deepEqual(items.map((i) => [i.id, i.isAnswer]), [["a", false], ["c", true], ["d", false]]);
  assert.deepEqual(items[0], {
    id: "a", type: "text", x: 1, y: 2, width: 3, height: 4, text: "t", containerId: null, updatedMs: 10, isAnswer: false,
    byClaude: false, angle: 0, strokeColor: null, backgroundColor: null,
  });
  assert.equal(items[2].text, null);
  assert.equal(items[2].containerId, "box");
});

test("pruneDeleted drops only old deleted elements", () => {
  const list = [element("a", 1, 1, { isDeleted: true, updated: 0 }), element("b", 1, 1, { isDeleted: true, updated: 900 }), element("c", 1, 1, { updated: 0 })];
  assert.deepEqual(pruneDeleted(list, 1000, 500).map((e) => e.id), ["b", "c"]);
});

test("toItems gives arrows and lines their points and the size of their points (FR-119)", () => {
  const line = element("v", 1, 1, { type: "line", x: 5, y: 6, width: 100, height: 0, points: [[0, 0], [0.04, 730.06]], text: undefined });
  const arrow = element("a", 1, 1, { type: "arrow", width: 1, height: 1, points: [[0, 0], [-40, 20]], text: undefined });
  const [v, a] = toItems(new Map([["v", line], ["a", arrow]]));
  assert.deepEqual([v.points, v.width, v.height, v.x, v.y], [[[0, 0], [0, 730.1]], 0, 730.1, 5, 6]);
  assert.deepEqual([a.points, a.width, a.height], [[[0, 0], [-40, 20]], 40, 20]);
  assert.deepEqual(boundsOf(a), { x: -39, y: 2, width: 40, height: 20 });
  assert.equal("points" in toItems(new Map([["t", element("t", 1, 1)]]))[0], false, "only arrows and lines have points");
});
