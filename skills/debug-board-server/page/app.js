// Whiteboard page. Shows the Excalidraw component, keeps the Board in step with the Server,
// and, on the Leader page, writes Answers, lays out Claude's drawings, and takes Screenshots (spec 3.6).
// Plain browser module: no build step. React and Excalidraw come from esm.sh (see the import map).

import React from "react";
import { createRoot } from "react-dom/client";
import {
  Excalidraw,
  CaptureUpdateAction,
  convertToExcalidrawElements,
  exportToBlob,
  getCommonBounds,
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
const CLAUDE_MARK = "claudeItem";
const SHOT_BOX = Object.freeze({ width: 1600, height: 1000 });
const SHOT_MAX_PX = 2000;
// A small board is drawn at up to twice its size, as before 0.5.2 (maxWidthOrHeight made it SHOT_MAX_PX wide).
const SHOT_MAX_SCALE = 2;
// Room around the drawing, so rough strokes and labels at the edge are not cut (FR-118).
const SHOT_PADDING_PX = 40;
// The fonts of Answers: Excalifont, and Xiaolai for Chinese and Japanese characters.
const ANSWER_FONT = `${ANSWER_FONT_SIZE}px Excalifont, Xiaolai`;
// The Server sends "ping" every 20 s. Without any message for this long, open the stream again (FR-023a).
const STREAM_STALE_MS = 50000;
const WATCH_STREAM_MS = 5000;
// Excalidraw lays out labels and bound arrows of new Elements again: at once, and after a font loads.
// For this long after the page shows Elements from the Server, such changes are not sent (see settleLayout).
const LAYOUT_SETTLE_MS = 2500;
// Time for Excalidraw to finish the text after the editor loses focus.
const BLUR_WAIT_MS = 50;
const BLUR_TRIES = 20;
// Every label is "Claude: <verb> <object>", so it is clear who does what (the owner's rule).
const SIGNAL_TEXT = Object.freeze({
  reading: "Claude: reading your text",
  working: "Claude: working on it",
  waiting: "Claude: waiting for you",
});
// The bar shows these short labels; SIGNAL_TEXT is their tooltip (R-049).
const SIGNAL_SHORT = Object.freeze({
  reading: "Claude: reading",
  working: "Claude: working",
  waiting: "Claude: waiting",
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
let status = { online: false, leader: false, signal: "none", unsent: 0, autoSend: false, join: [], idleStopAtMs: null };
// A touch on the page keeps the Server running (0.6.1, FR-159): at most one report every ACTIVITY_MS,
// and at once while the idle warning is shown.
const ACTIVITY_MS = 20000;
let lastActivitySentMs = 0;
let sending = false;
let showStatus = () => {};
// id -> the version that the Server has (sent by us or received from it).
const known = new Map();
// id -> element changed here and not sent yet.
const pending = new Map();
// Ids of image files that the Server has (sent by us or received from it) (FR-081).
const knownFiles = new Set();
let filesRetryTimer = null;
// The last key or pointer press on this page, and id -> when the page showed it from the Server (see settleLayout).
let lastInputMs = 0;
const settling = new Map();

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
    if (known.get(element.id) === element.version) continue;
    if (known.has(element.id) && isLayoutOnly(element.id)) known.set(element.id, element.version);
    else pending.set(element.id, element);
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
  return Boolean(element.customData && element.customData.grwbKind === ANSWER_MARK);
}

// Scrolls only when the element (or box) is outside the visible part of the Board.
// `target` is what to scroll to: the element itself, or a list of elements.
function showIfHidden(element, target = element) {
  const state = api.getAppState();
  const zoom = state.zoom.value;
  const left = -state.scrollX;
  const top = -state.scrollY;
  const right = left + state.width / zoom;
  const bottom = top + state.height / zoom;
  const inside = element.x >= left && element.y >= top
    && element.x + element.width <= right && element.y + element.height <= bottom;
  if (!inside) api.scrollToContent(target, { animate: true });
}

// The given Elements and what is bound to them or what they are bound to: labels, arrows, the shapes at arrow ends.
function relatedIds(ids) {
  const out = new Set(ids);
  for (const element of api.getSceneElementsIncludingDeleted()) {
    const start = element.startBinding && element.startBinding.elementId;
    const end = element.endBinding && element.endBinding.elementId;
    if (ids.has(element.containerId) || ids.has(start) || ids.has(end)) out.add(element.id);
    if (!ids.has(element.id)) continue;
    if (element.containerId) out.add(element.containerId);
    if (start) out.add(start);
    if (end) out.add(end);
    for (const bound of Array.isArray(element.boundElements) ? element.boundElements : []) out.add(bound.id);
  }
  return out;
}

// After the page shows Elements from the Server (or from its own Job), Excalidraw lays out their labels
// and bound arrows again and raises their versions. That is not a change by a Person: take it as known,
// do not send it. Sent, it would look like a Person's change (Send, UndoConflict); kept back silently,
// it would beat the next version from the Server, and an undo would not show on this page.
// A change after a key or pointer press on this page is a Person's; it is always sent.
function settleLayout(ids) {
  const sinceMs = Date.now();
  for (const id of relatedIds(ids)) settling.set(id, sinceMs);
}

// True when a new version of this Element is Excalidraw's own layout (see settleLayout).
function isLayoutOnly(id) {
  const sinceMs = settling.get(id);
  if (sinceMs === undefined) return false;
  if (Date.now() - sinceMs > LAYOUT_SETTLE_MS || lastInputMs >= sinceMs) {
    settling.delete(id);
    return false;
  }
  return true;
}

// `fromServer`: the Elements changed the Server's Board, so the Server's copy wins here, unless a Person
// changed the Element on this page and it is not sent yet (FR-021 then decides on the Server).
function applyRemote(list, fromServer = false) {
  if (!api || list.length === 0) return;
  const remote = restoreElements(list, null);
  const newAnswers = remote.filter((element) => isAnswer(element) && !element.isDeleted && !known.has(element.id));
  const newDrawing = remote.filter((element) => isClaudeItem(element) && !element.isDeleted && !known.has(element.id));
  let merged = reconcileElements(api.getSceneElementsIncludingDeleted(), remote, api.getAppState());
  if (fromServer) {
    const take = new Map(remote.filter((element) => !pending.has(element.id) && element.id !== editingId).map((element) => [element.id, element]));
    merged = merged.map((element) => take.get(element.id) || element);
  }
  const remoteVersion = new Map(remote.map((element) => [element.id, element.version]));
  for (const element of merged) {
    if (remoteVersion.get(element.id) === element.version) known.set(element.id, element.version);
  }
  api.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER });
  settleLayout(new Set(remote.map((element) => element.id)));
  if (!firstHello && newAnswers.length > 0) showIfHidden(newAnswers[newAnswers.length - 1]);
  if (!firstHello && newDrawing.length > 0) showAllIfHidden(newDrawing);
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
  const join = Array.isArray(data.join) ? data.join.filter((target) => target && typeof target.url === "string") : [];
  const idleStopAtMs = Number.isFinite(data.idleStopAtMs) ? data.idleStopAtMs : null;
  setStatus({ ...status, online: true, leader: isLeader, signal: data.signal || "none", ...inbox, join, idleStopAtMs });
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
  const element = { ...made, customData: { ...(made.customData || {}), grwbKind: ANSWER_MARK } };
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), element],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  known.set(element.id, element.version);
  showIfHidden(element);
  return { elements: [element] };
}

