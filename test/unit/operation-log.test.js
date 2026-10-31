"use strict";

// OperationLog with a fake Snapshot file port: every cell of the table in spec 3.4.4, plus FR-105 and FR-106.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createOperationLog } = require("../../skills/whiteboard-server/scripts/lib/operation-log");
const { createSnapshotStore } = require("../../skills/whiteboard-server/scripts/lib/data-files");

// @purity non-pure
function fakeStore(initial = [], { failWrite = false, lastOpId = 0 } = {}) {
  const files = new Map(initial.map((data) => [data.opId, data]));
  return {
    files,
    lastOpId,
    readLastOpId() {
      return this.lastOpId;
    },
    writeLastOpId(opId) {
      if (failWrite) throw new Error("disk full");
      this.lastOpId = opId;
    },
    write(opId, data) {
      if (failWrite) throw new Error("disk full");
      files.set(opId, JSON.parse(JSON.stringify(data)));
    },
    read(opId) {
      if (!files.has(opId)) throw new Error("no file");
      return files.get(opId);
    },
    remove(opId) {
      files.delete(opId);
    },
    readAll() {
      return { snapshots: [...files.values()], warnings: [] };
    },
  };
}

// @purity pure
function el(id, version, extra = {}) {
  return { id, type: "rectangle", version, versionNonce: 1, isDeleted: false, x: 0, y: 0, width: 10, height: 10, ...extra };
}

// @purity pure
function errorOf(fn) {
  try {
    fn();
  } catch (error) {
    return { code: error.code, ...(error.details || {}) };
  }
  return null;
}

test("Empty: undo replies NothingToUndo; OperationApplied writes the Snapshot and holds it (3.4.4)", () => {
  const store = fakeStore();
  const log = createOperationLog({ store, undoDepth: 20 });
  assert.deepEqual(log.load(), []);
  assert.equal(log.count(), 0);
  assert.deepEqual(errorOf(() => log.planLastUndo(new Map(), false, 1, () => 1)), { code: "NothingToUndo" });
  const opId = log.reserveOpId();
  assert.equal(opId, 1);
  log.record({ opId, kind: "draw", atMs: 5, boardBefore: [el("old", 1)], changed: [{ id: "web", version: 1 }] });
  assert.equal(log.count(), 1);
  assert.deepEqual(store.files.get(1), {
    v: 1, opId: 1, kind: "draw", atMs: 5, elements: [el("old", 1)], changed: [{ id: "web", version: 1 }],
  });
});

test("Holding: OperationApplied above undoDepth removes the oldest Operation and its file (FR-102, SC-086)", () => {
  const store = fakeStore();
  const log = createOperationLog({ store, undoDepth: 20 });
  for (let i = 0; i < 21; i += 1) {
    const opId = log.reserveOpId();
    log.record({ opId, kind: "delete", atMs: i, boardBefore: [], changed: [] });
  }
  assert.equal(log.count(), 20);
  assert.equal(store.files.has(1), false, "the oldest Snapshot file is gone");
  assert.deepEqual([...store.files.keys()].sort((a, b) => a - b)[0], 2);
});

test("Holding: undo with more than one left stays Holding; with one left becomes Empty (3.4.4)", () => {
  const store = fakeStore();
  const log = createOperationLog({ store, undoDepth: 20 });
  log.record({ opId: log.reserveOpId(), kind: "draw", atMs: 1, boardBefore: [], changed: [{ id: "a", version: 1 }] });
  log.record({ opId: log.reserveOpId(), kind: "draw", atMs: 2, boardBefore: [el("a", 1)], changed: [{ id: "b", version: 1 }] });
  const elements = new Map([["a", el("a", 1)], ["b", el("b", 1)]]);
  const first = log.planLastUndo(elements, false, 9, () => 3);
  assert.equal(first.operation.opId, 2);
  assert.deepEqual(first.restored.map((e) => [e.id, e.isDeleted, e.version]), [["b", true, 2]]);
  log.forget(2);
  assert.equal(log.count(), 1);
  assert.equal(store.files.has(2), false);
  const second = log.planLastUndo(elements, false, 9, () => 3);
  assert.equal(second.operation.opId, 1);
  log.forget(1);
  assert.equal(log.count(), 0);
  assert.equal(errorOf(() => log.planLastUndo(elements, false, 9, () => 3)).code, "NothingToUndo");
});

