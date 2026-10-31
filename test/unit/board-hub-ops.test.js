"use strict";

// BoardHub runs draw, edit, and mermaid Jobs (0.5.0) with fake pages and a fake clock.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createBoardHub } = require("../../skills/whiteboard-server/scripts/lib/board-hub");
const { AppError } = require("../../skills/whiteboard-server/scripts/lib/app-error");
const { summarizeBoard, diffBoards } = require("../../skills/whiteboard-server/scripts/lib/board-diff");
const { toItems } = require("../../skills/whiteboard-server/scripts/lib/board-store");

// @purity non-pure
function fakeClock() {
  const timers = new Map();
  let nextId = 1;
  return {
    timers,
    setTimeout(fn, ms) {
      const id = nextId;
      nextId += 1;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
}

// @purity non-pure
function fakePage() {
  const got = [];
  return { got, send: (type, data) => got.push({ type, data }), last: (type) => got.filter((m) => m.type === type).pop() };
}

// @purity non-pure
function setup(applyOperation, initial = []) {
  const elements = new Map(initial.map((e) => [e.id, e]));
  const emitted = [];
  const clock = fakeClock();
  const hub = createBoardHub({
    elements, events: { emit: (event) => emitted.push(event) }, clock, jobTimeoutMs: 1000, gapPx: 12, indentPx: 170,
    onBoardChanged: () => {}, applyOperation,
  });
  return { hub, elements, emitted, clock };
}

// @purity pure
function el(id, extra = {}) {
  return { id, type: "rectangle", version: 1, versionNonce: 1, x: 0, y: 0, width: 50, height: 50, updated: 1, ...extra };
}

test("draw, edit, and mermaid fail at once with NoPage when no page is open (FR-087, FR-093, FR-097, SC-073)", () => {
  const { hub } = setup(() => ({ changed: [], result: {} }));
  for (const kind of ["draw", "edit", "mermaid"]) {
    assert.throws(() => hub.queueOperation({ kind }, () => 1), (error) => error.code === "NoPage" && error.status === 503);
  }
  assert.equal(hub.queueLength(), 0, "the queue stays empty");
});

test("a draw Job goes to the Leader with the Origin; the result is applied and other pages get it (FR-089, FR-090)", async () => {
  const added = el("web", { customData: { whiteboardChat: "claude" } });
  const { hub, emitted } = setup((job, reply) => ({ changed: reply.elements, result: { opId: job.opId, ids: ["web"], count: 1 } }));
  const leader = fakePage();
  const other = fakePage();
  hub.addPage("pageAAAA1", leader.send);
  hub.addPage("pageBBBB2", other.send);
  const { done } = hub.queueOperation({ kind: "draw", elements: [{ id: "web", type: "rectangle", x: 0, y: 0 }], at: { x: 200, y: 300 }, boardTargets: [] }, () => 7);
  const job = leader.last("job").data;
  assert.deepEqual([job.kind, job.opId, job.x, job.y, job.boardIds], ["draw", 7, 200, 300, []]);
  hub.finishJob("pageAAAA1", { jobId: job.jobId, ok: true, elements: [added] });
  assert.deepEqual(await done, { jobId: job.jobId, opId: 7, ids: ["web"], count: 1 });
  assert.deepEqual(other.last("elements").data.elements, [added]);
  assert.equal(leader.last("elements"), undefined, "the Leader already has its own drawing");
  assert.deepEqual(emitted.filter((e) => e.event === "OperationApplied"), [{ event: "OperationApplied", opId: 7, kind: "draw", count: 1 }]);
});

test("a mermaid Job gets twice jobTimeoutMs; a mermaid failure code gives 422 (FR-094, FR-096)", async () => {
  const { hub, clock, emitted } = setup(() => ({ changed: [], result: {} }));
  const leader = fakePage();
  hub.addPage("pageAAAA1", leader.send);
  const { done } = hub.queueOperation({ kind: "mermaid", source: "graph LR; A -->", at: null }, () => 1);
  assert.deepEqual([...clock.timers.values()].map((t) => t.ms), [2000]);
  const job = leader.last("job").data;
  assert.deepEqual([job.source, job.x, job.y], ["graph LR; A -->", 100, 100]);
  hub.finishJob("pageAAAA1", { jobId: job.jobId, ok: false, code: "MermaidError", error: "Parse error ".repeat(50) });
  await assert.rejects(done, (error) => error.code === "MermaidError" && error.status === 422 && error.message.length === 300);
  assert.equal(emitted.find((e) => e.event === "OperationFailed").error, "MermaidError");
});

test("an edit Job carries its changes; a failed result handling ends the Job and refuses the page with 409 (FR-099, FR-106)", async () => {
  const { hub, emitted } = setup(() => {
    throw new AppError("SnapshotFailed", 500, "disk full");
  }, [el("web")]);
  const leader = fakePage();
  hub.addPage("pageAAAA1", leader.send);
  const { done } = hub.queueOperation({ kind: "edit", changes: [{ id: "web", dx: 5 }] }, () => 3);
  const job = leader.last("job").data;
  assert.deepEqual(job.changes, [{ id: "web", dx: 5 }]);
  assert.throws(() => hub.finishJob("pageAAAA1", { jobId: job.jobId, ok: true, elements: [] }),
    (error) => error.code === "SnapshotFailed" && error.status === 409);
  await assert.rejects(done, (error) => error.code === "SnapshotFailed" && error.status === 500);
  assert.equal(emitted.find((e) => e.event === "OperationFailed").kind, "edit");
  assert.equal(hub.queueLength(), 0);
});

test("applyServerChanges merges and sends to every page, the Leader too (FR-100, FR-103)", () => {
  const { hub, elements } = setup(null, [el("web")]);
  const leader = fakePage();
  hub.addPage("pageAAAA1", leader.send);
  const deleted = el("web", { version: 2, isDeleted: true });
  assert.deepEqual(hub.applyServerChanges([deleted, el("web", { version: 1 })]), [deleted]);
  assert.equal(elements.get("web").isDeleted, true);
  assert.deepEqual(leader.last("elements").data.elements, [deleted]);
});

test("Claude Items are by Claude; a Person's later move is listed with byClaude true (FR-091, FR-092, FR-108, SC-075)", () => {
  const web = el("web", { customData: { whiteboardChat: "claude" }, strokeColor: "#1971c2", backgroundColor: "transparent" });
  const arrow = el("w2d", { type: "arrow", startBinding: { elementId: "web" }, endBinding: { elementId: "db" } });
  const items = toItems(new Map([["web", web], ["w2d", arrow]]));
  assert.deepEqual([items[0].byClaude, items[0].isAnswer, items[0].strokeColor, items[0].backgroundColor], [true, false, "#1971c2", "transparent"]);
  assert.deepEqual([items[1].startId, items[1].endId, items[1].byClaude], ["web", "db", false]);
  assert.equal("startId" in items[0], false, "only arrows and lines have startId");
  const label = el("lbl", { type: "text", text: "Web", containerId: "web", customData: { whiteboardChat: "claude" } });
  const fresh = diffBoards(new Map(), summarizeBoard([label]), new Map(), new Set());
  assert.deepEqual(fresh.messages, [], "a Claude text is never a Message");
  const before = summarizeBoard([web]);
  const after = summarizeBoard([{ ...web, x: 100, version: 2 }]);
  assert.deepEqual(diffBoards(before, after, new Map(), new Set()).changes.map((c) => [c.kind, c.id, c.what, c.byClaude]),
    [["changed", "web", ["moved"], true]]);
});
