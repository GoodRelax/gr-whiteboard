#!/usr/bin/env node
"use strict";

// Board Server: serves the whiteboard page, keeps the Board, saves it to a JSON file,
// tells Claude Code about new Messages (JSON lines on stdout and in <data>/server.log),
// and takes Answers on a local HTTP API.
// Start it with board.js (it runs this file in the background). See docs/spec-en.md.

const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");

const { parseConfig } = require("./lib/config");
const { createEventSink, redact } = require("./lib/event-sink");
const { createTrackerState, trackMessages } = require("./lib/message-tracker");
const { summarize, summarizeBoard, diffBoards, countOf, toSentEvent } = require("./lib/board-diff");
const { toItems, pruneDeleted } = require("./lib/board-store");
const { createBoardHub } = require("./lib/board-hub");
const { createBoardApi } = require("./lib/board-api");
const { createControlApi } = require("./lib/control-api");
const {
  dataPaths, loadBoard, saveBoard, loadOrCreateToken, writeFileAtomic, readJsonOrNull, loadFiles, saveFile,
} = require("./lib/data-files");
const { addFiles } = require("./lib/board-files");
const { lanAddresses, boardUrls } = require("./lib/lan");
const { AppError } = require("./lib/app-error");

const SKILL_DIR = path.resolve(__dirname, "..");
const PAGE_DIR = path.join(SKILL_DIR, "page");
const PACKAGE_VERSION = require("../package.json").version;
// Text last changed this long before the Server started is old, even if a page sends it later (FR-009a).
const OLD_TEXT_MARGIN_MS = 30000;
const DELETED_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
// say waits this long for the Leader page; after that it answers 202 and the Answer stays queued.
const SAY_WAIT_MS = 8000;
const PNG_BASE64_HEAD = "iVBORw0KGgo";
const STARTED_AT_MS = Date.now();
const EXIT_CODE = Object.freeze({ ok: 0, InvalidConfig: 2, CertMissing: 3, PortInUse: 4, Internal: 6 });

// @purity semi-pure-b
function readCert(paths) {
  try {
    return { cert: fs.readFileSync(paths.cert), key: fs.readFileSync(paths.key) };
  } catch (error) {
    return null;
  }
}

// @purity non-pure
function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server.address().port));
  });
}

