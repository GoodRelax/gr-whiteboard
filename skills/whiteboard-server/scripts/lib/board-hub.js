"use strict";

// BoardHub (Use Case). Connects the open pages, keeps the Board in step between them,
// and gives Jobs (write an Answer, take a Screenshot) to the Leader page. See spec 3.5.
//
// The first page that connects is the Leader. When it leaves, the next page becomes the Leader (FR-034).
// Only the Leader writes Answers, because only a browser can measure text (ADR-003).
// Jobs run one at a time, in arrival order (FR-027).

const { AppError } = require("./app-error");
const { mergeElements, toItems, isElement, ANSWER_MARK } = require("./board-store");
const { placeAnswer, clearOfItems } = require("./answer-placement");

// On an empty Board, (0, 0) is under the menu of a new page. Start a little inside.
const EMPTY_BOARD_POINT = Object.freeze({ x: 100, y: 100 });

// @purity pure
function isAnswerElement(element) {
  return isElement(element) && element.customData && element.customData.whiteboardChat === ANSWER_MARK;
}

// elements: Map of id -> element (the Board). events: EventPort (emit).
// clock: { setTimeout, clearTimeout }. onBoardChanged(): called after the Board changed.
// @purity non-pure
function createBoardHub({ elements, events, clock, jobTimeoutMs, gapPx, onBoardChanged }) {
  // pageId -> { send(type, data), editingId }. A Map keeps the order in which pages joined.
  const pages = new Map();
  const jobs = [];
  let current = null;
  let nextJobId = 1;

  // @purity semi-pure-b
  function leaderId() {
    const first = pages.keys().next();
    return first.done ? null : first.value;
  }

  // @purity non-pure
  function sendTo(pageId, type, data) {
    const page = pages.get(pageId);
    if (page) page.send(type, data);
  }

  // @purity non-pure
  function broadcast(type, data, exceptId) {
    for (const [pageId, page] of pages) {
      if (pageId !== exceptId) page.send(type, data);
    }
  }

  // @purity semi-pure-b
  function answerPoint(job) {
    const items = toItems(elements);
    if (job.at) return clearOfItems(job.at, items, gapPx);
    if (items.length === 0) return EMPTY_BOARD_POINT;
    const answerIds = new Set(items.filter((item) => item.isAnswer).map((item) => item.id));
    return placeAnswer(items, answerIds, gapPx);
  }

  // @purity non-pure
  function pump() {
    if (current !== null || jobs.length === 0) return;
    const pageId = leaderId();
    if (pageId === null) return;
    current = jobs.shift();
    current.pageId = pageId;
    const payload = { jobId: current.id, kind: current.kind };
    if (current.kind === "answer") {
      const point = answerPoint(current);
      current.point = { x: Math.round(point.x), y: Math.round(point.y) };
      Object.assign(payload, { text: current.text, x: current.point.x, y: current.point.y });
    } else {
      payload.focusId = current.focusId;
    }
    current.timer = clock.setTimeout(() => endJob(new AppError("JobTimeout", 504, `the page did not finish job ${payload.jobId}`)), jobTimeoutMs);
    sendTo(pageId, "job", payload);
  }

  // @purity non-pure
  function endJob(error, result) {
    const job = current;
    if (job === null) return;
    clock.clearTimeout(job.timer);
    current = null;
    if (error) {
      if (job.kind === "answer") events.emit({ event: "AnswerFailed", jobId: job.id, error: error.code, message: error.message });
      job.reject(error);
    } else {
      job.resolve(result);
    }
    pump();
  }

  // @purity non-pure
  function addJob(job) {
    job.id = nextJobId;
    nextJobId += 1;
    const done = new Promise((resolve, reject) => {
      job.resolve = resolve;
      job.reject = reject;
    });
    // A caller may stop waiting (say answers 202 after a while); a later failure must not crash the Server.
    done.catch(() => {});
    jobs.push(job);
    pump();
    return { jobId: job.id, done };
  }

  // @purity non-pure
  function addPage(pageId, send) {
    pages.set(pageId, { send, editingId: null });
    const isLeader = leaderId() === pageId;
    send("hello", { pageId, leader: isLeader, elements: [...elements.values()] });
    events.emit({ event: "PageJoined", pageCount: pages.size });
    if (isLeader) pump();
  }

  // @purity non-pure
  function removePage(pageId) {
    const wasLeader = leaderId() === pageId;
    if (!pages.delete(pageId)) return;
    events.emit({ event: "PageLeft", pageCount: pages.size });
    if (!wasLeader) return;
    if (current !== null && current.pageId === pageId) {
      // The Leader left in the middle of a Job: give it to the next Leader.
      clock.clearTimeout(current.timer);
      jobs.unshift(current);
      current = null;
    }
    const next = leaderId();
    if (next !== null) sendTo(next, "role", { leader: true });
    pump();
  }

  // @purity non-pure
  function receiveElements(pageId, list, editingId) {
    const page = pages.get(pageId);
    if (page && editingId !== undefined) page.editingId = typeof editingId === "string" ? editingId : null;
    const changed = mergeElements(elements, Array.isArray(list) ? list : []);
    if (changed.length > 0) {
      broadcast("elements", { elements: changed }, pageId);
      onBoardChanged();
    }
    return changed.length;
  }

  // @purity semi-pure-b
  function editingIds() {
    const ids = new Set();
    for (const page of pages.values()) {
      if (page.editingId) ids.add(page.editingId);
    }
    return ids;
  }

  // @purity non-pure
  function queueAnswer(text, at) {
    const queued = addJob({ kind: "answer", text, at });
    if (current === null || current.id !== queued.jobId) {
      events.emit({ event: "AnswerQueued", jobId: queued.jobId, pageCount: pages.size });
    }
    return queued;
  }

  // @purity non-pure
  function requestShot(focusId) {
    if (pages.size === 0) throw new AppError("NoPage", 503, "no page is open; open the Board URL in a browser");
    return addJob({ kind: "shot", focusId: focusId || null });
  }

  // reply: { jobId, ok, elements, png, error } from the Leader page.
  // @purity non-pure
  function finishJob(pageId, reply) {
    if (current === null || !reply || reply.jobId !== current.id || pageId !== current.pageId) {
      throw new AppError("UnknownJob", 409, "this job is not running on this page");
    }
    if (!reply.ok) {
      endJob(new AppError("JobFailed", 502, String(reply.error || "the page could not do the job")));
      return;
    }
    if (current.kind === "shot") {
      endJob(null, { png: String(reply.png || "") });
      return;
    }
    const written = (Array.isArray(reply.elements) ? reply.elements : []).filter(isAnswerElement);
    const changed = mergeElements(elements, written);
    if (changed.length > 0) {
      broadcast("elements", { elements: changed }, pageId);
      onBoardChanged();
    }
    const result = { jobId: current.id, ids: written.map((element) => element.id), x: current.point.x, y: current.point.y };
    events.emit({ event: "AnswerPosted", ...result });
    endJob(null, result);
  }

  // @purity non-pure
  function close() {
    if (current !== null) clock.clearTimeout(current.timer);
    for (const job of current ? [current, ...jobs] : jobs) job.reject(new AppError("Stopping", 503, "the Server is stopping"));
    jobs.length = 0;
    current = null;
    broadcast("bye", {});
  }

  return Object.freeze({
    addPage,
    removePage,
    receiveElements,
    editingIds,
    queueAnswer,
    requestShot,
    finishJob,
    close,
    pageCount: () => pages.size,
    queueLength: () => jobs.length + (current ? 1 : 0),
  });
}

module.exports = { createBoardHub };