test("Holding: UndoConflict without force changes nothing; force undoes all (FR-104, SC-088)", () => {
  const store = fakeStore();
  const log = createOperationLog({ store, undoDepth: 20 });
  log.record({ opId: log.reserveOpId(), kind: "draw", atMs: 1, boardBefore: [], changed: [{ id: "web", version: 1 }] });
  const elements = new Map([["web", el("web", 2, { strokeColor: "#e03131" })]]);
  assert.deepEqual(errorOf(() => log.planLastUndo(elements, false, 9, () => 3)), { code: "UndoConflict", ids: ["web"], opId: 1 });
  assert.equal(log.count(), 1);
  assert.equal(store.files.has(1), true);
  const forced = log.planLastUndo(elements, true, 9, () => 3);
  assert.equal(forced.forced, true);
  assert.deepEqual(forced.restored.map((e) => [e.id, e.isDeleted, e.version]), [["web", true, 3]]);
});

test("undo of a later Operation moves the expected versions of earlier ones, also in their files (FR-104)", () => {
  const store = fakeStore();
  const log = createOperationLog({ store, undoDepth: 20 });
  log.record({ opId: log.reserveOpId(), kind: "draw", atMs: 1, boardBefore: [], changed: [{ id: "db", version: 1 }] });
  log.record({ opId: log.reserveOpId(), kind: "edit", atMs: 2, boardBefore: [el("db", 1)], changed: [{ id: "db", version: 2 }] });
  const elements = new Map([["db", el("db", 2, { y: 200 })]]);
  const plan = log.planLastUndo(elements, false, 9, () => 3);
  elements.set("db", plan.restored[0]);
  log.forget(2, plan.rebase);
  assert.deepEqual(log.list()[0].changed, [{ id: "db", version: 3 }]);
  assert.deepEqual(store.files.get(1).changed, [{ id: "db", version: 3 }]);
  assert.equal(log.planLastUndo(elements, false, 9, () => 3).forced, false, "no false UndoConflict");
});

test("a Snapshot that cannot be written ends with SnapshotFailed and keeps nothing (FR-106)", () => {
  const log = createOperationLog({ store: fakeStore([], { failWrite: true }), undoDepth: 20 });
  const opId = log.reserveOpId();
  assert.equal(errorOf(() => log.record({ opId, kind: "delete", atMs: 1, boardBefore: [], changed: [] })).code, "SnapshotFailed");
  assert.equal(log.count(), 0);
});

test("at start, Snapshot files come back and the next opId is the largest + 1 (FR-105, SC-090)", () => {
  const files = [5, 7, 6].map((opId) => ({ v: 1, opId, kind: "draw", atMs: opId, elements: [], changed: [] }));
  const log = createOperationLog({ store: fakeStore(files), undoDepth: 2 });
  log.load();
  assert.deepEqual(log.list().map((op) => op.opId), [6, 7], "only the last undoDepth are kept");
  assert.equal(log.reserveOpId(), 8);
});

test("an undone opId is not given again after a restart (R-023, SC-090)", () => {
  const files = [5, 6].map((opId) => ({ v: 1, opId, kind: "draw", atMs: opId, elements: [], changed: [] }));
  const store = fakeStore(files, { lastOpId: 7 });
  const log = createOperationLog({ store, undoDepth: 20 });
  log.load();
  assert.equal(log.reserveOpId(), 8, "opId 7 was undone; its file is gone, but its number stays used");
  assert.equal(store.lastOpId, 8);
});

test("the Snapshot store writes files, renames a broken one, and reports it (FR-102, FR-105)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wbc-snap-"));
  const store = createSnapshotStore(path.join(dir, "snapshots"), () => 1234);
  assert.deepEqual(store.readAll(), { snapshots: [], warnings: [] }, "no folder yet");
  store.write(3, { v: 1, opId: 3, kind: "edit", atMs: 1, elements: [], changed: [] });
  fs.writeFileSync(path.join(dir, "snapshots", "4.json"), "{broken");
  const { snapshots, warnings } = store.readAll();
  assert.deepEqual(snapshots.map((s) => s.opId), [3]);
  assert.equal(warnings.length, 1);
  assert.ok(fs.existsSync(path.join(dir, "snapshots", "4.json.broken-1234")));
  assert.equal(store.read(3).kind, "edit");
  store.remove(3);
  assert.equal(fs.existsSync(path.join(dir, "snapshots", "3.json")), false);
  assert.equal(store.readLastOpId(), 0, "no file yet");
  store.writeLastOpId(9);
  assert.equal(store.readLastOpId(), 9);
  assert.deepEqual(store.readAll().snapshots, [], "the last-opId file is not a Snapshot");
});
