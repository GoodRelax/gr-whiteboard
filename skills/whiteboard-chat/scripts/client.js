#!/usr/bin/env node
"use strict";

// Client for the Board Server (skill whiteboard-server). Works the same in bash, PowerShell, and cmd
// (no curl, tail, grep, or heredoc). From 0.6.0 the Agent uses the MCP tools (mcp.js); this CLI is for
// debugging, for tests, and for the board watch that the skill starts with the Monitor tool (spec 4.12, R-033).
//   node scripts/client.js say [--file PATH] [--at X,Y]   text from PATH, or from stdin
//   node scripts/client.js shot [ITEM_ID] [--scale S]   S in (0, 1]: a smaller PNG (default 1)
//   node scripts/client.js board [--fields id,type,...]  only these fields of each Item
//   node scripts/client.js signal reading|working|waiting|none   shows what Claude is doing on every page
//   node scripts/client.js stop
//   node scripts/client.js wait [--timeout-ms N]         waits for ServerReady or ServerFailed in the log
//   node scripts/client.js watch                         prints new events from the log, one per line, forever
//                                                        (the log of the running Server, unless --log is given)
//                                                        (MessagesSent as a short line; read it with `sent`)
//   node scripts/client.js sent [--at-ms N] [--brief]    prints the full MessagesSent with atMs N (default: the last one);
//                                                        --brief: the new texts, and only id, kind, and type of each change
//   node scripts/client.js draw [--file PATH] [--at X,Y]  draws Skeletons (JSON list, or {"elements": [...]})
//   node scripts/client.js mermaid [--file PATH] [--at X,Y]   draws a Mermaid diagram
//   node scripts/client.js edit [--file PATH]            changes Items (JSON list, or {"changes": [...]})
//   node scripts/client.js delete ID [ID ...] [--confirm]   deletes Items (--all instead of IDs: every Item)
//   node scripts/client.js undo [--force]                takes back Claude's last Operation
//   draw, mermaid, and edit read from PATH, or from stdin; they wait up to --timeout-ms (default 65000).
// Common flags: --port N (the control port, default 47831),
//               --log PATH (default <skills folder>/whiteboard-server/.data/server.log).
// HTTP commands print the JSON reply; exit code 0 for HTTP 2xx, 1 otherwise.

const fs = require("fs");
const path = require("path");

const { request, requestJson } = require("./lib/control-client");
const { briefSent, pickFields } = require("./lib/brief");

const DEFAULT_PORT = 47831;
const DEFAULT_LOG = path.join(__dirname, "..", "..", "whiteboard-server", ".data", "server.log");
const DEFAULT_WAIT_MS = 90000;
// Two tries of a mermaid Job with the default jobTimeoutMs, plus 5 s (spec 4.11.5).
const DEFAULT_OPERATION_MS = 65000;
const POLL_MS = 300;
const STATUS_TIMEOUT_MS = 3000;
// An older log may still be there when `wait` starts; ignore events older than this.
const WAIT_LOOKBACK_MS = 5000;
// Some editors on Windows put this mark at the start of UTF-8 files.
const BYTE_ORDER_MARK = new RegExp("^" + String.fromCharCode(0xfeff));
const WATCH_EVENTS = new Set([
  "ServerReady", "MessagesSent", "MessageReceived", "MessageEdited", "DrawingAdded", "PageJoined", "PageLeft",
  "AnswerFailed", "SaveFailed", "BoardWarning", "FileRejected", "ServerStopped", "ServerFailed",
]);

// @purity pure
function parseArgs(argv) {
  const args = {
    command: argv[0], port: DEFAULT_PORT, log: DEFAULT_LOG, at: null, atMs: null, file: null, timeoutMs: null, rest: [],
    confirm: false, force: false, all: false, brief: false, fields: null, scale: null, logGiven: false,
  };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port") args.port = Number(argv[(i += 1)]);
    else if (arg === "--confirm") args.confirm = true;
    else if (arg === "--force") args.force = true;
    else if (arg === "--all") args.all = true;
    else if (arg === "--brief") args.brief = true;
    else if (arg === "--fields") args.fields = String(argv[(i += 1)]).split(",").map((f) => f.trim()).filter(Boolean);
    else if (arg === "--scale") args.scale = Number(argv[(i += 1)]);
    else if (arg === "--log") {
      args.log = argv[(i += 1)];
      args.logGiven = true;
    }
    else if (arg === "--file") args.file = argv[(i += 1)];
    else if (arg === "--timeout-ms") args.timeoutMs = Number(argv[(i += 1)]);
    else if (arg === "--at-ms") args.atMs = Number(argv[(i += 1)]);
    else if (arg === "--at") {
      const [x, y] = String(argv[(i += 1)]).split(",").map(Number);
      args.at = { x, y };
    } else args.rest.push(arg);
  }
  if (args.timeoutMs === null) args.timeoutMs = ["draw", "mermaid", "edit"].includes(args.command) ? DEFAULT_OPERATION_MS : DEFAULT_WAIT_MS;
  return args;
}

// The body of draw or edit from the JSON input: a list, or an object with the list under `key` (spec 4.11.5).
// Returns null when the input is not JSON of that form.
// @purity pure
function listBody(raw, key) {
  let value;
  try {
    value = JSON.parse(raw.replace(BYTE_ORDER_MARK, ""));
  } catch (error) {
    return null;
  }
  if (Array.isArray(value)) return { [key]: value };
  if (value && typeof value === "object" && Array.isArray(value[key])) return { [key]: value[key] };
  return null;
}

