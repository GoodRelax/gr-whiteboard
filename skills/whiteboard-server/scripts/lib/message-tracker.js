"use strict";

// MessageTracker (Entity). Decides which Text Items are new or changed Messages.
// See spec 3.4.2 (TrackedTextStateMachine).

const EVENT = Object.freeze({
  MESSAGE_RECEIVED: "MessageReceived",
  MESSAGE_EDITED: "MessageEdited",
  DRAWING_ADDED: "DrawingAdded",
});

// @purity pure
function isBlank(text) {
  return typeof text !== "string" || text.trim() === "";
}

// A Drawing is every Item that is not text: pen lines, shapes, arrows, lines (FR-016).
// @purity pure
function isDrawing(item) {
  return item.type !== "text";
}

// Counts Drawings that are not old (see notBeforeMs below).
// @purity pure
function countDrawings(items, notBeforeMs) {
  return items.filter((item) => isDrawing(item) && !(item.updatedMs < notBeforeMs)).length;
}

// @purity pure
function freezeEntry(reportedText, pendingText, pendingSinceMs) {
  return Object.freeze({ reportedText, pendingText, pendingSinceMs });
}

// Marks every Text Item in `items` as already reported (FR-004).
// A Text Item that first appears later but was last changed before `notBeforeMs` is also old (FR-009a):
// an open page can send its Board again after the Server restarts.
// @purity pure
function createTrackerState(items, notBeforeMs = -Infinity) {
  const entries = new Map();
  for (const item of items) {
    if (item.type === "text") entries.set(item.id, freezeEntry(item.text, null, 0));
  }
  return Object.freeze({ entries, drawingCount: countDrawings(items, notBeforeMs), notBeforeMs });
}

// @purity pure
function messageEvent(eventName, item) {
  return Object.freeze({
    event: eventName,
    id: item.id,
    text: item.text,
    x: Math.round(item.x),
    y: Math.round(item.y),
    inShape: item.containerId !== null,
  });
}

// Moves one entry through TextChanged / TextRestored (no Settled yet).
// @purity pure
function applyText(entry, item, nowMs, notBeforeMs) {
  const text = item.text;
  if (!entry) {
    return item.updatedMs < notBeforeMs ? freezeEntry(text, null, 0) : freezeEntry(null, text, nowMs);
  }
  if (text === entry.reportedText) return freezeEntry(entry.reportedText, null, 0);
  if (text !== entry.pendingText) return freezeEntry(entry.reportedText, text, nowMs);
  return entry;
}

// @purity pure
function isSettled(entry, nowMs, settleMs) {
  return entry.pendingText !== null && nowMs - entry.pendingSinceMs >= settleMs;
}

// `snapshot.items` MUST NOT contain Answers; the caller removes them (FR-014).
// `snapshot.editingIds` is a Set of the Text Items that someone is typing now (FR-013).
// Returns a new state and the events to send. The old state is not changed.
// @purity pure
function trackMessages(state, snapshot, nowMs, settleMs) {
  const entries = new Map();
  const messageEvents = [];
  for (const item of snapshot.items) {
    if (item.type !== "text") continue;
    let entry = applyText(state.entries.get(item.id), item, nowMs, state.notBeforeMs);
    const canReport = !snapshot.editingIds.has(item.id) && !isBlank(item.text);
    if (isSettled(entry, nowMs, settleMs) && canReport) {
      const eventName = entry.reportedText === null ? EVENT.MESSAGE_RECEIVED : EVENT.MESSAGE_EDITED;
      messageEvents.push(messageEvent(eventName, item));
      entry = freezeEntry(item.text, null, 0);
    }
    entries.set(item.id, entry);
  }
  const drawingCount = countDrawings(snapshot.items, state.notBeforeMs);
  if (drawingCount > state.drawingCount) {
    messageEvents.push(Object.freeze({
      event: EVENT.DRAWING_ADDED,
      drawingCount,
      added: drawingCount - state.drawingCount,
    }));
  }
  return { trackerState: Object.freeze({ entries, drawingCount, notBeforeMs: state.notBeforeMs }), messageEvents };
}

module.exports = { EVENT, createTrackerState, trackMessages };
