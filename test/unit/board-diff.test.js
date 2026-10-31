"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { summarize, summarizeBoard, diffBoards, countOf, toSentEvent } = require("../../skills/whiteboard-server/scripts/lib/board-diff");

// @purity pure
function el(id, type, extra = {}) {
  return { id, type, x: 100, y: 100, width: 50, height: 20, angle: 0, strokeColor: "#1e1e1e", backgroundColor: "transparent", ...extra };
}

// @purity pure
function text(id, words, extra = {}) {
  return el(id, "text", { text: words, ...extra });
}

// @purity pure
function diff(before, after, { firstSeen = new Map(), skip = new Set() } = {}) {
  return diffBoards(summarizeBoard(before), summarizeBoard(after), firstSeen, skip);
}

test("added texts come first, in the order the Server got them (FR-077)", () => {
  const firstSeen = new Map([["late", 20], ["early", 10]]);
  const result = diff([], [text("late", "second", { y: 0 }), text("early", "first", { y: 500 })], { firstSeen });
  assert.deepEqual(result.messages.map((m) => m.text), ["first", "second"]);
  assert.deepEqual(result.changes, []);
});

test("blank texts, texts being typed, and new Answers are not messages", () => {
  const answer = text("ans", "hi", { customData: { whiteboardChat: "answer" } });
  const result = diff([], [text("blank", "  "), text("typing", "hal"), answer], { skip: new Set(["typing"]) });
  assert.equal(countOf(result), 0);
});

test("every kind of change is listed, sorted by kind (FR-070, FR-075)", () => {
  const before = [
    text("t1", "old words"), text("t2", "will go", { y: 300 }), el("box", "rectangle"),
    el("arrow", "arrow", { points: [[0, 0], [50, 0]] }), el("gone", "ellipse", { y: 900 }),
  ];
  const after = [
    text("t1", "new words"),
    el("box", "rectangle", { x: 160, backgroundColor: "#ffc9c9" }),
    el("arrow", "arrow", { points: [[0, 0], [50, 30]] }),
    el("pen", "freedraw", { y: 700 }),
  ];
  const { messages, changes } = diff(before, after);
  assert.deepEqual(messages, []);
  assert.deepEqual(changes.map((c) => [c.kind, c.id]), [
    ["edited", "t1"], ["deleted", "t2"], ["added", "pen"], ["changed", "arrow"], ["changed", "box"], ["deleted", "gone"],
  ]);
  const edited = changes[0];
  assert.deepEqual([edited.text, edited.oldText], ["new words", "old words"]);
  assert.equal(changes[1].text, "will go");
  // Same kind: top to bottom, then left to right (the arrow is at x 100, the box now at x 160).
  const box = changes[4];
  assert.deepEqual(box.what, ["moved", "restyled"]);
  assert.deepEqual(box.from, { x: 100, y: 100 });
  assert.deepEqual(box.style, ["backgroundColor"]);
  assert.deepEqual(changes[3].what, ["reshaped"]);
});

test("small nudges, size changes of text, and version-only changes are not news", () => {
  const before = [text("t", "same", { width: 50 }), el("box", "rectangle")];
  const after = [text("t", "same", { width: 80 }), el("box", "rectangle", { x: 102, y: 98 })];
  assert.equal(countOf(diff(before, after)), 0);
});

test("a deleted or moved Answer is a change, marked isAnswer", () => {
  const answer = (extra) => text("ans", "hi", { customData: { whiteboardChat: "answer" }, ...extra });
  const moved = diff([answer({})], [answer({ x: 400 })]).changes;
  assert.deepEqual(moved.map((c) => [c.kind, c.isAnswer, c.what]), [["changed", true, ["moved"]]]);
  const deleted = diff([answer({})], []).changes;
  assert.deepEqual(deleted.map((c) => [c.kind, c.isAnswer, c.text]), [["deleted", true, "hi"]]);
});

test("a text inside a moved shape is not listed again", () => {
  const before = [el("box", "rectangle"), text("label", "A", { containerId: "box" })];
  const after = [el("box", "rectangle", { x: 300 }), text("label", "A", { containerId: "box", x: 300 })];
  assert.deepEqual(diff(before, after).changes.map((c) => c.id), ["box"]);
});

test("deleted items in the Baseline are not reported again; the event has both lists", () => {
  const result = diff([el("a", "rectangle", { isDeleted: true })], []);
  assert.equal(countOf(result), 0);
  assert.deepEqual(toSentEvent({ messages: [1], changes: [2] }), { event: "MessagesSent", messages: [1], changes: [2] });
  assert.equal(summarize(text("x", "t")).text, "t");
});

test("an image is a Drawing: added, then a new picture is restyled with fileId (FR-084)", () => {
  const image = el("img", "image", { fileId: "file0001" });
  const added = diff([], [image]);
  assert.deepEqual(added.changes.map((c) => [c.kind, c.type]), [["added", "image"]]);
  const swapped = diff([image], [{ ...image, fileId: "file0002" }]);
  assert.deepEqual(swapped.changes.map((c) => [c.kind, c.what, c.style]), [["changed", ["restyled"], ["fileId"]]]);
});
