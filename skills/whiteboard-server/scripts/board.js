#!/usr/bin/env node
"use strict";

// Starts and stops the Board Server. Works the same in bash, PowerShell, and cmd.
//   node scripts/board.js start [--lan]   starts server.js in the background (if it is not running) and
//                                         prints the Board URL(s)
//   node scripts/board.js status          prints the state of the running Server
//   node scripts/board.js stop            saves the Board and stops the Server
// Flags for start are passed to server.js (--port, --control-port, --data, ...).
// --control-port N is also used to find a running Server (default 47831).
// Prints one JSON line. Exit code 0 if ok, 1 if not.

const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const { readFlags, parseConfig } = require("./lib/config");
const { dataPaths } = require("./lib/data-files");

const SKILL_DIR = path.resolve(__dirname, "..");
const SERVER = path.join(__dirname, "server.js");
const START_TIMEOUT_MS = 15000;
const STOP_TIMEOUT_MS = 10000;
const POLL_MS = 200;
const REQUEST_TIMEOUT_MS = 3000;

// @purity non-pure
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Resolves to { status, body } or null when nothing answers on the port.
// @purity non-pure
function request(port, method, urlPath) {
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: urlPath, timeout: REQUEST_TIMEOUT_MS }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
        } catch (error) {
          resolve({ status: res.statusCode, body: null });
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", () => resolve(null));
    req.end();
  });
}

// @purity non-pure
async function readStatus(port) {
  const reply = await request(port, "GET", "/v1/status");
  if (reply === null) return { running: false };
  if (!reply.body || reply.status !== 200) return { running: false, otherProgram: true };
  return { running: true, status: reply.body };
}

// The newest ServerFailed line written after `sinceMs`, or null.
// @purity semi-pure-b
function failureInLog(logPath, sinceMs) {
  let text = "";
  try {
    text = fs.readFileSync(logPath, "utf8");
  } catch (error) {
    return null;
  }
  for (const line of text.split("\n").reverse()) {
    try {
      const event = JSON.parse(line);
      if (event.event === "ServerFailed" && event.atMs >= sinceMs) return event;
    } catch (error) {
      // Not a JSON line.
    }
  }
  return null;
}

// @purity pure
function startedResult(status, alreadyRunning) {
  return {
    v: 1, ok: true, alreadyRunning, lan: status.lan, url: status.url, lanUrls: status.lanUrls,
    pageCount: status.pageCount, logPath: status.logPath, dataDir: status.dataDir,
  };
}

// @purity non-pure
async function start(argv, controlPort) {
  const wantLan = argv.includes("--lan");
  const now = await readStatus(controlPort);
  if (now.otherProgram) return { v: 1, ok: false, error: "PortInUse", message: `another program uses port ${controlPort}` };
  if (now.running) {
    if (now.status.lan !== wantLan) {
      return { v: 1, ok: false, error: "RunningInOtherMode", message: `the Server is running with lan=${now.status.lan}; stop it first` };
    }
    return startedResult(now.status, true);
  }
  const parsed = parseConfig(argv, "", SKILL_DIR);
  if (!parsed.ok) return { v: 1, ok: false, error: parsed.reason, message: parsed.message };
  const paths = dataPaths(parsed.config.dataDir);
  if (wantLan && !(fs.existsSync(paths.cert) && fs.existsSync(paths.key))) {
    return { v: 1, ok: false, error: "CertMissing", message: "run setup.js --lan first" };
  }
  const sinceMs = Date.now() - 1000;
  // No shell: the path of node may contain spaces. Detached, so the Server keeps running after this exits.
  const child = spawn(process.execPath, [SERVER, ...argv], {
    cwd: SKILL_DIR, detached: true, stdio: "ignore", windowsHide: true,
  });
  child.unref();
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await delay(POLL_MS);
    const failed = failureInLog(parsed.config.logPath, sinceMs);
    if (failed) return { v: 1, ok: false, error: failed.reason, message: failed.message, logPath: parsed.config.logPath };
    const later = await readStatus(controlPort);
    if (later.running) return startedResult(later.status, false);
  }
  return { v: 1, ok: false, error: "StartTimeout", message: "the Server did not start", logPath: parsed.config.logPath };
}

// @purity non-pure
async function stop(controlPort) {
  const reply = await request(controlPort, "POST", "/v1/stop");
  if (reply === null) return { v: 1, ok: true, wasRunning: false };
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await delay(POLL_MS);
    if (!(await readStatus(controlPort)).running) return { v: 1, ok: true, wasRunning: true };
  }
  return { v: 1, ok: false, error: "StopTimeout", message: "the Server did not stop" };
}

// @purity non-pure
async function main() {
  const [command, ...argv] = process.argv.slice(2);
  const controlPort = Number(readFlags(argv).get("--control-port") || 47831);
  let result;
  if (command === "start") result = await start(argv, controlPort);
  else if (command === "stop") result = await stop(controlPort);
  else if (command === "status") {
    const now = await readStatus(controlPort);
    result = now.running ? { v: 1, ok: true, ...now.status } : { v: 1, ok: false, error: "NotRunning" };
  } else {
    process.stderr.write("usage: board.js start [--lan] | status | stop   [--control-port N]\n");
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(result) + "\n");
  process.exit(result.ok ? 0 : 1);
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({ v: 1, ok: false, error: "Internal", message: String(error && error.message) }) + "\n");
  process.exit(1);
});
