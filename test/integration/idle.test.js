"use strict";

// 0.6.1 (R-039): the real server.js stops itself after the idle time, warns the Pages before, starts the time
// again on a touch, and writes the Board as an .excalidraw file. Short times (--idle-stop-ms) keep the test fast.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const SERVER = path.join(__dirname, "..", "..", "skills", "whiteboard-server", "scripts", "server.js");
// Apart from the ports of the other test files, and far below 47830.
const PORT = 10000 + Math.floor(Math.random() * 1800) * 2;
const CONTROL_PORT = PORT + 1;

// @purity non-pure
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// @purity non-pure
async function until(check, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await delay(25);
  }
}

// @purity non-pure
function call(port, method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? "" : JSON.stringify(body);
    const req = http.request({
      host: "127.0.0.1", port, method, path: urlPath,
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data), ...headers },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(data);
  });
}

// @purity non-pure
function readLog(logPath) {
  try {
    return fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    return [];
  }
}

// @purity non-pure
function openPage(token, pageId) {
  const received = [];
  const req = http.get({ host: "127.0.0.1", port: PORT, path: `/api/stream?t=${token}&page=${pageId}` }, (res) => {
    let buffer = "";
    res.setEncoding("utf8");
    res.on("data", (chunk) => {
      buffer += chunk;
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop();
      for (const block of blocks) {
        const type = /^event: (.*)$/m.exec(block);
        const data = /^data: (.*)$/m.exec(block);
        if (type && data) received.push({ type: type[1], data: JSON.parse(data[1]) });
      }
    });
  });
  req.on("error", () => {});
  return {
    received,
    post: (urlPath, body) => call(PORT, "POST", urlPath, { page: pageId, ...body }, { "x-board-token": token }),
    close: () => req.destroy(),
  };
}

test("the Server warns, starts again on a touch, then stops after the idle time and exports the Board (FR-159 to FR-162)", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wbc-idle-"));
  fs.writeFileSync(path.join(dataDir, "board.json"), JSON.stringify({ v: 1, elements: [
    { id: "r1", type: "rectangle", version: 1, versionNonce: 1, x: 0, y: 0, width: 10, height: 10, updated: 1 },
    { id: "gone", type: "rectangle", version: 2, versionNonce: 1, x: 0, y: 0, width: 10, height: 10, updated: Date.now(), isDeleted: true },
  ] }));
  const logPath = path.join(dataDir, "server.log");
  const child = spawn(process.execPath, [
    SERVER, "--data", dataDir, "--port", String(PORT), "--control-port", String(CONTROL_PORT), "--idle-stop-ms", "3000",
  ], { stdio: "ignore" });
  const exited = new Promise((resolve) => child.on("exit", resolve));
  let page = null;
  try {
    await until(() => readLog(logPath).find((e) => e.event === "ServerReady"), 10000, "ServerReady");
    assert.equal((await call(PORT, "GET", "/ca.crt")).status, 404, "no CA file without LAN mode (FR-156)");
    const token = fs.readFileSync(path.join(dataDir, "token.txt"), "utf8").trim();
    page = openPage(token, "pageIDLE0001");
    await until(() => page.received.find((m) => m.type === "hello"), 5000, "hello");
    assert.equal(page.received.find((m) => m.type === "hello").data.idleStopAtMs, null);

    // The warning comes at half of a short idle time (1.5 s); a touch ends it.
    const warning = await until(() => page.received.find((m) => m.type === "idle" && m.data.stopAtMs), 5000, "idle warning");
    assert.ok(warning.data.stopAtMs > Date.now());
    assert.ok(readLog(logPath).some((e) => e.event === "IdleWarning"));
    assert.equal((await page.post("/api/activity", {})).status, 200);
    await until(() => page.received.some((m) => m.type === "idle" && m.data.stopAtMs === null), 2000, "warning cleared");

    // A call of the Agent is a touch too.
    await delay(1000);
    assert.equal((await call(CONTROL_PORT, "GET", "/v1/status")).status, 200);
    await delay(2200);
    assert.equal(readLog(logPath).some((e) => e.event === "ServerStopped"), false, "the call started the time again");

    // Nobody touches it now: it stops and exports.
    assert.equal(await Promise.race([exited, delay(8000).then(() => "running")]), 0);
    const stopped = readLog(logPath).find((e) => e.event === "ServerStopped");
    assert.equal(stopped.reason, "idle");
    assert.equal(stopped.idleMinutes, 0);
    assert.equal(path.dirname(stopped.exportPath), path.join(dataDir, "exports"));
    assert.match(path.basename(stopped.exportPath), /^whiteboard-\d{8}-\d{6}\.excalidraw$/);
    const file = JSON.parse(fs.readFileSync(stopped.exportPath, "utf8"));
    assert.deepEqual([file.type, file.version, file.elements.map((e) => e.id)], ["excalidraw", 2, ["r1"]]);
    assert.ok(fs.existsSync(path.join(dataDir, "board.json")), "the Board is saved as well");
  } finally {
    if (page) page.close();
    child.kill();
  }
});

test("a stop on request says reason request and writes no export (FR-162)", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wbc-idle-stop-"));
  const logPath = path.join(dataDir, "server.log");
  const child = spawn(process.execPath, [SERVER, "--data", dataDir, "--port", String(PORT + 2), "--control-port", String(CONTROL_PORT + 2)], { stdio: "ignore" });
  const exited = new Promise((resolve) => child.on("exit", resolve));
  await until(() => readLog(logPath).find((e) => e.event === "ServerReady"), 10000, "ServerReady");
  await call(CONTROL_PORT + 2, "POST", "/v1/stop", {});
  assert.equal(await exited, 0);
  const stopped = readLog(logPath).find((e) => e.event === "ServerStopped");
  assert.deepEqual([stopped.reason, stopped.exportPath], ["request", undefined]);
  assert.equal(fs.existsSync(path.join(dataDir, "exports")), false);
});
