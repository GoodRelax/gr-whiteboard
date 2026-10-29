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

const token = new URLSearchParams(window.location.hash.slice(1)).get("t") || "";
const pageId = randomId();

let api = null;
let isLeader = false;
let firstHello = true;
let editingId = null;
let editingChanged = false;
let flushTimer = null;
let status = { online: false, leader: false };
let showStatus = () => {};
// id -> the version that the Server has (sent by us or received from it).
const known = new Map();
// id -> element changed here and not sent yet.
const pending = new Map();

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
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

function scheduleFlush(delayMs) {
  if (flushTimer === null) flushTimer = setTimeout(flush, delayMs);
}

async function flush() {
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

function onChange(elements, appState) {
  const nowEditing = appState.editingTextElement ? appState.editingTextElement.id : null;
  if (nowEditing !== editingId) {
    editingId = nowEditing;
    editingChanged = true;
    scheduleFlush(FLUSH_MS);
  }
  collectChanges();
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
  applyRemote(data.elements);
  // Elements made here while the Server was away go to the Server now.
  collectChanges();
  if (firstHello && data.elements.length > 0) api.scrollToContent(undefined, { fitToContent: true });
  firstHello = false;
  setStatus({ online: true, leader: isLeader });
}

function writeAnswer(job) {
  const [made] = convertToExcalidrawElements([
    { type: "text", x: job.x, y: job.y, text: job.text, fontSize: ANSWER_FONT_SIZE, strokeColor: ANSWER_COLOR },
  ]);
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

async function runJob(job) {
  try {
    const result = job.kind === "answer" ? writeAnswer(job) : await takeShot(job);
    await post("/api/job", { jobId: job.jobId, ok: true, ...result });
  } catch (error) {
    await post("/api/job", { jobId: job.jobId, ok: false, error: String(error && error.message) }).catch(() => {});
  }
}

function connect() {
  const query = new URLSearchParams({ t: token, page: pageId });
  const source = new EventSource(`/api/stream?${query}`);
  const on = (type, handler) => source.addEventListener(type, (event) => handler(JSON.parse(event.data)));
  on("hello", onHello);
  on("elements", (data) => applyRemote(data.elements));
  on("role", (data) => {
    isLeader = data.leader;
    setStatus({ online: true, leader: isLeader });
  });
  on("job", runJob);
  on("bye", () => setStatus({ online: false, leader: false }));
  source.onerror = () => setStatus({ online: false, leader: false });
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
  return h("div", { className: shown.online ? "wbc-status" : "wbc-status off" }, text);
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
    UIOptions: { tools: { image: false } },
    renderTopRightUI: () => h(StatusBadge),
  });
}

if (!token) {
  showNotice("This page needs the full link that Claude Code showed you. It ends with #t= and a code.");
} else {
  createRoot(document.getElementById("root")).render(h(App));
}
