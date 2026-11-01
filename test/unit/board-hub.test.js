"use strict";

// BoardHub with fake pages and a fake clock (spec 3.5).

const test = require("node:test");
const assert = require("node:assert/strict");
const { createBoardHub } = require("../../skills/debug-board-server/scripts/lib/board-hub");

// @purity non-pure
function fakeClock() {
  const timers = new Map();
  let nextId = 1;
  return {
    setTimeout(fn) {
      const id = nextId;
      nextId += 1;
      timers.set(id, fn);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    fireAll() {
      for (const [id, fn] of [...timers]) {
        timers.delete(id);
        fn();
      }
    },
  };
}

// @purity non-pure
function setup(initial = []) {
  const elements = new Map(initial.map((e) => [e.id, e]));
  const emitted = [];
  const clock = fakeClock();
  let changes = 0;
  const hub = createBoardHub({
    elements,
    events: { emit: (event) => emitted.push(event) },
    clock,
    jobTimeoutMs: 1000,
    gapPx: 40,
    onBoardChanged: () => { changes += 1; },
  });
  return { hub, elements, emitted, clock, changes: () => changes };
}

// @purity non-pure
function fakePage() {
  const got = [];
  return { got, send: (type, data) => got.push({ type, data }), last: (type) => got.filter((m) => m.type === type).pop() };
}

// @purity pure
function text(id, version, extra = {}) {
  return { id, type: "text", version, versionNonce: 1, x: 10, y: 20, width: 100, height: 25, text: id, updated: 1, ...extra };
}

// @purity pure
function answer(id) {
  return text(id, 1, { customData: { grwbKind: "answer" } });
}

test("the first page is the Leader and gets the whole Board (FR-034)", () => {
  const { hub, emitted } = setup([text("a", 1)]);
  const p1 = fakePage();
  const p2 = fakePage();
  hub.addPage("page-0001", p1.send);
  hub.addPage("page-0002", p2.send);
  assert.equal(p1.last("hello").data.leader, true);
  assert.equal(p2.last("hello").data.leader, false);
  assert.deepEqual(p2.last("hello").data.elements.map((e) => e.id), ["a"]);
  assert.deepEqual(emitted.map((e) => [e.event, e.pageCount]), [["PageJoined", 1], ["PageJoined", 2]]);
});

test("changed elements go to the other pages only (FR-020)", () => {
  const { hub, changes } = setup([text("a", 2)]);
  const p1 = fakePage();
  const p2 = fakePage();
  hub.addPage("page-0001", p1.send);
  hub.addPage("page-0002", p2.send);
  assert.equal(hub.receiveElements("page-0001", [text("a", 1), text("b", 1)], null), 1);
  assert.equal(p1.last("elements"), undefined);
  assert.deepEqual(p2.last("elements").data.elements.map((e) => e.id), ["b"]);
  assert.equal(changes(), 1);
});

test("editingIds collects the text each page is typing (FR-013)", () => {
  const { hub } = setup();
  hub.addPage("page-0001", fakePage().send);
  hub.addPage("page-0002", fakePage().send);
  hub.receiveElements("page-0001", [], "t1");
  hub.receiveElements("page-0002", [], null);
  assert.deepEqual([...hub.editingIds()], ["t1"]);
  hub.removePage("page-0001");
  assert.deepEqual([...hub.editingIds()], []);
});

test("an Answer waits for a page, then the Leader writes it below everything (FR-025, FR-030)", async () => {
  const { hub, emitted, elements } = setup([text("q", 1, { x: 300, y: 500 })]);
  const queued = hub.queueAnswer("hi", null);
  assert.equal(emitted.at(-1).event, "AnswerQueued");
  const leader = fakePage();
  const other = fakePage();
  hub.addPage("page-0001", leader.send);
  hub.addPage("page-0002", other.send);
  const job = leader.last("job").data;
  assert.deepEqual(job, { jobId: 1, kind: "answer", text: "hi", x: 300, y: 565 });
  hub.finishJob("page-0001", { jobId: 1, ok: true, elements: [answer("ans1"), text("not-an-answer", 1)] });
  const result = await queued.done;
  assert.deepEqual(result, { jobId: 1, ids: ["ans1"], x: 300, y: 565 });
  assert.equal(elements.has("ans1"), true);
  assert.equal(elements.has("not-an-answer"), false);
  assert.deepEqual(other.last("elements").data.elements.map((e) => e.id), ["ans1"]);
  assert.equal(emitted.at(-1).event, "AnswerPosted");
});

test("the first Answer on an empty Board starts inside the view", () => {
  const { hub } = setup();
  const leader = fakePage();
  hub.addPage("page-0001", leader.send);
  hub.queueAnswer("hi", null);
  assert.deepEqual([leader.last("job").data.x, leader.last("job").data.y], [100, 100]);
});

test("jobs run one at a time, in order (FR-027)", () => {
  const { hub } = setup();
  const leader = fakePage();
  hub.addPage("page-0001", leader.send);
  hub.queueAnswer("one", { x: 0, y: 0 });
  hub.queueAnswer("two", { x: 0, y: 0 });
  assert.equal(leader.got.filter((m) => m.type === "job").length, 1);
  hub.finishJob("page-0001", { jobId: 1, ok: true, elements: [answer("x1")] });
  assert.equal(leader.last("job").data.text, "two");
});

test("when the Leader leaves during a job, the next page becomes Leader and gets the job (FR-034)", () => {
  const { hub } = setup();
  const p1 = fakePage();
  const p2 = fakePage();
  hub.addPage("page-0001", p1.send);
  hub.addPage("page-0002", p2.send);
  hub.queueAnswer("hi", null);
  assert.equal(p1.last("job").data.jobId, 1);
  hub.removePage("page-0001");
  assert.equal(p2.last("role").data.leader, true);
  assert.equal(p2.last("job").data.jobId, 1);
});

test("a job that is not finished in time fails with JobTimeout", async () => {
  const { hub, clock, emitted } = setup();
  hub.addPage("page-0001", fakePage().send);
  const queued = hub.queueAnswer("hi", null);
  clock.fireAll();
  await assert.rejects(queued.done, { code: "JobTimeout" });
  assert.equal(emitted.at(-1).event, "AnswerFailed");
});

test("a reply from the wrong page or for another job is refused", () => {
  const { hub } = setup();
  hub.addPage("page-0001", fakePage().send);
  hub.addPage("page-0002", fakePage().send);
  hub.queueAnswer("hi", null);
  assert.throws(() => hub.finishJob("page-0002", { jobId: 1, ok: true }), { code: "UnknownJob" });
  assert.throws(() => hub.finishJob("page-0001", { jobId: 7, ok: true }), { code: "UnknownJob" });
});

test("a Screenshot needs an open page; its scale goes to the page (FR-031, FR-123)", async () => {
  const { hub } = setup();
  assert.throws(() => hub.requestShot(null), { code: "NoPage" });
  const leader = fakePage();
  hub.addPage("page-0001", leader.send);
  const shot = hub.requestShot("a", 0.5);
  assert.deepEqual(leader.last("job").data, { jobId: 1, kind: "shot", focusId: "a", scale: 0.5 });
  hub.finishJob("page-0001", { jobId: 1, ok: true, png: "iVBORw0KGgo" });
  assert.deepEqual(await shot.done, { png: "iVBORw0KGgo" });
});

test("close rejects waiting jobs and says bye", async () => {
  const { hub } = setup();
  const page = fakePage();
  const queued = hub.queueAnswer("hi", null);
  hub.close();
  await assert.rejects(queued.done, { code: "Stopping" });
  hub.addPage("page-0001", page.send);
  hub.close();
  assert.ok(page.last("bye"));
});

test("the Signal goes to every page and to new pages; an Answer sets waiting (FR-038, FR-039)", () => {
  const { hub } = setup();
  const p1 = fakePage();
  hub.addPage("page-0001", p1.send);
  assert.equal(p1.last("hello").data.signal, "none");
  hub.setSignal("reading");
  hub.setSignal("reading");
  assert.deepEqual(p1.got.filter((m) => m.type === "signal").map((m) => m.data.state), ["reading"]);
  const p2 = fakePage();
  hub.addPage("page-0002", p2.send);
  assert.equal(p2.last("hello").data.signal, "reading");
  hub.queueAnswer("hi", null);
  hub.finishJob("page-0001", { jobId: 1, ok: true, elements: [answer("a1")] });
  assert.equal(hub.signal(), "waiting");
  assert.equal(p2.last("signal").data.state, "waiting");
  assert.throws(() => hub.setSignal("dancing"), { code: "InvalidSignal" });
});

test("a page on screen is the Leader before a hidden page, and both hear of a change (FR-085)", () => {
  const { hub } = setup();
  const pc = fakePage();
  const pad = fakePage();
  hub.addPage("page-pc01", pc.send, true);
  hub.addPage("page-pad1", pad.send, true);
  assert.equal(pad.last("hello").data.leader, false);
  hub.setVisible("page-pc01", false);
  assert.deepEqual(pc.last("role").data, { leader: false });
  assert.deepEqual(pad.last("role").data, { leader: true });
  hub.setVisible("page-pc01", true);
  assert.deepEqual(pc.last("role").data, { leader: true });
  assert.deepEqual(pad.last("role").data, { leader: false });
});

test("a hidden page that joins does not take the Leader role; with no page on screen, the first page leads", () => {
  const { hub } = setup();
  const hidden = fakePage();
  const shown = fakePage();
  hub.addPage("page-hid1", hidden.send, false);
  assert.equal(hidden.last("hello").data.leader, true);
  hub.addPage("page-shw1", shown.send, true);
  assert.equal(shown.last("hello").data.leader, true);
  assert.deepEqual(hidden.last("role").data, { leader: false });
});

test("a job that times out goes once to another page, then fails (FR-086)", async () => {
  const { hub, clock, emitted } = setup();
  const frozen = fakePage();
  const awake = fakePage();
  hub.addPage("page-frz1", frozen.send, true);
  hub.addPage("page-awk1", awake.send, true);
  const queued = hub.queueAnswer("hi", null);
  assert.ok(frozen.last("job"));
  assert.equal(awake.last("job"), undefined);
  clock.fireAll();
  assert.ok(emitted.some((e) => e.event === "JobRetried"));
  const job = awake.last("job");
  assert.equal(job.data.text, "hi");
  assert.throws(() => hub.finishJob("page-frz1", { jobId: job.data.jobId, ok: true, elements: [] }), { code: "UnknownJob" });
  clock.fireAll();
  await assert.rejects(queued.done, { code: "JobTimeout" });
});

test("an Answer asked for at a covered place says where it went (FR-029, FR-120)", async () => {
  const { hub } = setup([text("msg", 1, { x: 0, y: 100, width: 200, height: 40 })]);
  const leader = fakePage();
  hub.addPage("page-0001", leader.send);
  const covered = hub.queueAnswer("hi", { x: 10, y: 110 });
  const job = leader.last("job").data;
  hub.finishJob("page-0001", { jobId: job.jobId, ok: true, elements: [answer("ans1")] });
  assert.deepEqual(await covered.done, { jobId: 1, ids: ["ans1"], x: 10, y: 180, requested: { x: 10, y: 110 }, moved: true });
  const free = hub.queueAnswer("hi", { x: 900.4, y: 0 });
  hub.finishJob("page-0001", { jobId: leader.last("job").data.jobId, ok: true, elements: [answer("ans2")] });
  const result = await free.done;
  assert.deepEqual([result.requested, result.moved], [{ x: 900, y: 0 }, false]);
});
