#!/usr/bin/env node
"use strict";

// Client for the Board Server (skill whiteboard-server). Works the same in bash, PowerShell, and cmd
// (no curl, tail, grep, or heredoc).
//   node scripts/client.js say [--file PATH] [--at X,Y]   text from PATH, or from stdin
//   node scripts/client.js shot [ITEM_ID]
//   node scripts/client.js board
//   node scripts/client.js stop
//   node scripts/client.js wait [--timeout-ms N]         waits for ServerReady or ServerFailed in the log
//   node scripts/client.js watch                         prints new events from the log, one per line, forever
// Common flags: --port N (the control port, default 47831),
//               --log PATH (default <skills folder>/whiteboard-server/.data/server.log).
// HTTP commands print the JSON reply; exit code 0 for HTTP 2xx, 1 otherwise.

const fs = require("fs");
const http = require("http");
const path = require("path");

const DEFAULT_PORT = 47831;
const DEFAULT_LOG = path.join(__dirname, "..", "..", "whiteboard-server", ".data", "server.log");
const DEFAULT_WAIT_MS = 90000;
const POLL_MS = 300;
// An older log may still be there when `wait` starts; ignore events older than this.
const WAIT_LOOKBACK_MS = 5000;
// Some editors on Windows put this mark at the start of UTF-8 files.
const BYTE_ORDER_MARK = new RegExp("^" + String.fromCharCode(0xfeff));
const WATCH_EVENTS = new Set([
  "ServerReady", "MessageReceived", "MessageEdited", "DrawingAdded", "PageJoined", "PageLeft",
  "AnswerFailed", "SaveFailed", "BoardWarning", "ServerStopped", "ServerFailed",
]);

// @purity pure
function parseArgs(argv) {
  const args = { command: argv[0], port: DEFAULT_PORT, log: DEFAULT_LOG, at: null, file: null, timeoutMs: DEFAULT_WAIT_MS, rest: [] };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port") args.port = Number(argv[(i += 1)]);
    else if (arg === "--log") args.log = argv[(i += 1)];
    else if (arg === "--file") args.file = argv[(i += 1)];
    else if (arg === "--timeout-ms") args.timeoutMs = Number(argv[(i += 1)]);
    else if (arg === "--at") {
      const [x, y] = String(argv[(i += 1)]).split(",").map(Number);
      args.at = { x, y };
    } else args.rest.push(arg);
  }
  return args;
}

// @purity pure
function parseEventLine(line) {
  try {
    const event = JSON.parse(line);
    return event && typeof event.event === "string" ? event : null;
  } catch (error) {
    return null;
  }
}

// @purity non-pure
function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

// @purity non-pure
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// @purity non-pure
function request(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? "" : JSON.stringify(body);
    const req = http.request({
      host: "127.0.0.1", port, method, path: urlPath,
      headers: { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(data) },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(data);
  });
}

// @purity pure
function firstLine(buffer) {
  const end = buffer.indexOf(10);
  return end < 0 ? "" : buffer.subarray(0, end).toString("utf8");
}

// Reads the bytes added to `filePath` since `offset`. The Server empties the log when it starts,
// so the log was rewritten if it got shorter or its first line changed; then it reads from 0.
// @purity semi-pure-b
function readNew(filePath, offset, knownFirstLine) {
  let whole;
  try {
    whole = fs.readFileSync(filePath);
  } catch (error) {
    return { offset: 0, text: "", firstLine: "", rewritten: offset > 0 };
  }
  const head = firstLine(whole);
  const rewritten = whole.length < offset || (knownFirstLine !== "" && head !== "" && head !== knownFirstLine);
  const start = rewritten ? 0 : offset;
  return { offset: whole.length, text: whole.subarray(start).toString("utf8"), firstLine: head, rewritten };
}

// Calls onLine for each complete new line in the log, until onLine returns true.
// @purity non-pure
async function followLog(filePath, fromStart, onLine, deadlineMs) {
  let offset = 0;
  let knownFirstLine = "";
  if (!fromStart) {
    const now = readNew(filePath, 0, "");
    offset = now.offset;
    knownFirstLine = now.firstLine;
  }
  let partial = "";
  for (;;) {
    const chunk = readNew(filePath, offset, knownFirstLine);
    if (chunk.rewritten) partial = "";
    offset = chunk.offset;
    knownFirstLine = chunk.firstLine;
    const lines = (partial + chunk.text).split("\n");
    partial = lines.pop();
    for (const line of lines) {
      if (line.trim() !== "" && onLine(line.trim())) return true;
    }
    if (deadlineMs !== null && Date.now() >= deadlineMs) return false;
    await delay(POLL_MS);
  }
}

// @purity non-pure
async function waitForReady(args) {
  const sinceMs = Date.now() - WAIT_LOOKBACK_MS;
  const found = await followLog(args.log, true, (line) => {
    const event = parseEventLine(line);
    if (!event || event.atMs < sinceMs) return false;
    if (event.event === "ServerReady" || event.event === "ServerFailed") {
      process.stdout.write(line + "\n");
      return true;
    }
    return false;
  }, Date.now() + args.timeoutMs);
  if (!found) {
    process.stdout.write(JSON.stringify({ v: 1, event: "WaitTimeout", message: `no ServerReady in ${args.log}` }) + "\n");
    process.exit(1);
  }
  process.exit(0);
}

// @purity non-pure
async function watchEvents(args) {
  await followLog(args.log, false, (line) => {
    const event = parseEventLine(line);
    if (event && WATCH_EVENTS.has(event.event)) process.stdout.write(line + "\n");
    return false;
  }, null);
}

// @purity non-pure
async function sendHttp(args) {
  let reply;
  switch (args.command) {
    case "say": {
      const raw = args.file ? fs.readFileSync(args.file, "utf8") : await readStdin();
      // Remove the one line break that editors and heredocs add at the end.
      const text = raw.replace(BYTE_ORDER_MARK, "").replace(/\r?\n$/, "");
      const body = args.at ? { text, at: args.at } : { text };
      reply = await request(args.port, "POST", "/v1/say", body);
      break;
    }
    case "shot":
      reply = await request(args.port, "POST", "/v1/shot", args.rest[0] ? { focusId: args.rest[0] } : {});
      break;
    case "board":
      reply = await request(args.port, "GET", "/v1/board");
      break;
    case "stop":
      reply = await request(args.port, "POST", "/v1/stop");
      break;
    default:
      process.stderr.write("usage: client.js say|shot|board|stop|wait|watch [--port N] [--log PATH] [--file PATH] [--at X,Y] [ITEM_ID]\n");
      process.exit(2);
  }
  process.stdout.write(reply.text + "\n");
  process.exit(reply.status >= 200 && reply.status < 300 ? 0 : 1);
}

// @purity non-pure
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "wait") return waitForReady(args);
  if (args.command === "watch") return watchEvents(args);
  return sendHttp(args);
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({ v: 1, error: "ClientError", message: String(error && error.message) }) + "\n");
  process.exit(1);
});
