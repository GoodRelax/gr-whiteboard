"use strict";

// BoardHub (Use Case). Connects the open pages, keeps the Board in step between them,
// and gives Jobs (write an Answer, take a Screenshot) to the Leader page. See spec 3.5.
//
// The Leader is the first page that is shown on screen; with no page on screen, the first page (FR-034, FR-085).
// A browser may freeze a page in a hidden tab, so a hidden page is a poor Leader.
// Only the Leader writes Answers, because only a browser can measure text (ADR-003).
// A Job that times out goes once to another page (FR-086).
// Jobs run one at a time, in arrival order (FR-027).
// The Signal ("reading", "working", "waiting", or "none") tells every page what Claude is doing (FR-038).

const { AppError } = require("./app-error");
const { mergeElements, toItems, isElement, ANSWER_MARK } = require("./board-store");
const { placeAnswer, clearOfItems, estimateSize } = require("./answer-placement");
const { addFiles } = require("./board-files");

// The font size that the page uses for Answers (page/app.js).
const ANSWER_FONT_SIZE_PX = 20;

const SIGNALS = Object.freeze(["none", "reading", "working", "waiting"]);

// On an empty Board, (0, 0) is under the menu of a new page. Start a little inside.
const EMPTY_BOARD_POINT = Object.freeze({ x: 100, y: 100 });

// @purity pure
function isAnswerElement(element) {
  return isElement(element) && element.customData && element.customData.whiteboardChat === ANSWER_MARK;
}