// The box of an Element on the Board. Arrows and lines count by their points: their width and height can be old (FR-118).
function elementBox(element) {
  const [minX, minY, maxX, maxY] = getCommonBounds([element]);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function overlaps(element, box) {
  const own = elementBox(element);
  return own.x < box.x + box.width && own.x + own.width > box.x
    && own.y < box.y + box.height && own.y + own.height > box.y;
}

// The Elements in `box`, with the labels of their shapes and arrows and the shapes of their labels,
// so that no shape is shown without its label (FR-118).
function inShotBox(elements, box) {
  const ids = new Set(elements.filter((element) => overlaps(element, box)).map((element) => element.id));
  for (const element of elements) {
    if (element.type === "text" && element.containerId && ids.has(element.id)) ids.add(element.containerId);
  }
  for (const element of elements) {
    if (element.type === "text" && element.containerId && ids.has(element.containerId)) ids.add(element.id);
  }
  return elements.filter((element) => ids.has(element.id));
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
    const own = elementBox(focus);
    const box = {
      x: own.x + own.width / 2 - SHOT_BOX.width / 2,
      y: own.y + own.height / 2 - SHOT_BOX.height / 2,
      ...SHOT_BOX,
    };
    elements = inShotBox(elements, box);
  }
  if (elements.length === 0) throw new Error("the board is empty");
  // A text whose font is not loaded yet is drawn with nothing (FR-118).
  await loadFonts(elements.filter((element) => element.type === "text").map((e) => ({ text: e.text, fontFamily: e.fontFamily, fontSize: e.fontSize })));
  // job.scale in (0, 1] makes the PNG smaller (FR-123); the Server checks it.
  const wanted = Number(job.scale) > 0 ? Number(job.scale) : 1;
  const blob = await exportToBlob({
    elements,
    appState: { ...api.getAppState(), exportBackground: true, viewBackgroundColor: "#ffffff" },
    files: api.getFiles(),
    mimeType: "image/png",
    exportPadding: SHOT_PADDING_PX,
    getDimensions: (width, height) => {
      const scale = wanted * Math.min(SHOT_MAX_SCALE, SHOT_MAX_PX / Math.max(width, height, 1));
      return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
    },
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

// ---- Operations by Claude (0.5.0): draw, edit, and mermaid Jobs (spec 3.6, FR-090, FR-094, FR-095, FR-098) ----

// Excalidraw 0.18.1 font numbers (4.11.1). Xiaolai covers Chinese and Japanese characters.
const FONT_NAMES = Object.freeze({ 1: "Virgil", 2: "Helvetica", 3: "Cascadia", 5: "Excalifont", 6: "Nunito", 7: "Lilita One", 8: "Comic Shanns" });
const DEFAULT_FONT_FAMILY = 5;
const SHAPE_TYPES = Object.freeze(["rectangle", "ellipse", "diamond"]);
// securityLevel is set on purpose, so a new default cannot loosen it (FR-093a).
// Mermaid measures the labels with the fonts of the board, so a box fits its label (FR-115).
const MERMAID_FONTS = "Excalifont, Xiaolai, sans-serif";
const MERMAID_OPTIONS = Object.freeze({
  securityLevel: "strict", themeVariables: { fontSize: "20px", fontFamily: MERMAID_FONTS }, fontFamily: MERMAID_FONTS, maxTextSize: 20000,
});
// The default black of Mermaid lines and text becomes Claude's blue; a pie picture keeps its colors (FR-116, R-027).
const MERMAID_BLACKS = Object.freeze(["#000", "#000000", "black", "#1e1e1e"]);
// A line break in a Mermaid label ("A<br>B", "A<br/>B") is a new line on the board (FR-115).
const MERMAID_LINE_BREAK = /<br\s*\/?>/gi;
const MERMAID_PNG_MAX_PX = 2000;
// Draw the picture at up to twice its size, so it stays sharp when a Person zooms in.
const MERMAID_PNG_SCALE = 2;
let mermaidModule = null;

function isClaudeItem(element) {
  return Boolean(element.customData && element.customData.grwbKind === CLAUDE_MARK);
}

function jobError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// Loads the fonts of every text, so text is measured right (as FR-028).
async function loadFonts(texts) {
  const byFont = new Map();
  for (const { text, fontFamily, fontSize } of texts) {
    const key = `${fontSize || ANSWER_FONT_SIZE}px ${FONT_NAMES[fontFamily || DEFAULT_FONT_FAMILY] || "Excalifont"}, Xiaolai`;
    byFont.set(key, (byFont.get(key) || "") + text);
  }
  for (const [font, text] of byFont) {
    try {
      await document.fonts.load(font, text);
    } catch (error) {
      // Measure with the fallback font.
    }
  }
}

// Excalidraw keeps the default width 100 and height 0 of an arrow or line made from a Skeleton with points;
// the box of its points is the true size (FR-119).
function sizeFromPoints(element) {
  if ((element.type !== "arrow" && element.type !== "line") || !Array.isArray(element.points) || element.points.length < 2) return element;
  const xs = element.points.map((p) => p[0]);
  const ys = element.points.map((p) => p[1]);
  return { ...element, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

function marked(element) {
  return { ...element, link: null, customData: { ...(element.customData || {}), grwbKind: CLAUDE_MARK } };
}

// Puts `list` into the scene in place of the Elements with the same id, and marks them as known to the Server.
function putInScene(list) {
  const byId = new Map(list.map((element) => [element.id, element]));
  for (const element of list) known.set(element.id, element.version);
  const scene = api.getSceneElementsIncludingDeleted();
  const kept = scene.map((element) => byId.get(element.id) || element);
  const sceneIds = new Set(scene.map((element) => element.id));
  const added = list.filter((element) => !sceneIds.has(element.id));
  api.updateScene({ elements: [...kept, ...added], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  settleLayout(new Set(list.map((element) => element.id)));
}

// Scrolls to the whole drawing when a part of it is outside the visible area (FR-107).
function showAllIfHidden(list) {
  if (list.length === 0) return;
  const [minX, minY, maxX, maxY] = getCommonBounds(list);
  showIfHidden({ x: minX, y: minY, width: maxX - minX, height: maxY - minY }, list);
}

function toSkeleton(skeleton, origin) {
  const out = { ...skeleton, x: skeleton.x + origin.x, y: skeleton.y + origin.y };
  out.strokeColor = skeleton.strokeColor || ANSWER_COLOR;
  if (skeleton.label) out.label = { ...skeleton.label, strokeColor: skeleton.label.strokeColor || out.strokeColor };
  return out;
}

async function drawSkeletons(job) {
  const origin = { x: job.x, y: job.y };
  const scene = new Map(api.getSceneElementsIncludingDeleted().map((element) => [element.id, element]));
  // Skeletons without an id get one here, so the reply can list one id per Skeleton.
  const skeletons = job.elements.map((skeleton) => toSkeleton({ ...skeleton, id: skeleton.id || randomId() }, origin));
  await loadFonts(skeletons.flatMap((s) => (s.type === "text" ? [s] : s.label ? [s.label] : [])));
  // Copies of the Board shapes that arrows bind to: Excalidraw binds only inside its list (FR-090).
  const targets = (job.boardIds || []).map((id) => scene.get(id)).filter(Boolean);
  const copies = targets.map((shape) => ({
    type: SHAPE_TYPES.includes(shape.type) ? shape.type : "rectangle",
    id: shape.id, x: shape.x, y: shape.y, width: shape.width, height: shape.height,
  }));
  const made = convertToExcalidrawElements([...copies, ...skeletons], { regenerateIds: false });
  const targetIds = new Set(targets.map((shape) => shape.id));
  const fresh = made.filter((element) => !targetIds.has(element.id)).map(sizeFromPoints).map(marked);
  const bound = targets.map((shape) => {
    const copy = made.find((element) => element.id === shape.id);
    const old = Array.isArray(shape.boundElements) ? shape.boundElements : [];
    const extra = (copy.boundElements || []).filter((b) => !old.some((o) => o.id === b.id));
    return newElementWith(shape, { boundElements: [...old, ...extra] });
  });
  putInScene([...fresh, ...bound]);
  showAllIfHidden(fresh);
  return { elements: [...fresh, ...bound], ids: skeletons.map((skeleton) => skeleton.id), before: targets };
}

// The text of a container (its label), or null.
function labelOf(scene, containerId) {
  for (const element of scene.values()) {
    if (!element.isDeleted && element.type === "text" && element.containerId === containerId) return element;
  }
  return null;
}

// The size of a text with its font, measured by Excalidraw.
function measureText(text, style) {
  const [made] = convertToExcalidrawElements([{ type: "text", x: 0, y: 0, text, ...style }]);
  return made;
}

// Lays out a label in its shape again: Excalidraw centers it and makes the shape tall enough.
function layoutLabel(container, label, style) {
  if (container.type === "arrow" || container.type === "line") {
    const size = measureText(label.text, style);
    const points = container.points || [[0, 0]];
    const mid = points[Math.floor(points.length / 2)];
    const prev = points[Math.max(0, Math.floor(points.length / 2) - (points.length % 2 === 0 ? 1 : 0))];
    const cx = container.x + (mid[0] + prev[0]) / 2;
    const cy = container.y + (mid[1] + prev[1]) / 2;
    return { container: {}, label: { width: size.width, height: size.height, lineHeight: size.lineHeight, x: cx - size.width / 2, y: cy - size.height / 2 } };
  }
  const [shape, text] = convertToExcalidrawElements([{
    type: SHAPE_TYPES.includes(container.type) ? container.type : "rectangle",
    x: container.x, y: container.y, width: container.width, height: container.height,
    label: { text: label.text, ...style },
  }]);
  const grow = {};
  if (shape.height > container.height + 0.5) grow.height = shape.height;
  if (shape.width > container.width + 0.5) grow.width = shape.width;
  return { container: grow, label: { x: text.x, y: text.y, width: text.width, height: text.height, lineHeight: text.lineHeight } };
}

function boxOf(element) {
  return { x: element.x, y: element.y, width: element.width, height: element.height };
}

function sameBox(a, b) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

// How far a point on the old box of a shape goes when the shape gets its new box.
function shiftOf(move, [px, py]) {
  if (!move) return [0, 0];
  const nx = move.to.x + (px - move.from.x) * (move.from.width > 0 ? move.to.width / move.from.width : 1);
  const ny = move.to.y + (py - move.from.y) * (move.from.height > 0 ? move.to.height / move.from.height : 1);
  return [nx - px, ny - py];
}

// A segment that changes x or y by less than this is level or upright.
const AXIS_PX = 1;

function isLevel(a, b) {
  return Math.abs(b[1] - a[1]) < AXIS_PX;
}

// True for three or more points joined only by level and upright segments.
function isRightAngled(points) {
  return points.length >= 3 && points.every((p, i) => i === 0 || isLevel(points[i - 1], p) || Math.abs(p[0] - points[i - 1][0]) < AXIS_PX);
}

// The new points (board coordinates) of an arrow whose start moves by atStart and whose end moves by atEnd (FR-117).
// Both ends by the same amount: the whole arrow moves. A right-angled arrow stays right-angled: the point next to
// a moved end follows it across its segment. Any other arrow: a point between the ends moves by its place along
// the arrow, so the arrow keeps its form and no segment runs far away.
function movePoints(old, atStart, atEnd) {
  const last = old.length - 1;
  const same = atStart[0] === atEnd[0] && atStart[1] === atEnd[1];
  if (!same && isRightAngled(old)) {
    const abs = old.map((p) => [...p]);
    const moveEnd = (end, next, by) => {
      abs[end] = [abs[end][0] + by[0], abs[end][1] + by[1]];
      if (isLevel(old[end], old[next])) abs[next][1] += by[1];
      else abs[next][0] += by[0];
    };
    moveEnd(0, 1, atStart);
    moveEnd(last, last - 1, atEnd);
    return abs;
  }
  const along = [0];
  for (let i = 1; i <= last; i += 1) along.push(along[i - 1] + Math.hypot(old[i][0] - old[i - 1][0], old[i][1] - old[i - 1][1]));
  return old.map(([px, py], i) => {
    const t = along[last] > 0 ? along[i] / along[last] : i / last;
    return [px + atStart[0] * (1 - t) + atEnd[0] * t, py + atStart[1] * (1 - t) + atEnd[1] * t];
  });
}

// Moves the arrows bound to shapes that moved or changed size, as Excalidraw does on a drag (FR-098).
// moves: Map shape id -> { from, to } (the old and the new box). skipIds: arrows that the Job moves itself,
// so they do not move twice (FR-117). An end goes with its shape; movePoints moves the points between.
function followShapes(scene, moves, skipIds = new Set()) {
  const changed = [];
  for (const arrow of [...scene.values()]) {
    if (arrow.isDeleted || skipIds.has(arrow.id) || !Array.isArray(arrow.points) || arrow.points.length < 2) continue;
    const startMove = arrow.startBinding ? moves.get(arrow.startBinding.elementId) : undefined;
    const endMove = arrow.endBinding ? moves.get(arrow.endBinding.elementId) : undefined;
    if (!startMove && !endMove) continue;
    const old = arrow.points.map((p) => [arrow.x + p[0], arrow.y + p[1]]);
    const last = old.length - 1;
    const abs = movePoints(old, shiftOf(startMove, old[0]), shiftOf(endMove, old[last]));
    const [x0, y0] = abs[0];
    const points = abs.map(([px, py]) => [px - x0, py - y0]);
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const moved = newElementWith(arrow, {
      x: x0, y: y0, points, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
    });
    scene.set(moved.id, moved);
    changed.push(moved);
    const label = labelOf(scene, arrow.id);
    if (label) {
      const placed = layoutLabel(moved, label, { fontSize: label.fontSize, fontFamily: label.fontFamily });
      const next = newElementWith(label, placed.label);
      scene.set(next.id, next);
      changed.push(next);
    }
  }
  return changed;
}

const EDIT_STYLE_FIELDS = Object.freeze(["strokeColor", "backgroundColor", "fillStyle", "strokeWidth", "strokeStyle", "roughness", "opacity", "angle"]);
const EDIT_TEXT_FIELDS = Object.freeze(["text", "fontSize", "fontFamily", "textAlign"]);

async function editElements(job) {
  const original = new Map(api.getSceneElementsIncludingDeleted().map((element) => [element.id, element]));
  const scene = new Map(original);
  // Arrows and lines that a change moves itself: their bound shapes do not move them again (FR-117).
  const movedLines = new Set(job.changes
    .filter((change) => ["x", "y", "dx", "dy"].some((field) => change[field] !== undefined))
    .map((change) => change.id)
    .filter((id) => original.has(id) && ["arrow", "line"].includes(original.get(id).type)));
  const shapeIds = new Set();
  const texts = [];
  for (const change of job.changes) {
    const element = scene.get(change.id);
    const label = element && element.type !== "text" ? labelOf(scene, element.id) : element;
    if (label && label.type === "text") {
      texts.push({ text: change.text || label.text, fontFamily: change.fontFamily || label.fontFamily, fontSize: change.fontSize || label.fontSize });
    }
  }
  await loadFonts(texts);
  const touched = new Map();
  const put = (element) => {
    scene.set(element.id, element);
    touched.set(element.id, element);
    return element;
  };
  for (const change of job.changes) {
    let element = scene.get(change.id);
    if (!element) throw new Error(`no item with id ${change.id}`);
    // A label of a shape is changed through its shape.
    const container = element.type === "text" && element.containerId ? scene.get(element.containerId) : null;
    const patch = {};
    for (const field of EDIT_STYLE_FIELDS) if (change[field] !== undefined) patch[field] = change[field];
    if (change.x !== undefined) patch.x = change.x;
    if (change.y !== undefined) patch.y = change.y;
    if (change.dx !== undefined) patch.x = element.x + change.dx;
    if (change.dy !== undefined) patch.y = element.y + change.dy;
    if (change.width !== undefined) patch.width = change.width;
    if (change.height !== undefined) patch.height = change.height;
    const textPatch = {};
    for (const field of EDIT_TEXT_FIELDS) if (change[field] !== undefined) textPatch[field] = change[field];
    if (element.type === "text" && !container) {
      Object.assign(patch, textPatch);
      if (Object.keys(textPatch).length > 0) {
        const text = textPatch.text !== undefined ? textPatch.text : element.text;
        const size = measureText(text, { fontSize: patch.fontSize || element.fontSize, fontFamily: patch.fontFamily || element.fontFamily, textAlign: patch.textAlign || element.textAlign });
        Object.assign(patch, { originalText: text, width: size.width, height: size.height, lineHeight: size.lineHeight });
      }
      put(newElementWith(element, patch));
      continue;
    }
    // A shape or arrow (or the label of one): change the shape, then lay out its label again.
    const shape = container || element;
    const shapePatch = container ? {} : patch;
    const labelStylePatch = container ? patch : {};
    let nextShape = Object.keys(shapePatch).length > 0 ? put(newElementWith(shape, shapePatch)) : shape;
    const label = labelOf(scene, shape.id);
    if (label) {
      const style = {
        fontSize: textPatch.fontSize || label.fontSize,
        fontFamily: textPatch.fontFamily || label.fontFamily,
        textAlign: textPatch.textAlign || label.textAlign,
      };
      const text = textPatch.text !== undefined ? textPatch.text : label.text;
      const placed = layoutLabel(nextShape, { text }, style);
      if (Object.keys(placed.container).length > 0) nextShape = put(newElementWith(nextShape, placed.container));
      const colors = {};
      for (const field of ["strokeColor", "opacity"]) if (labelStylePatch[field] !== undefined) colors[field] = labelStylePatch[field];
      put(newElementWith(label, { ...style, ...colors, text, originalText: text, ...placed.label }));
    }
    shapeIds.add(shape.id);
  }
  // Every shape moves its arrows once, from its box before the Job to its box after all changes.
  const moves = new Map();
  for (const id of shapeIds) {
    const from = boxOf(original.get(id));
    const to = boxOf(scene.get(id));
    if (!sameBox(from, to)) moves.set(id, { from, to });
  }
  for (const arrow of followShapes(scene, moves, movedLines)) touched.set(arrow.id, arrow);
  const list = [...touched.values()];
  putInScene(list);
  return { elements: list, before: list.map((element) => original.get(element.id)).filter(Boolean) };
}

// Mermaid sizes a node with its own font; Excalifont is wider, so a short label can wrap ("DB" became "D", "B").
// Makes such a shape wider (about its center) until its label is on as many lines as in the source,
// and moves the bound arrow ends with it. `made`: the Elements of one diagram, not yet on the Board.
const FIT_LABEL_TRIES = 8;
const FIT_LABEL_GROW = 1.2;
const FIT_LABEL_PADDING_PX = 20;

function lineCount(text) {
  return String(text || "").split("\n").length;
}

function fitLabels(made) {
  const scene = new Map(made.map((element) => [element.id, element]));
  const moves = new Map();
  for (const label of made) {
    if (label.type !== "text" || !label.containerId || lineCount(label.text) <= lineCount(label.originalText)) continue;
    const shape = scene.get(label.containerId);
    if (!shape || !SHAPE_TYPES.includes(shape.type)) continue;
    const style = { fontSize: label.fontSize, fontFamily: label.fontFamily, textAlign: label.textAlign };
    const textWidth = measureText(label.originalText, style).width;
    let width = Math.max(shape.width, textWidth + FIT_LABEL_PADDING_PX);
    let wider = null;
    for (let i = 0; i < FIT_LABEL_TRIES; i += 1) {
      const candidate = { ...shape, x: shape.x - (width - shape.width) / 2, width };
      const [, text] = convertToExcalidrawElements([{
        type: shape.type, x: candidate.x, y: candidate.y, width: candidate.width, height: candidate.height,
        label: { text: label.originalText, ...style },
      }]);
      if (lineCount(text.text) <= lineCount(label.originalText)) {
        wider = candidate;
        break;
      }
      width *= FIT_LABEL_GROW;
    }
    if (!wider) continue;
    const placed = layoutLabel(wider, { text: label.originalText }, style);
    const nextShape = { ...wider, ...placed.container };
    scene.set(shape.id, nextShape);
    scene.set(label.id, { ...label, text: label.originalText, ...placed.label });
    moves.set(shape.id, { from: boxOf(shape), to: boxOf(nextShape) });
  }
  followShapes(scene, moves);
  return made.map((element) => scene.get(element.id));
}

// Loads @excalidraw/mermaid-to-excalidraw once, at the first mermaid Job (spec 3.6, NFR-009).
function loadMermaid() {
  if (mermaidModule === null) {
    mermaidModule = import("@excalidraw/mermaid-to-excalidraw").catch((error) => {
      mermaidModule = null;
      throw error;
    });
  }
  return mermaidModule;
}

async function sha1Hex(text) {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// The Server refuses SVG files (FR-083), so a Mermaid picture becomes a PNG file (FR-095).
async function svgToPng(svgDataURL, width, height) {
  try {
    const image = new Image();
    image.src = svgDataURL;
    await image.decode();
    const w = width || image.naturalWidth || 800;
    const h = height || image.naturalHeight || 600;
    const scale = Math.min(MERMAID_PNG_SCALE, MERMAID_PNG_MAX_PX / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataURL = canvas.toDataURL("image/png");
    if (!dataURL.startsWith("data:image/png;base64,")) throw new Error("no PNG");
    return dataURL;
  } catch (error) {
    throw jobError("MermaidUnsupported", `this Mermaid type gives a picture, and the browser could not make a PNG of it (${error && error.message})`);
  }
}

function isDefaultBlack(color) {
  return color === undefined || color === null || MERMAID_BLACKS.includes(String(color).toLowerCase());
}

// A Skeleton from Mermaid with real line breaks and with Claude's blue in place of the default black (FR-115).
function boardSkeleton(skeleton) {
  if (skeleton.type === "image") return skeleton;
  const out = { ...skeleton };
  if (typeof out.text === "string") out.text = out.text.replace(MERMAID_LINE_BREAK, "\n");
  if (isDefaultBlack(out.strokeColor)) out.strokeColor = ANSWER_COLOR;
  if (out.label) {
    const label = { ...out.label };
    if (typeof label.text === "string") label.text = label.text.replace(MERMAID_LINE_BREAK, "\n");
    if (isDefaultBlack(label.strokeColor)) label.strokeColor = ANSWER_COLOR;
    out.label = label;
  }
  return out;
}

async function drawMermaid(job) {
  let lib;
  try {
    lib = await loadMermaid();
  } catch (error) {
    throw new Error(`cannot load Mermaid from esm.sh: ${error && error.message}`);
  }
  // Mermaid measures with these fonts, so they must be there first (FR-115).
  await loadFonts([{ text: job.source, fontFamily: DEFAULT_FONT_FAMILY, fontSize: ANSWER_FONT_SIZE }]);
  let parsed;
  try {
    parsed = await lib.parseMermaidToExcalidraw(job.source, MERMAID_OPTIONS);
  } catch (error) {
    throw jobError("MermaidError", String((error && (error.message || error.str)) || error));
  }
  const skeletons = (parsed.elements || []).filter((s) => s.type !== "frame" && s.type !== "magicframe").map(boardSkeleton);
  const files = [];
  for (const skeleton of skeletons) {
    if (skeleton.type !== "image") continue;
    const file = parsed.files && parsed.files[skeleton.fileId];
    if (!file) throw jobError("MermaidUnsupported", "the picture of the diagram is missing");
    const dataURL = file.mimeType === "image/png" ? file.dataURL : await svgToPng(file.dataURL, skeleton.width, skeleton.height);
    const id = await sha1Hex(dataURL);
    files.push({ id, mimeType: "image/png", dataURL, created: Date.now() });
    skeleton.fileId = id;
  }
  // Measure once to learn the fonts, load them, then measure with them (as FR-028).
  const firstTry = convertToExcalidrawElements(skeletons, { regenerateIds: true });
  await loadFonts(firstTry.filter((e) => e.type === "text").map((e) => ({ text: e.text, fontFamily: e.fontFamily, fontSize: e.fontSize })));
  const made = fitLabels(convertToExcalidrawElements(skeletons, { regenerateIds: true }));
  if (made.length === 0) throw jobError("MermaidError", "the diagram has no elements");
  // Move the drawing so that its top left corner is at the Origin (4.11.4).
  const [minX, minY] = getCommonBounds(made);
  const dx = job.x - minX;
  const dy = job.y - minY;
  const fresh = made.map((element) => marked({ ...element, x: element.x + dx, y: element.y + dy, frameId: null, ...(element.type === "image" ? { status: "saved" } : {}) }));
  if (files.length > 0) {
    for (const file of files) knownFiles.add(file.id);
    api.addFiles(files);
  }
  putInScene(fresh);
  showAllIfHidden(fresh);
  return { elements: fresh, files, before: [] };
}

// After a 409 (the Job is gone, or SnapshotFailed), only the Server's Board counts (spec 3.6):
// take new Elements off, and put changed ones back as they were.
function undoLocal(result) {
  const beforeById = new Map((result.before || []).map((element) => [element.id, element]));
  const ids = new Set(result.elements.map((element) => element.id));
  for (const id of ids) {
    if (beforeById.has(id)) known.set(id, beforeById.get(id).version);
    else known.delete(id);
  }
  api.updateScene({
    elements: api.getSceneElementsIncludingDeleted()
      .filter((element) => !ids.has(element.id) || beforeById.has(element.id))
      .map((element) => beforeById.get(element.id) || element),
    captureUpdate: CaptureUpdateAction.NEVER,
  });
}

const JOB_RUNNERS = Object.freeze({
  answer: writeAnswer,
  shot: takeShot,
  draw: drawSkeletons,
  edit: editElements,
  mermaid: drawMermaid,
});

async function runJob(job) {
  let result = null;
  try {
    const runner = JOB_RUNNERS[job.kind];
    if (!runner) throw new Error(`unknown job kind ${job.kind}`);
    result = await runner(job);
  } catch (error) {
    const failure = { jobId: job.jobId, ok: false, error: String(error && error.message) };
    if (error && error.code) failure.code = error.code;
    await post("/api/job", failure).catch(() => {});
    return;
  }
  const { before, ...reply } = result;
  try {
    await post("/api/job", { jobId: job.jobId, ok: true, ...reply });
  } catch (error) {
    if (error.status !== 409 || !result.elements) return;
    if (job.kind === "answer") removeLocal(result.elements);
    else undoLocal(result);
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
  on("elements", (data) => applyRemote(data.elements, true));
  on("files", (data) => applyRemoteFiles(data.files));
  on("role", (data) => {
    isLeader = data.leader;
    setStatus({ ...status, online: true, leader: isLeader });
    if (isLeader) fixAnswerSizes();
  });
  on("signal", (data) => setStatus({ ...status, signal: data.state }));
  on("idle", (data) => setStatus({ ...status, idleStopAtMs: Number.isFinite(data.stopAtMs) ? data.stopAtMs : null }));
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

// ---- Join from another device (0.6.0, FR-154) ----
// In LAN mode the Server sends the LAN Board URLs in hello. The page draws a QR code of each one itself, with
// qrcode-generator from esm.sh (pinned in the import map). The URL never leaves the page.
const QR_CELL_PX = 4;
const QR_MARGIN_CELLS = 4;
let qrModule = null;

function loadQr() {
  if (qrModule === null) {
    qrModule = import("qrcode-generator").catch((error) => {
      qrModule = null;
      throw error;
    });
  }
  return qrModule;
}

function QrCode({ text }) {
  const ref = React.useRef(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    loadQr().then((lib) => {
      if (!live || !ref.current) return;
      const make = lib.default || lib.qrcode;
      const qr = make(0, "M");
      qr.addData(text);
      qr.make();
      const count = qr.getModuleCount();
      const size = (count + 2 * QR_MARGIN_CELLS) * QR_CELL_PX;
      const canvas = ref.current;
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, size, size);
      context.fillStyle = "#000000";
      for (let row = 0; row < count; row += 1) {
        for (let col = 0; col < count; col += 1) {
          if (qr.isDark(row, col)) context.fillRect((col + QR_MARGIN_CELLS) * QR_CELL_PX, (row + QR_MARGIN_CELLS) * QR_CELL_PX, QR_CELL_PX, QR_CELL_PX);
        }
      }
    }).catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [text]);
  return failed ? h("div", null, "The QR code could not be made. Type the link instead.") : h("canvas", { ref, "aria-label": "QR code of the link" });
}

// The steps to trust the CA of this board on an iPad (0.6.1, FR-158; 0.7.1, FR-165, FR-167). Once per device.
const IPAD_STEPS = Object.freeze([
  "Scan the code of step 1 with the iPad camera and open it in Safari. Tap \"Allow\" to download the profile.",
  "Settings > General > VPN & Device Management: tap the profile \"gr-whiteboard local CA\", then \"Install\".",
  "Settings > General > About > Certificate Trust Settings: turn on \"gr-whiteboard local CA\".",
]);
const IPAD_FALLBACK = "If no profile appears: open the CA link on this computer, save the file to iCloud Drive or OneDrive, "
  + "open it on the iPad in the Files app (tap the file), then do steps 2 and 3.";

function caUrlOf(url) {
  try {
    return `${new URL(url).origin}/ca.crt`;
  } catch (error) {
    return null;
  }
}

// Copies a URL to the clipboard of this device (FR-164). The URL stays on this device: nothing is sent anywhere.
function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    if (ok) resolve();
    else reject(new Error("copy failed"));
  });
}

function CopyButton({ text }) {
  const [state, setState] = React.useState("Copy");
  const onClick = () => copyText(text).then(() => setState("Copied")).catch(() => setState("Select and copy"));
  return h("button", { type: "button", className: "wbc-send wbc-copy", title: "Copy the link to the clipboard of this device", onClick }, state);
}

// One address: what it is, its QR code, the link, and a copy button (FR-163, FR-164).
function JoinTarget({ target, showQr }) {
  const name = target.recommended ? `${target.label} - recommended` : target.label;
  return h("div", { className: target.recommended ? "wbc-join-target wbc-recommended" : "wbc-join-target" },
    h("div", { className: "wbc-join-name" }, `${name} (${target.name}, ${target.address})`),
    showQr ? h(QrCode, { text: target.url }) : null,
    h("div", { className: "wbc-join-row" }, h("div", { className: "wbc-join-url" }, target.url), h(CopyButton, { text: target.url })));
}

// The "Join" dialog (FR-165): step 1 trusts the CA of the board (once per device), step 2 opens the board.
// The recommended address comes first; the others wait under "Other addresses" (FR-163).
function JoinDialog({ targets, onClose }) {
  const first = targets[0];
  const caUrl = first.caUrl || caUrlOf(first.url);
  const others = targets.slice(1);
  return h("div", { className: "wbc-join-dialog", onClick: onClose },
    h("div", { className: "wbc-join-box", onClick: (event) => event.stopPropagation() },
      h("strong", null, "Join from another device (same network)"),
      h("div", null, "Anyone with the board link can see and change the board."),
      caUrl ? h("div", { className: "wbc-join-step" },
        h("strong", null, "Step 1 (once per device): trust the CA of this board"),
        h("div", { className: "wbc-join-target" },
          h(QrCode, { text: caUrl }),
          h("div", { className: "wbc-join-row" }, h("div", { className: "wbc-join-url" }, h("a", { href: caUrl, download: "gr-whiteboard-ca.crt" }, caUrl)), h(CopyButton, { text: caUrl }))),
        h("ol", null, ...IPAD_STEPS.map((step) => h("li", { key: step }, step))),
        h("div", { className: "wbc-join-note" }, IPAD_FALLBACK),
        h("div", { className: "wbc-join-note" }, "Another computer: download the CA with the link and add it to the trusted root certificates once.")) : null,
      h("div", { className: "wbc-join-step" },
        h("strong", null, "Step 2: open the board"),
        h(JoinTarget, { target: first, showQr: true }),
        others.length > 0 ? h("details", null,
          h("summary", null, `Other addresses (${others.length}) - use them only when the recommended one does not work`),
          ...others.map((target) => h(JoinTarget, { key: target.url, target, showQr: true }))) : null),
      h("button", { type: "button", className: "wbc-send", onClick: onClose }, "Close")));
}

// The idle warning (0.6.1, FR-160): the Server stops soon because nobody uses the board.
function IdleBanner({ stopAtMs }) {
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 15000);
    return () => clearInterval(timer);
  }, []);
  const minutes = Math.max(0, Math.ceil((stopAtMs - Date.now()) / 60000));
  const at = new Date(stopAtMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return h("div", { className: "wbc-idle", role: "status" },
    `Nobody used this board for a while. It stops at ${at} (in about ${minutes} min) and saves a copy. Touch the board to keep it open.`);
}

function StatusBadge() {
  const [shown, update] = React.useState(status);
  const [joinOpen, setJoinOpen] = React.useState(false);
  React.useEffect(() => {
    showStatus = update;
    update(status);
  }, []);
  // Short texts; the full sentence is the tooltip (R-049, FR-169).
  const statusText = shown.online ? (shown.leader ? "connected, writer" : "connected") : "offline, retrying";
  const statusTitle = shown.online
    ? `gr-whiteboard: connected${shown.leader ? " (this page writes Claude's answers)" : ""}`
    : "gr-whiteboard: not connected, trying again";
  const signal = SIGNAL_SHORT[shown.signal];
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
  const join = shown.join && shown.join.length > 0
    ? h("button", { type: "button", className: "wbc-send wbc-join", title: "Join from another device: links and QR codes for a phone or tablet", onClick: () => setJoinOpen(true) }, "Join")
    : null;
  return h("div", { className: "wbc-bar" },
    shown.idleStopAtMs ? h(IdleBanner, { stopAtMs: shown.idleStopAtMs }) : null,
    joinOpen ? h(JoinDialog, { targets: shown.join, onClose: () => setJoinOpen(false) }) : null,
    join,
    send,
    signal ? h("div", { className: `wbc-signal wbc-${shown.signal}`, title: SIGNAL_TEXT[shown.signal] }, signal) : null,
    h("div", { className: shown.online ? "wbc-status" : "wbc-status off", title: statusTitle },
      h("span", { className: "wbc-dot", "aria-hidden": "true" }, "\u25cf"), h("span", { className: "wbc-status-text" }, ` ${statusText}`)),
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
    name: "gr-whiteboard",
    renderTopRightUI: () => h(StatusBadge),
  });
}

window.addEventListener("keydown", onKeyDown, true);
// Tells the Server that a Person uses the page (FR-159).
function reportActivity() {
  const now = Date.now();
  if (!token || (now - lastActivitySentMs < ACTIVITY_MS && status.idleStopAtMs === null)) return;
  lastActivitySentMs = now;
  post("/api/activity", {}).catch(() => {
    lastActivitySentMs = 0;
  });
}

for (const type of ["keydown", "pointerdown", "paste", "drop"]) {
  window.addEventListener(type, () => {
    lastInputMs = Date.now();
    reportActivity();
  }, true);
}
window.addEventListener("wheel", reportActivity, { capture: true, passive: true });
// A hidden page gives the Leader role to a page on screen (FR-085).
document.addEventListener("visibilitychange", reportVisibility);

if (!token) {
  showNotice("This page needs the full link that Claude Code showed you. It ends with #t= and a code.");
} else {
  createRoot(document.getElementById("root")).render(h(App));
}
