// Whiteboard page. Shows the Excalidraw component, keeps the Board in step with the Server,
// and, on the Leader page, writes Answers and takes Screenshots (spec 3.6).
// Plain browser module: no build step. React and Excalidraw come from esm.sh (see the import map).

import React from "react";
import { createRoot } from "react-dom/client";
import {
  Excalidraw,
  CaptureUpdateAction,
  convertToExcalidrawElements,
  exportToBlob,
  newElementWith,
  reconcileElements,
  restoreElements,
} from "@excalidraw/excalidraw";

const h = React.createElement;
const FLUSH_MS = 150;
const RETRY_MS = 1000;
const ANSWER_COLOR = "#1971c2";
const ANSWER_FONT_SIZE = 20;
const ANSWER_MARK = "answer";
const SHOT_BOX = Object.freeze({ width: 1600, height: 1000 });
const SHOT_MAX_PX = 2000;
// The fonts of Answers: Excalifont, and Xiaolai for Chinese and Japanese characters.
const ANSWER_FONT = `${ANSWER_FONT_SIZE}px Excalifont, Xiaolai`;
// The Server sends "ping" every 20 s. Without any message for this long, open the stream again (FR-023a).
const STREAM_STALE_MS = 50000;
const WATCH_STREAM_MS = 5000;
// Time for Excalidraw to finish the text after the editor loses focus.
const BLUR_WAIT_MS = 50;
const BLUR_TRIES = 20;
// Every label is "Claude: <verb> <object>", so it is clear who does what (the owner's rule).
const SIGNAL_TEXT = Object.freeze({
  reading: "Claude: reading your text",
  working: "Claude: working on it",
  waiting: "Claude: waiting for you",
});

const token = new URLSearchParams(window.location.hash.slice(1)).get("t") || "";
const pageId = randomId();

let api = null;
let isLeader = false;
let firstHello = true;
let editingId = null;
let editingChanged = false;
let flushTimer = null;
let source = null;
let lastStreamMs = 0;
let reopenTimer = null;
let status = { online: false, leader: false, signal: "none", unsent: 0, autoSend: false };
let sending = false;
let showStatus = () => {};
// id -> the version that the Server has (sent by us or received from it).
const known = new Map();
// id -> element changed here and not sent yet.
const pending = new Map();
// Ids of image files that the Server has (sent by us or received from it) (FR-081).
const knownFiles = new Set();
let filesRetryTimer = null;

function randomId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function showNotice(text) {
  const notice = document.getElementById("notice");
  notice.textContent = text;
  notice.style.display = "flex";
}

