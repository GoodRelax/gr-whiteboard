"use strict";

// Covers every cell of the TrackedTextStateMachine table (spec 3.4.2).

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTrackerState, trackMessages } = require("../../skills/whiteboard-server/scripts/lib/message-tracker");

const SETTLE_MS = 1000;

// @purity pure
function text(id, value, extra = {}) {
  return { id, type: "text", x: 10.4, y: 20.6, width: 50, height: 25, text: value, containerId: null, updatedMs: 1, ...extra };
}

// @purity pure
function snap(items, editingId = null) {
  return { items, editingIds: new Set(editingId ? [editingId] : []) };
}

// @purity pure
function run(state, steps) {
  const events = [];
  let current = state;
  for (const [items, nowMs, editingId] of steps) {
    const result = trackMessages(current, snap(items, editingId), nowMs, SETTLE_MS);
    current = result.trackerState;
    events.push(...result.messageEvents);
  }
  return { state: current, events };
}

test("seeded text is not reported (FR-004)", () => {
  const state = createTrackerState([text("a", "old note")]);
  const { events } = run(state, [[[text("a", "old note")], 0], [[text("a", "old note")], 5000]]);
  assert.deepEqual(events, []);
});

test("New + TextChanged restarts the timer; Settled sends MessageReceived (FR-011)", () => {
  const { events } = run(createTrackerState([]), [
    [[text("a", "he")], 0],
    [[text("a", "hello")], 800],
    [[text("a", "hello")], 1700],
    [[text("a", "hello")], 1800],
  ]);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], { event: "MessageReceived", id: "a", text: "hello", x: 10, y: 21, inShape: false });
});

test("settleMs boundary: reported exactly at settleMs, not before", () => {
  const before = run(createTrackerState([]), [[[text("a", "x")], 0], [[text("a", "x")], SETTLE_MS - 1]]);
  assert.equal(before.events.length, 0);
  const at = run(createTrackerState([]), [[[text("a", "x")], 0], [[text("a", "x")], SETTLE_MS]]);
  assert.equal(at.events.length, 1);
});

test("settleMs 0 reports on first sight", () => {
  const result = trackMessages(createTrackerState([]), snap([text("a", "x")]), 0, 0);
  assert.equal(result.messageEvents.length, 1);
});

test("blank text is not reported (FR-015)", () => {
  const { events } = run(createTrackerState([]), [[[text("a", "   ")], 0], [[text("a", "   ")], 5000]]);
  assert.deepEqual(events, []);
});

test("blank first, then text: reported as MessageReceived", () => {
  const { events } = run(createTrackerState([]), [
    [[text("a", "")], 0],
    [[text("a", "hi")], 100],
    [[text("a", "hi")], 1100],
  ]);
  assert.deepEqual(events.map((e) => e.event), ["MessageReceived"]);
});

test("text that someone is typing is not reported (FR-013)", () => {
  const { events } = run(createTrackerState([]), [
    [[text("a", "hi")], 0, "a"],
    [[text("a", "hi")], 5000, "a"],
  ]);
  assert.deepEqual(events, []);
  const after = run(createTrackerState([]), [[[text("a", "hi")], 0, "a"], [[text("a", "hi")], 5000, null]]);
  assert.equal(after.events.length, 1);
});

test("Reported + TextChanged -> Changed; Settled sends MessageEdited (FR-012)", () => {
  const { events } = run(createTrackerState([text("a", "hello")]), [
    [[text("a", "hello world")], 0],
    [[text("a", "hello world")], 1000],
  ]);
  assert.deepEqual(events.map((e) => [e.event, e.text]), [["MessageEdited", "hello world"]]);
});

test("Changed + TextRestored -> Reported, no event (SC-016)", () => {
  const { events } = run(createTrackerState([text("a", "abc")]), [
    [[text("a", "abcd")], 0],
    [[text("a", "abc")], 500],
    [[text("a", "abc")], 5000],
  ]);
  assert.deepEqual(events, []);
});

test("Changed + TextChanged restarts the timer", () => {
  const { events } = run(createTrackerState([text("a", "a")]), [
    [[text("a", "ab")], 0],
    [[text("a", "abc")], 900],
    [[text("a", "abc")], 1500],
    [[text("a", "abc")], 1900],
  ]);
  assert.deepEqual(events.map((e) => e.text), ["abc"]);
});

test("ItemDeleted removes the entry (NFR-004)", () => {
  const { state } = run(createTrackerState([text("a", "x"), text("b", "y")]), [[[text("b", "y")], 0]]);
  assert.deepEqual([...state.entries.keys()], ["b"]);
});

test("text inside a shape has inShape true", () => {
  const { events } = run(createTrackerState([]), [[[text("a", "x", { containerId: "box" })], 0], [[text("a", "x", { containerId: "box" })], 1000]]);
  assert.equal(events[0].inShape, true);
});

test("more hand drawings send DrawingAdded once (FR-016)", () => {
  const draw = (id) => ({ id, type: "freedraw", x: 0, y: 0, width: 1, height: 1, text: null, containerId: null, updatedMs: 1 });
  const { events } = run(createTrackerState([draw("d1")]), [
    [[draw("d1"), draw("d2"), draw("d3")], 0],
    [[draw("d1"), draw("d2"), draw("d3")], 100],
    [[draw("d1")], 200],
  ]);
  assert.deepEqual(events, [{ event: "DrawingAdded", drawingCount: 3, added: 2 }]);
});

test("the old state is not changed", () => {
  const state = createTrackerState([]);
  trackMessages(state, snap([text("a", "x")]), 0, SETTLE_MS);
  assert.equal(state.entries.size, 0);
  assert.ok(Object.isFrozen(state));
});

test("text that arrives late but was changed before notBeforeMs is old (FR-009a)", () => {
  const state = createTrackerState([], 5000);
  const oldItem = text("a", "old talk", { updatedMs: 4000 });
  const newItem = text("b", "new talk", { updatedMs: 6000 });
  const { events } = run(state, [[[oldItem, newItem], 7000], [[oldItem, newItem], 9000]]);
  assert.deepEqual(events.map((e) => e.text), ["new talk"]);
});

test("old text that arrives late is reported when someone changes it later", () => {
  const state = createTrackerState([], 5000);
  const { events } = run(state, [
    [[text("a", "old", { updatedMs: 4000 })], 7000],
    [[text("a", "old, more", { updatedMs: 8000 })], 8000],
    [[text("a", "old, more", { updatedMs: 8000 })], 9000],
  ]);
  assert.deepEqual(events.map((e) => [e.event, e.text]), [["MessageEdited", "old, more"]]);
});

test("hand drawings older than notBeforeMs are not counted (FR-009a)", () => {
  const draw = (id, updatedMs) => ({ id, type: "freedraw", x: 0, y: 0, width: 1, height: 1, text: null, containerId: null, updatedMs });
  const { events } = run(createTrackerState([], 5000), [[[draw("d1", 1000), draw("d2", 6000)], 7000]]);
  assert.deepEqual(events, [{ event: "DrawingAdded", drawingCount: 1, added: 1 }]);
});