// @purity non-pure
async function main() {
  const parsed = parseConfig(process.argv.slice(2), os.tmpdir(), SKILL_DIR);
  const logPath = parsed.ok ? parsed.config.logPath : parsed.logPath;
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  // The Server writes the log itself, so it is UTF-8 in every shell (PowerShell redirection is not).
  const logFd = fs.openSync(logPath, "w");
  const secrets = [];
  // @purity non-pure
  const write = (line) => {
    process.stdout.write(line);
    fs.writeSync(logFd, line);
  };
  const events = createEventSink({ write, nowMs: Date.now, secrets });
  const hide = (text) => redact(text, secrets);

  if (!parsed.ok) {
    events.emit({ event: "ServerFailed", reason: parsed.reason, message: parsed.message });
    process.exit(EXIT_CODE[parsed.reason]);
  }
  const config = parsed.config;
  const paths = dataPaths(config.dataDir);
  const token = loadOrCreateToken(paths.token);
  secrets.push(token);

  let tls = null;
  if (config.lan) {
    tls = readCert(paths);
    if (!tls) {
      events.emit({ event: "ServerFailed", reason: "CertMissing", message: "no certificate; run setup.js --lan first" });
      process.exit(EXIT_CODE.CertMissing);
    }
  }

  const loaded = loadBoard(paths.board, Date.now());
  if (loaded.warning) events.emit({ event: "BoardWarning", message: loaded.warning });
  const elements = new Map();
  for (const element of pruneDeleted(loaded.elements, Date.now(), DELETED_KEEP_MS)) {
    if (element && typeof element.id === "string") elements.set(element.id, element);
  }

  // The image files of the Board (FR-082). Files that fail the check are left out.
  const files = new Map();
  const loadedFiles = addFiles(files, loadFiles(paths.files));
  for (const bad of loadedFiles.rejected) events.emit({ event: "FileRejected", id: bad.id, reason: bad.reason });

  // When the Server first got each Element, so added texts can be listed in the order they were written.
  const firstSeenMs = new Map();
  // The Board at the last Send (FR-076). Kept on disk, so a restart does not lose what is not sent yet.
  const savedBaseline = readJsonOrNull(paths.baseline);
  let baseline = savedBaseline && Array.isArray(savedBaseline.items)
    ? new Map(savedBaseline.items.map((item) => [item.id, item]))
    : summarizeBoard(elements.values());

  // @purity non-pure
  function saveBaseline() {
    try {
      writeFileAtomic(paths.baseline, JSON.stringify({ v: 1, items: [...baseline.values()] }));
    } catch (error) {
      events.emit({ event: "SaveFailed", message: String(error && error.message) });
    }
  }

  let dirty = false;
  let stopping = false;
  const clock = { setTimeout, clearTimeout, setInterval, clearInterval };
  const hub = createBoardHub({
    elements, events, clock, jobTimeoutMs: config.jobTimeoutMs, gapPx: config.answerGapPx, indentPx: config.answerIndentPx,
    onBoardChanged: (changed) => {
      dirty = true;
      const now = Date.now();
      for (const element of changed) {
        if (!firstSeenMs.has(element.id)) firstSeenMs.set(element.id, now);
      }
    },
    // Claude's own Answers are not news for Claude.
    onAnswerWritten: (written) => {
      for (const element of written) baseline.set(element.id, summarize(element));
      saveBaseline();
    },
    files,
    onFilesAdded: (added) => {
      for (const file of added) {
        try {
          saveFile(paths.files, file);
        } catch (error) {
          events.emit({ event: "SaveFailed", message: String(error && error.message) });
        }
      }
    },
  });

  // @purity semi-pure-b
  const messageItems = () => toItems(elements).filter((item) => !item.isAnswer);
  let trackerState = createTrackerState(messageItems(), STARTED_AT_MS - OLD_TEXT_MARGIN_MS);
  // By default, nothing goes to the Agent until the Person presses Send; then the Agent gets every change
  // since the last Send (FR-070). With autoSend on, each Message goes when it is Settled, as before (FR-074).
  let autoSend = false;

  // @purity semi-pure-b
  function currentDiff() {
    return diffBoards(baseline, summarizeBoard(elements.values()), firstSeenMs, hub.editingIds());
  }

  // @purity non-pure
  function tick() {
    if (!autoSend) {
      hub.setInbox(countOf(currentDiff()), autoSend);
      return;
    }
    const result = trackMessages(trackerState, { items: messageItems(), editingIds: hub.editingIds() }, Date.now(), config.settleMs);
    trackerState = result.trackerState;
    for (const event of result.messageEvents) events.emit(event);
  }

  // The new Baseline is the Board now, except the texts that someone is still typing (FR-076).
  // @purity non-pure
  function moveBaseline() {
    const next = summarizeBoard(elements.values());
    for (const id of hub.editingIds()) {
      if (baseline.has(id)) next.set(id, baseline.get(id));
      else next.delete(id);
    }
    baseline = next;
    saveBaseline();
  }

  // Sends every change since the last Send as one MessagesSent (FR-072).
  // @purity non-pure
  function sendChanges() {
    const diff = currentDiff();
    const sent = countOf(diff);
    if (sent > 0) events.emit(toSentEvent(diff));
    moveBaseline();
    hub.setInbox(0, autoSend);
    return { sent };
  }

  // @purity non-pure
  function setAutoSend(on) {
    if (on === autoSend) return;
    if (on) {
      sendChanges();
      trackerState = createTrackerState(messageItems(), Date.now());
    } else {
      moveBaseline();
    }
    autoSend = on;
    hub.setInbox(on ? 0 : countOf(currentDiff()), autoSend);
  }

  const tickTimer = setInterval(tick, config.tickMs);

  // @purity non-pure
  function saveNow() {
    if (!dirty) return;
    dirty = false;
    try {
      saveBoard(paths.board, [...elements.values()]);
    } catch (error) {
      dirty = true;
      events.emit({ event: "SaveFailed", message: String(error && error.message) });
    }
  }
  const saveTimer = setInterval(saveNow, config.saveMs);

  const addresses = config.lan ? lanAddresses(os.networkInterfaces()) : [];
  const urls = boardUrls({ lan: config.lan, port: config.port, token, addresses });

  // @purity non-pure
  async function takeShot(focusId) {
    const { done } = hub.requestShot(focusId);
    const { png } = await done;
    if (!png.startsWith(PNG_BASE64_HEAD)) throw new AppError("JobFailed", 502, "the page did not send a PNG image");
    fs.mkdirSync(config.shotDir, { recursive: true });
    const filePath = path.join(config.shotDir, `shot-${Date.now()}.png`);
    fs.writeFileSync(filePath, Buffer.from(png, "base64"));
    return { path: filePath };
  }

  const boardApi = createBoardApi({
    hub, inbox: { send: sendChanges, setAutoSend }, token, pageDir: PAGE_DIR, redact: hide, clock,
  });
  const boardServer = tls
    ? https.createServer({ cert: tls.cert, key: tls.key }, boardApi.handle)
    : http.createServer(boardApi.handle);
  let controlApi = null;

  // @purity non-pure
  async function stop() {
    if (stopping) return;
    stopping = true;
    clearInterval(tickTimer);
    clearInterval(saveTimer);
    hub.close();
    boardApi.closeStreams();
    saveNow();
    boardServer.closeAllConnections();
    await new Promise((resolve) => boardServer.close(() => resolve()));
    if (controlApi) await controlApi.close();
    events.emit({ event: "ServerStopped" });
    process.exit(EXIT_CODE.ok);
  }

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  // @purity semi-pure-b
  function status() {
    return {
      state: stopping ? "Stopping" : "Ready",
      version: PACKAGE_VERSION,
      lan: config.lan,
      port: config.port,
      controlPort: config.controlPort,
      url: urls.local,
      lanUrls: urls.lan,
      pageCount: hub.pageCount(),
      queueLength: hub.queueLength(),
      signal: hub.signal(),
      autoSend,
      unsent: autoSend ? 0 : countOf(currentDiff()),
      itemCount: toItems(elements).length,
      dataDir: config.dataDir,
      logPath: config.logPath,
      shotDir: config.shotDir,
    };
  }

  controlApi = createControlApi({
    handlers: {
      status,
      board: () => ({ items: toItems(elements), pageCount: hub.pageCount() }),
      say: (text, at) => hub.queueAnswer(text, at),
      shot: takeShot,
      signal: (state) => hub.setSignal(state),
      stop,
    },
    maxTextChars: config.maxTextChars,
    sayWaitMs: SAY_WAIT_MS,
    redact: hide,
    clock,
  });

  try {
    await listen(boardServer, config.port, config.lan ? "0.0.0.0" : "127.0.0.1");
    await controlApi.listen(config.controlPort);
  } catch (error) {
    const inUse = error && error.code === "EADDRINUSE";
    events.emit({
      event: "ServerFailed",
      reason: inUse ? "PortInUse" : "Internal",
      message: hide(`cannot listen: ${error && error.message}`),
    });
    process.exit(inUse ? EXIT_CODE.PortInUse : EXIT_CODE.Internal);
  }

  events.emit({
    event: "ServerReady",
    version: PACKAGE_VERSION,
    lan: config.lan,
    port: config.port,
    controlPort: config.controlPort,
    itemCount: toItems(elements).length,
    lanAddressCount: addresses.length,
  });
}

main().catch((error) => {
  const line = JSON.stringify({ v: 1, event: "ServerFailed", reason: "Internal", message: String(error && error.stack), atMs: Date.now() });
  process.stdout.write(line + "\n");
  process.exit(EXIT_CODE.Internal);
});