async function post(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-board-token": token },
    body: JSON.stringify({ page: pageId, ...body }),
  });
  if (!res.ok) {
    const error = new Error(`${path}: HTTP ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

function scheduleFlush(delayMs) {
  if (flushTimer === null) flushTimer = setTimeout(flush, delayMs);
}

async function flush() {
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = null;
  if (pending.size === 0 && !editingChanged) return;
  const list = [...pending.values()];
  pending.clear();
  editingChanged = false;
  for (const element of list) known.set(element.id, element.version);
  try {
    await post("/api/elements", { elements: list, editingId });
  } catch (error) {
    // Send them again later, unless they changed again in the meantime.
    for (const element of list) {
      if (known.get(element.id) === element.version) known.delete(element.id);
      if (!pending.has(element.id)) pending.set(element.id, element);
    }
    editingChanged = true;
    scheduleFlush(RETRY_MS);
  }
}

function collectChanges() {
  if (!api) return;
  for (const element of api.getSceneElementsIncludingDeleted()) {
    if (known.get(element.id) !== element.version) pending.set(element.id, element);
  }
  if (pending.size > 0) scheduleFlush(FLUSH_MS);
}

// Sends the image files that the Server does not have yet (FR-081).
async function sendNewFiles() {
  if (!api) return;
  const list = Object.values(api.getFiles()).filter((file) => !knownFiles.has(file.id));
  if (list.length === 0) return;
  for (const file of list) knownFiles.add(file.id);
  const body = list.map((file) => ({ id: file.id, mimeType: file.mimeType, dataURL: file.dataURL, created: file.created }));
  try {
    await post("/api/files", { files: body });
  } catch (error) {
    for (const file of list) knownFiles.delete(file.id);
    if (filesRetryTimer === null) {
      filesRetryTimer = setTimeout(() => {
        filesRetryTimer = null;
        sendNewFiles();
      }, RETRY_MS);
    }
  }
}

function applyRemoteFiles(list) {
  if (!api || !Array.isArray(list) || list.length === 0) return;
  for (const file of list) knownFiles.add(file.id);
  api.addFiles(list);
}

function onChange(elements, appState) {
  const nowEditing = appState.editingTextElement ? appState.editingTextElement.id : null;
  if (nowEditing !== editingId) {
    editingId = nowEditing;
    editingChanged = true;
    scheduleFlush(FLUSH_MS);
  }
  collectChanges();
  sendNewFiles();
}

function isAnswer(element) {
  return Boolean(element.customData && element.customData.whiteboardChat === ANSWER_MARK);
}

// Scrolls only when the element is outside the visible part of the Board.
function showIfHidden(element) {
  const state = api.getAppState();
  const zoom = state.zoom.value;
  const left = -state.scrollX;
  const top = -state.scrollY;
  const right = left + state.width / zoom;
  const bottom = top + state.height / zoom;
  const inside = element.x >= left && element.y >= top
    && element.x + element.width <= right && element.y + element.height <= bottom;
  if (!inside) api.scrollToContent(element, { animate: true });
}

function applyRemote(list) {
  if (!api || list.length === 0) return;
  const remote = restoreElements(list, null);
  const newAnswers = remote.filter((element) => isAnswer(element) && !element.isDeleted && !known.has(element.id));
  const merged = reconcileElements(api.getSceneElementsIncludingDeleted(), remote, api.getAppState());
  const remoteVersion = new Map(remote.map((element) => [element.id, element.version]));
  for (const element of merged) {
    if (remoteVersion.get(element.id) === element.version) known.set(element.id, element.version);
  }
  api.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER });
  if (!firstHello && newAnswers.length > 0) showIfHidden(newAnswers[newAnswers.length - 1]);
}

function onHello(data) {
  isLeader = data.leader;
  // The Server may have restarted: it has exactly the files in this list.
  knownFiles.clear();
  applyRemoteFiles(data.files || []);
  applyRemote(data.elements);
  if (isLeader) fixAnswerSizes();
  // Elements and images made here while the Server was away go to the Server now.
  collectChanges();
  sendNewFiles();
  if (firstHello && data.elements.length > 0) api.scrollToContent(undefined, { fitToContent: true });
  firstHello = false;
  const inbox = data.inbox || { unsent: 0, autoSend: false };
  setStatus({ ...status, online: true, leader: isLeader, signal: data.signal || "none", ...inbox });
}

// A timer, not requestAnimationFrame: animation frames stop while the page is not drawn
// (a tab in the background), and Send would then wait for ever.
function shortWait() {
  return new Promise((resolve) => setTimeout(resolve, BLUR_WAIT_MS));
}

// Send: finish the text that is being typed, send the last changes, then tell the Server (FR-072).
async function sendToClaude() {
  if (sending) return;
  sending = true;
  try {
    // Escape in the text editor makes Excalidraw finish the text (its own "finish editing" key).
    const editor = document.querySelector("textarea.excalidraw-wysiwyg");
    if (editor) editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
    for (let i = 0; i < BLUR_TRIES && api.getAppState().editingTextElement; i += 1) await shortWait();
    // The text is finished now: tell the Server that nothing is being typed here, or it holds the text back.
    if (editingId !== null) {
      editingId = null;
      editingChanged = true;
    }
    collectChanges();
    await flush();
    await post("/api/send", {});
  } catch (error) {
    setStatus({ ...status, online: false });
  } finally {
    sending = false;
  }
}

// Ctrl+Shift+Enter (Cmd+Shift+Enter on a Mac) sends, also while typing (FR-073).
// Neither Excalidraw 0.18.1 nor the browser uses it on a page; we catch it before Excalidraw sees Ctrl+Enter.
function onKeyDown(event) {
  if (event.key !== "Enter" || !event.shiftKey || event.altKey || !(event.ctrlKey || event.metaKey)) return;
  if (event.isComposing) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  sendToClaude();
}

async function setAutoSend(on) {
  try {
    await post("/api/auto-send", { on });
  } catch (error) {
    setStatus({ ...status, online: false });
  }
}

// Text is measured with the font that is loaded now. Excalifont loads late, so wait for it,
// or the width is too small and the end of the line is cut (FR-028).
async function loadAnswerFont(text) {
  try {
    await document.fonts.load(ANSWER_FONT, text);
  } catch (error) {
    // Measure with the fallback font; the text may then be cut.
  }
}

function measure(text, x, y) {
  const [made] = convertToExcalidrawElements([
    { type: "text", x, y, text, fontSize: ANSWER_FONT_SIZE, strokeColor: ANSWER_COLOR },
  ]);
  return made;
}

// Answers that were measured before the font was loaded are too narrow. The Leader fixes them once.
async function fixAnswerSizes() {
  const answers = api.getSceneElements().filter((element) => isAnswer(element) && element.type === "text");
  if (answers.length === 0) return;
  await loadAnswerFont(answers.map((element) => element.text).join(""));
  const fixed = [];
  for (const element of answers) {
    const size = measure(element.text, element.x, element.y);
    if (size.width > element.width + 0.5 || size.height > element.height + 0.5) {
      fixed.push(newElementWith(element, { width: size.width, height: size.height }));
    }
  }
  if (fixed.length === 0) return;
  const byId = new Map(fixed.map((element) => [element.id, element]));
  api.updateScene({
    elements: api.getSceneElementsIncludingDeleted().map((element) => byId.get(element.id) || element),
    captureUpdate: CaptureUpdateAction.NEVER,
  });
}

async function writeAnswer(job) {
  await loadAnswerFont(job.text);
  const made = measure(job.text, job.x, job.y);
  const element = { ...made, customData: { ...(made.customData || {}), whiteboardChat: ANSWER_MARK } };
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), element],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  known.set(element.id, element.version);
  showIfHidden(element);
  return { elements: [element] };
}

function overlaps(element, box) {
  return element.x < box.x + box.width && element.x + element.width > box.x
    && element.y < box.y + box.height && element.y + element.height > box.y;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function takeShot(job) {
  let elements = api.getSceneElements();
  if (job.focusId) {
    const focus = elements.find((element) => element.id === job.focusId);
    if (!focus) throw new Error(`no item with id ${job.focusId}`);
    const box = {
      x: focus.x + focus.width / 2 - SHOT_BOX.width / 2,
      y: focus.y + focus.height / 2 - SHOT_BOX.height / 2,
      ...SHOT_BOX,
    };
    elements = elements.filter((element) => overlaps(element, box));
  }
  if (elements.length === 0) throw new Error("the board is empty");
  const blob = await exportToBlob({
    elements,
    appState: { ...api.getAppState(), exportBackground: true, viewBackgroundColor: "#ffffff" },
    files: api.getFiles(),
    mimeType: "image/png",
    maxWidthOrHeight: SHOT_MAX_PX,
  });
  return { png: await blobToBase64(blob) };
}

// Takes an Answer off this page again. The Server gave the Job to another page while this page
// was frozen, so the other page wrote the same Answer (FR-086).
function removeLocal(elements) {
  const ids = new Set(elements.map((element) => element.id));
  for (const id of ids) known.delete(id);
  api.updateScene({
    elements: api.getSceneElementsIncludingDeleted().filter((element) => !ids.has(element.id)),
    captureUpdate: CaptureUpdateAction.NEVER,
  });
}

async function runJob(job) {
  let result = null;
  try {
    result = job.kind === "answer" ? await writeAnswer(job) : await takeShot(job);
  } catch (error) {
    await post("/api/job", { jobId: job.jobId, ok: false, error: String(error && error.message) }).catch(() => {});
    return;
  }
  try {
    await post("/api/job", { jobId: job.jobId, ok: true, ...result });
  } catch (error) {
    if (error.status === 409 && result.elements) removeLocal(result.elements);
  }
}

function reportVisibility() {
  post("/api/visibility", { visible: document.visibilityState === "visible" }).catch(() => {});
}

function offline() {
  setStatus({ ...status, online: false, leader: false });
}

function reopenLater() {
  if (reopenTimer === null) reopenTimer = setTimeout(openStream, RETRY_MS);
}

// The browser opens a broken stream again by itself, but not always: some browsers give up
// (readyState CLOSED), and a stream can stop without an error. Then we open a new one (FR-023a).
function openStream() {
  reopenTimer = null;
  if (source) source.close();
  const query = new URLSearchParams({ t: token, page: pageId, visible: document.visibilityState === "visible" ? "1" : "0" });
  const current = new EventSource(`/api/stream?${query}`);
  source = current;
  lastStreamMs = Date.now();
  const on = (type, handler) => current.addEventListener(type, (event) => {
    lastStreamMs = Date.now();
    handler(JSON.parse(event.data));
  });
  on("hello", onHello);
  on("ping", () => {});
  on("elements", (data) => applyRemote(data.elements));
  on("files", (data) => applyRemoteFiles(data.files));
  on("role", (data) => {
    isLeader = data.leader;
    setStatus({ ...status, online: true, leader: isLeader });
    if (isLeader) fixAnswerSizes();
  });
  on("signal", (data) => setStatus({ ...status, signal: data.state }));
  on("inbox", (data) => setStatus({ ...status, unsent: data.unsent, autoSend: data.autoSend }));
  on("job", runJob);
  on("bye", offline);
  current.onerror = () => {
    offline();
    if (current.readyState === EventSource.CLOSED) reopenLater();
  };
}

function connect() {
  openStream();
  setInterval(() => {
    if (source && Date.now() - lastStreamMs > STREAM_STALE_MS) {
      offline();
      openStream();
    }
  }, WATCH_STREAM_MS);
}

function setStatus(next) {
  status = next;
  showStatus(next);
}

function StatusBadge() {
  const [shown, update] = React.useState(status);
  React.useEffect(() => {
    showStatus = update;
    update(status);
  }, []);
  const text = shown.online
    ? `Whiteboard Chat: connected${shown.leader ? " (this page writes Claude's answers)" : ""}`
    : "Whiteboard Chat: not connected, trying again";
  const signal = SIGNAL_TEXT[shown.signal];
  const send = shown.autoSend
    ? null
    : h("button", {
      type: "button",
      className: shown.unsent > 0 ? "wbc-send wbc-has" : "wbc-send",
      title: "Send your text and drawings to Claude (Ctrl+Shift+Enter)",
      onClick: sendToClaude,
    }, `Send (${shown.unsent})`);
  const auto = h("label", { className: "wbc-auto", title: "Send each text by itself, 1.5 s after you stop typing" },
    h("input", { type: "checkbox", checked: shown.autoSend, onChange: (event) => setAutoSend(event.target.checked) }),
    "auto");
  return h("div", { className: "wbc-bar" },
    send,
    signal ? h("div", { className: `wbc-signal wbc-${shown.signal}` }, signal) : null,
    h("div", { className: shown.online ? "wbc-status" : "wbc-status off" }, text),
    auto);
}

function App() {
  return h(Excalidraw, {
    excalidrawAPI: (value) => {
      if (api !== null) return;
      api = value;
      connect();
    },
    onChange,
    name: "Whiteboard Chat",
    renderTopRightUI: () => h(StatusBadge),
  });
}

window.addEventListener("keydown", onKeyDown, true);
// A hidden page gives the Leader role to a page on screen (FR-085).
document.addEventListener("visibilitychange", reportVisibility);

if (!token) {
  showNotice("This page needs the full link that Claude Code showed you. It ends with #t= and a code.");
} else {
  createRoot(document.getElementById("root")).render(h(App));
}