// elements: Map of id -> element (the Board). events: EventPort (emit).
// clock: { setTimeout, clearTimeout }. onBoardChanged(changed): called with the Elements that changed the Board.
// onAnswerWritten(elements): called with the Answer Elements that the Leader wrote.
// files: Map of id -> image file (FR-081). onFilesAdded(files): called with the new files, to save them.
// @purity non-pure
function createBoardHub({
  elements, events, clock, jobTimeoutMs, gapPx, indentPx = 0, onBoardChanged, onAnswerWritten = () => {},
  files = new Map(), onFilesAdded = () => {},
}) {
  // pageId -> { send(type, data), editingId, visible }. A Map keeps the order in which pages joined.
  const pages = new Map();
  // A Job goes to at most this many pages before it fails.
  const JOB_TRIES = 2;
  const jobs = [];
  let current = null;
  let nextJobId = 1;
  let signal = "none";
  // What the Send button shows on every page (FR-071, FR-074).
  let inbox = Object.freeze({ unsent: 0, autoSend: false });

  // The first page on screen, else the first page, leaving out the pages in `skip`.
  // @purity semi-pure-b
  function pickPage(skip = new Set()) {
    let fallback = null;
    for (const [pageId, page] of pages) {
      if (skip.has(pageId)) continue;
      if (page.visible) return pageId;
      if (fallback === null) fallback = pageId;
    }
    return fallback;
  }

  // @purity semi-pure-b
  function leaderId() {
    return pickPage();
  }

  // Tells the old and the new Leader when the Leader changed. `toldId` already knows (it got hello).
  // @purity non-pure
  function announceLeader(before, toldId = null) {
    const after = leaderId();
    if (after === before) return;
    if (before !== null && pages.has(before)) sendTo(before, "role", { leader: false });
    if (after !== null && after !== toldId) sendTo(after, "role", { leader: true });
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
    const size = estimateSize(job.text, ANSWER_FONT_SIZE_PX);
    if (job.at) return clearOfItems(job.at, items, gapPx, size);
    if (items.length === 0) return EMPTY_BOARD_POINT;
    const answerIds = new Set(items.filter((item) => item.isAnswer).map((item) => item.id));
    return placeAnswer(items, answerIds, gapPx, indentPx, size);
  }

  // @purity non-pure
  function pump() {
    if (current !== null || jobs.length === 0) return;
    const pageId = pickPage(jobs[0].tried);
    if (pageId === null) return;
    current = jobs.shift();
    current.pageId = pageId;
    current.tried.add(pageId);
    const payload = { jobId: current.id, kind: current.kind };
    if (current.kind === "answer") {
      const point = answerPoint(current);
      current.point = { x: Math.round(point.x), y: Math.round(point.y) };
      Object.assign(payload, { text: current.text, x: current.point.x, y: current.point.y });
    } else {
      payload.focusId = current.focusId;
    }
    current.timer = clock.setTimeout(() => timeOut(payload.jobId), jobTimeoutMs);
    sendTo(pageId, "job", payload);
  }

  // A page did not finish the Job in time: give it once to another page (FR-086), else fail.
  // @purity non-pure
  function timeOut(jobId) {
    const job = current;
    if (job === null || job.id !== jobId) return;
    if (job.tried.size < JOB_TRIES && pickPage(job.tried) !== null) {
      events.emit({ event: "JobRetried", jobId, kind: job.kind });
      current = null;
      jobs.unshift(job);
      pump();
      return;
    }
    endJob(new AppError("JobTimeout", 504, `the page did not finish job ${jobId}`));
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
    job.tried = new Set();
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
  // visible: whether the page is shown on screen now (a page that does not say counts as shown).
  // @purity non-pure
  function addPage(pageId, send, visible = true) {
    const before = leaderId();
    pages.set(pageId, { send, editingId: null, visible: visible !== false });
    const isLeader = leaderId() === pageId;
    send("hello", { pageId, leader: isLeader, signal, inbox, elements: [...elements.values()], files: [...files.values()] });
    events.emit({ event: "PageJoined", pageCount: pages.size });
    announceLeader(before, pageId);
    pump();
  }

  // @purity non-pure
  function removePage(pageId) {
    const before = leaderId();
    if (!pages.delete(pageId)) return;
    events.emit({ event: "PageLeft", pageCount: pages.size });
    if (current !== null && current.pageId === pageId) {
      // The page left in the middle of a Job: give the Job to the next page.
      clock.clearTimeout(current.timer);
      current.tried.delete(pageId);
      jobs.unshift(current);
      current = null;
    }
    announceLeader(before === pageId ? null : before);
    pump();
  }

  // A page was shown or hidden (FR-085). The Leader may change.
  // @purity non-pure
  function setVisible(pageId, visible) {
    const page = pages.get(pageId);
    if (!page) return;
    const before = leaderId();
    page.visible = visible === true;
    announceLeader(before);
    pump();
  }

  // @purity non-pure
  function receiveElements(pageId, list, editingId) {
    const page = pages.get(pageId);
    if (page && editingId !== undefined) page.editingId = typeof editingId === "string" ? editingId : null;
    const changed = mergeElements(elements, Array.isArray(list) ? list : []);
    if (changed.length > 0) {
      broadcast("elements", { elements: changed }, pageId);
      onBoardChanged(changed);
    }
    return changed.length;
  }

  // New image files from a page go to the other pages (FR-081). Returns { added, rejected }.
  // @purity non-pure
  function receiveFiles(pageId, list) {
    const result = addFiles(files, list);
    if (result.added.length > 0) {
      broadcast("files", { files: result.added }, pageId);
      onFilesAdded(result.added);
    }
    for (const bad of result.rejected) events.emit({ event: "FileRejected", id: bad.id, reason: bad.reason });
    return { added: result.added.length, rejected: result.rejected };
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
      onBoardChanged(changed);
    }
    onAnswerWritten(written);
    const result = { jobId: current.id, ids: written.map((element) => element.id), x: current.point.x, y: current.point.y };
    events.emit({ event: "AnswerPosted", ...result });
    // An Answer ends Claude's turn (FR-039).
    setSignal("waiting");
    endJob(null, result);
  }

  // @purity non-pure
  function setInbox(unsent, autoSend) {
    if (unsent === inbox.unsent && autoSend === inbox.autoSend) return;
    inbox = Object.freeze({ unsent, autoSend });
    broadcast("inbox", inbox);
  }

  // @purity non-pure
  function setSignal(state) {
    if (!SIGNALS.includes(state)) throw new AppError("InvalidSignal", 400, `signal must be one of ${SIGNALS.join(", ")}`);
    if (state === signal) return;
    signal = state;
    broadcast("signal", { state });
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
    setVisible,
    receiveElements,
    receiveFiles,
    editingIds,
    queueAnswer,
    requestShot,
    finishJob,
    setSignal,
    signal: () => signal,
    setInbox,
    inbox: () => inbox,
    close,
    pageCount: () => pages.size,
    queueLength: () => jobs.length + (current ? 1 : 0),
  });
}

module.exports = { createBoardHub };
