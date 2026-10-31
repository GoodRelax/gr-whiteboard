"use strict";

// OperationLog (Use Case). Gives opIds, writes a Snapshot of the whole Board before each Operation,
// keeps the last `undoDepth` Operations, and runs `undo` (FR-102 to FR-106, spec 3.4.4).
// The Snapshot files are reached through a port, so tests can use a fake one:
//   store.write(opId, data)   throws when the file cannot be written
//   store.read(opId) -> data  throws when the file cannot be read
//   store.remove(opId)
//   store.readAll() -> { snapshots: [data], warnings: [text] }   broken files are kept aside by the store
//   store.readLastOpId() -> n    the last opId given out, 0 when unknown
//   store.writeLastOpId(n)       throws when the file cannot be written

const { AppError } = require("./app-error");
const { planUndo, undoConflicts } = require("./board-ops");

const SNAPSHOT_FILE_VERSION = 1;

// @purity non-pure
function createOperationLog({ store, undoDepth }) {
  // Oldest first. Each: { opId, kind, atMs, changed: [{ id, version }] }.
  const operations = [];
  let nextOpId = 1;

  // Reads the Snapshot files at start (FR-105). Returns the warnings (one BoardWarning each).
  // @purity non-pure
  function load() {
    const { snapshots, warnings } = store.readAll();
    const good = snapshots
      .filter((data) => data && Number.isInteger(data.opId) && data.opId > 0 && Array.isArray(data.changed))
      .sort((a, b) => a.opId - b.opId);
    for (const data of good) {
      operations.push(Object.freeze({ opId: data.opId, kind: String(data.kind), atMs: Number(data.atMs) || 0, changed: data.changed }));
      nextOpId = Math.max(nextOpId, data.opId + 1);
    }
    // An undone Operation leaves no Snapshot file, so its opId is kept apart and never given again (R-023).
    nextOpId = Math.max(nextOpId, store.readLastOpId() + 1);
    trim();
    return warnings;
  }

  // @purity non-pure
  function trim() {
    while (operations.length > undoDepth) {
      const oldest = operations.shift();
      try {
        store.remove(oldest.opId);
      } catch (error) {
        // A file that stays is harmless; the next start reads and trims it again.
      }
    }
  }

  // @purity non-pure
  function reserveOpId() {
    const opId = nextOpId;
    nextOpId += 1;
    try {
      store.writeLastOpId(opId);
    } catch (error) {
      // The Snapshot write of this Operation fails too (FR-106); a lost number only risks reuse after a restart.
    }
    return opId;
  }

  // Writes the Snapshot (the whole Board before the Operation) and keeps the Operation.
  // Throws SnapshotFailed (500) when the file cannot be written; the caller then must not apply it (FR-106).
  // @purity non-pure
  function record({ opId, kind, atMs, boardBefore, changed }) {
    const data = { v: SNAPSHOT_FILE_VERSION, opId, kind, atMs, elements: boardBefore, changed };
    try {
      store.write(opId, data);
    } catch (error) {
      throw new AppError("SnapshotFailed", 500, `cannot write the snapshot: ${error && error.message}`);
    }
    operations.push(Object.freeze({ opId, kind, atMs, changed }));
    nextOpId = Math.max(nextOpId, opId + 1);
    trim();
  }

  // Plans `undo` of the last Operation (FR-103, FR-104). Returns { operation, restored, restoredCount }
  // without changing anything; call `forget(opId)` after the caller applied it.
  // @purity non-pure
  function planLastUndo(elements, force, nowMs, nonce) {
    const operation = operations[operations.length - 1];
    if (!operation) throw new AppError("NothingToUndo", 409, "there is no operation to undo");
    const conflicts = undoConflicts(operation.changed, elements);
    if (conflicts.length > 0 && !force) {
      throw new AppError("UndoConflict", 409, `changed after the operation: ${conflicts.join(", ")}`, { ids: conflicts, opId: operation.opId });
    }
    let data;
    try {
      data = store.read(operation.opId);
    } catch (error) {
      throw new AppError("Internal", 500, `cannot read the snapshot of operation ${operation.opId}`);
    }
    const snapshot = new Map((Array.isArray(data && data.elements) ? data.elements : []).map((element) => [element.id, element]));
    const { restored, restoredCount } = planUndo(operation.changed, snapshot, elements, nowMs, nonce);
    // An Element that comes back as it was before this Operation is, for the earlier Operations,
    // the same as before; only its version is new. Without this, their undo would see a conflict.
    const rebase = restored
      .filter((element) => snapshot.has(element.id))
      .map((element) => ({ id: element.id, fromVersion: snapshot.get(element.id).version, toVersion: element.version }));
    return { operation, restored, restoredCount, forced: conflicts.length > 0, rebase };
  }

  // Removes the Operation after the caller applied its undo, and moves the expected versions of
  // earlier Operations along (`rebase` from planLastUndo), also in their Snapshot files.
  // @purity non-pure
  function forget(opId, rebase = []) {
    const index = operations.findIndex((operation) => operation.opId === opId);
    if (index < 0) return;
    operations.splice(index, 1);
    try {
      store.remove(opId);
    } catch (error) {
      // See trim().
    }
    const moves = new Map(rebase.map((entry) => [entry.id, entry]));
    for (let i = 0; i < operations.length; i += 1) {
      const operation = operations[i];
      let touched = false;
      const changed = operation.changed.map((entry) => {
        const move = moves.get(entry.id);
        if (!move || move.fromVersion !== entry.version) return entry;
        touched = true;
        return { id: entry.id, version: move.toVersion };
      });
      if (!touched) continue;
      operations[i] = Object.freeze({ ...operation, changed });
      try {
        store.write(operation.opId, { ...store.read(operation.opId), changed });
      } catch (error) {
        // The file keeps the old versions; after a restart, undo of that Operation asks for force.
      }
    }
  }

  return Object.freeze({
    load,
    reserveOpId,
    record,
    planLastUndo,
    forget,
    count: () => operations.length,
    list: () => operations.slice(),
  });
}

module.exports = { createOperationLog };