// A Monitor cuts long lines, so `watch` prints MessagesSent as a short line (FR-078). `read` names the
// MCP tool that reads the whole event (FR-145).
// @purity pure
function shortSent(event) {
  return JSON.stringify({
    v: 1,
    event: "MessagesSent",
    atMs: event.atMs,
    messageCount: Array.isArray(event.messages) ? event.messages.length : 0,
    changeCount: Array.isArray(event.changes) ? event.changes.length : 0,
    read: `board_inbox atMs=${event.atMs}`,
  });
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
  // Without --log, the running Server says where its log is (the plugin keeps it in its data folder, FR-131).
  // A log that does not exist yet is followed when it appears (FR-146).
  let logPath = args.log;
  if (!args.logGiven) {
    try {
      const reply = await requestJson(args.port, "GET", "/v1/status", undefined, STATUS_TIMEOUT_MS);
      if (reply.status === 200 && reply.json && reply.json.logPath) logPath = reply.json.logPath;
    } catch (error) {
      // No Server yet: the default log.
    }
  }
  await followLog(logPath, false, (line) => {
    const event = parseEventLine(line);
    if (!event || !WATCH_EVENTS.has(event.event)) return false;
    process.stdout.write((event.event === "MessagesSent" ? shortSent(event) : line) + "\n");
    return false;
  }, null);
}

// Prints the full MessagesSent with the given atMs, or the last one (FR-078).
// @purity non-pure
function printSent(args) {
  let text = "";
  try {
    text = fs.readFileSync(args.log, "utf8");
  } catch (error) {
    text = "";
  }
  let found = null;
  for (const line of text.split("\n")) {
    const event = parseEventLine(line.trim());
    if (!event || event.event !== "MessagesSent") continue;
    if (args.atMs === null || event.atMs === args.atMs) found = line.trim();
  }
  if (found === null) {
    process.stdout.write(JSON.stringify({ v: 1, error: "NoSent", message: `no MessagesSent in ${args.log}` }) + "\n");
    process.exit(1);
  }
  process.stdout.write((args.brief ? JSON.stringify(briefSent(JSON.parse(found))) : found) + "\n");
  process.exit(0);
}

// @purity non-pure
async function readInput(args) {
  const raw = args.file ? fs.readFileSync(args.file, "utf8") : await readStdin();
  return raw.replace(BYTE_ORDER_MARK, "");
}

// @purity non-pure
function failInvalidJson(what) {
  process.stdout.write(JSON.stringify({ v: 1, error: "InvalidJson", message: `the input is not ${what}` }) + "\n");
  process.exit(1);
}

// @purity non-pure
async function sendHttp(args) {
  let reply;
  switch (args.command) {
    case "draw": {
      const body = listBody(await readInput(args), "elements");
      if (!body) failInvalidJson("a JSON list of Skeletons or {\"elements\": [...]}");
      if (args.at) body.at = args.at;
      reply = await request(args.port, "POST", "/v1/draw", body, args.timeoutMs);
      break;
    }
    case "edit": {
      const body = listBody(await readInput(args), "changes");
      if (!body) failInvalidJson("a JSON list of Changes or {\"changes\": [...]}");
      reply = await request(args.port, "POST", "/v1/edit", body, args.timeoutMs);
      break;
    }
    case "mermaid": {
      const source = (await readInput(args)).replace(/\r?\n$/, "");
      const body = args.at ? { source, at: args.at } : { source };
      reply = await request(args.port, "POST", "/v1/mermaid", body, args.timeoutMs);
      break;
    }
    case "delete": {
      const body = args.all ? { all: true } : { ids: args.rest };
      if (args.confirm) body.confirm = true;
      reply = await request(args.port, "POST", "/v1/delete", body);
      break;
    }
    case "undo":
      reply = await request(args.port, "POST", "/v1/undo", args.force ? { force: true } : {});
      break;
    case "say": {
      const raw = args.file ? fs.readFileSync(args.file, "utf8") : await readStdin();
      // Remove the one line break that editors and heredocs add at the end.
      const text = raw.replace(BYTE_ORDER_MARK, "").replace(/\r?\n$/, "");
      const body = args.at ? { text, at: args.at } : { text };
      reply = await request(args.port, "POST", "/v1/say", body);
      break;
    }
    case "shot": {
      const body = args.rest[0] ? { focusId: args.rest[0] } : {};
      if (args.scale !== null) body.scale = args.scale;
      reply = await request(args.port, "POST", "/v1/shot", body);
      break;
    }
    case "board":
      reply = await request(args.port, "GET", "/v1/board");
      if (args.fields && reply.status === 200) reply.text = JSON.stringify(pickFields(JSON.parse(reply.text), args.fields));
      break;
    case "signal":
      reply = await request(args.port, "POST", "/v1/signal", { state: args.rest[0] || "" });
      break;
    case "stop":
      reply = await request(args.port, "POST", "/v1/stop");
      break;
    default:
      process.stderr.write("usage: client.js say|shot|board|signal|stop|wait|watch|sent|draw|mermaid|edit|delete|undo"
        + " [--port N] [--log PATH] [--file PATH] [--at X,Y] [--at-ms N] [--timeout-ms N] [--confirm] [--all] [--force]"
        + " [--brief] [--fields F,...] [--scale S] [ID ...]\n");
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
  if (args.command === "sent") return printSent(args);
  return sendHttp(args);
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({ v: 1, error: "ClientError", message: String(error && error.message) }) + "\n");
  process.exit(1);
});
