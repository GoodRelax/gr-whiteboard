"use strict";

// The real server.js as a child process, with a fake page (SSE + POST) and the Control API.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const SERVER = path.join(__dirname, "..", "..", "skills", "whiteboard-server", "scripts", "server.js");
// Below the dynamic port range (49152 and up on Windows and macOS, 32768 and up on Linux): Windows reserves
// blocks there (netsh int ipv4 show excludedportrange), and listening on them fails with EACCES.
const BASE_PORT = 20000 + Math.floor(Math.random() * 9000);
const PORT = BASE_PORT;
const CONTROL_PORT = BASE_PORT + 1;

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
    await delay(50);
  }
}

// @purity non-pure
function call(port, method, urlPath, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? "" : JSON.stringify(body);
    const req = http.request({
      host: "127.0.0.1", port, method, path: urlPath,
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data), ...headers },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try {
          json = JSON.parse(text);
        } catch (error) {
          json = null;
        }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on("error", reject);
    req.end(data);
  });
}

// A fake page: reads Server-Sent Events into `received`.
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
    find: (type) => received.find((m) => m.type === type),
    post: (urlPath, body) => call(PORT, "POST", urlPath, { body: { page: pageId, ...body }, headers: { "x-board-token": token } }),
    close: () => req.destroy(),
  };
}

// Waits for ServerReady; stops at once with the reason when the Server sends ServerFailed.
// @purity non-pure
async function untilReady(logPath) {
  const event = await until(() => readLog(logPath).find((e) => e.event === "ServerReady" || e.event === "ServerFailed"), 10000, "ServerReady");
  if (event.event === "ServerFailed") throw new Error(`the Server did not start: ${event.reason} ${event.message}`);
  return event;
}

// @purity non-pure
function readLog(logPath) {
  try {
    return fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    return [];
  }
}

// @purity pure
function textElement(id, text, extra = {}) {
  return {
    id, type: "text", version: 1, versionNonce: 7, isDeleted: false, x: 50, y: 60, width: 80, height: 25,
    text, containerId: null, updated: Date.now(), ...extra,
  };
}

test("page sync, Message events, Answers, safety checks, and saving", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wbc-server-"));
  const logPath = path.join(dataDir, "server.log");
  const child = spawn(process.execPath, [
    SERVER, "--data", dataDir, "--port", String(PORT), "--control-port", String(CONTROL_PORT),
    "--settle-ms", "200", "--tick-ms", "50", "--save-ms", "100",
  ], { stdio: "ignore" });
  const exited = new Promise((resolve) => child.on("exit", resolve));
  try {
    await untilReady(logPath);
    const token = fs.readFileSync(path.join(dataDir, "token.txt"), "utf8").trim();
    assert.ok(!fs.readFileSync(logPath, "utf8").includes(token), "the log must not contain the Token");

    const page = await call(PORT, "GET", "/");
    assert.equal(page.status, 200);
    assert.match(page.headers["content-security-policy"], /script-src 'self' https:\/\/esm\.sh/);
    assert.equal((await call(PORT, "GET", `/api/stream?t=wrong&page=pageAAAA1`)).status, 403);
    assert.equal((await call(PORT, "POST", "/api/elements", { body: {}, headers: { "x-board-token": "wrong" } })).status, 403);
    const foreign = await call(PORT, "POST", "/api/elements", { body: {}, headers: { "x-board-token": token, origin: "https://evil.example" } });
    assert.equal(foreign.status, 403);

    const leader = openPage(token, "pageAAAA1");
    const other = openPage(token, "pageBBBB2");
    await until(() => leader.find("hello") && other.find("hello"), 5000, "hello");
    assert.equal(leader.find("hello").data.leader, true);
    assert.equal(other.find("hello").data.leader, false);

    // A person types on the other page. Nothing goes to the Agent until the person presses Send.
    assert.deepEqual(other.find("hello").data.inbox, { unsent: 0, autoSend: false });
    await other.post("/api/elements", { elements: [textElement("m1", "hello")], editingId: "m1" });
    await until(() => leader.find("elements"), 5000, "elements on the leader page");
    await delay(400);
    assert.equal(other.received.some((m) => m.type === "inbox"), false, "text being typed is not counted");
    await other.post("/api/elements", { elements: [], editingId: null });
    await until(() => other.received.some((m) => m.type === "inbox" && m.data.unsent === 1), 5000, "unsent 1");
    assert.equal(readLog(logPath).some((e) => e.event.startsWith("Message")), false, "nothing goes to the Agent before Send");
    assert.deepEqual((await other.post("/api/send", {})).json.sent, 1);
    const sent = await until(() => readLog(logPath).find((e) => e.event === "MessagesSent"), 5000, "MessagesSent");
    assert.deepEqual(sent.messages.map((m) => [m.id, m.text, m.x, m.y]), [["m1", "hello", 50, 60]]);
    assert.deepEqual(sent.changes, []);
    await until(() => other.received.some((m) => m.type === "inbox" && m.data.unsent === 0), 5000, "unsent 0");
    assert.deepEqual((await other.post("/api/send", {})).json.sent, 0, "Send with nothing new sends nothing");

    // Claude answers; the Leader page writes the Answer.
    const said = call(CONTROL_PORT, "POST", "/v1/say", { body: { text: "hi there" } });
    const job = await until(() => leader.find("job"), 5000, "job");
    // Chat style: right below the Message (y 60 + height 25 + gap 12), 170 px to the left.
    assert.deepEqual([job.data.kind, job.data.text, job.data.x, job.data.y], ["answer", "hi there", -120, 97]);
    const answer = textElement("a1", "hi there", { x: job.data.x, y: job.data.y, customData: { whiteboardChat: "answer" } });
    assert.equal((await leader.post("/api/job", { jobId: job.data.jobId, ok: true, elements: [answer] })).status, 200);
    const reply = await said;
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.json.ids, ["a1"]);
    await delay(400);
    assert.equal((await call(CONTROL_PORT, "GET", "/v1/status")).json.unsent, 0, "an Answer is not news for Claude");

    // Moving a text is a change too; the next Send lists it (FR-075).
    await other.post("/api/elements", { elements: [textElement("m1", "hello", { version: 2, x: 250 })], editingId: null });
    await until(() => other.received.some((m) => m.type === "inbox" && m.data.unsent === 1), 5000, "unsent 1 after a move");
    await other.post("/api/send", {});
    const moved = await until(() => readLog(logPath).filter((e) => e.event === "MessagesSent")[1], 5000, "second MessagesSent");
    assert.deepEqual(moved.messages, []);
    assert.deepEqual(moved.changes.map((c) => [c.kind, c.id, c.what, c.from]), [["changed", "m1", ["moved"], { x: 50, y: 60 }]]);

    // With automatic sending on, each text goes to the Agent by itself when it is Settled.
    assert.equal((await other.post("/api/auto-send", { on: true })).status, 200);
    await until(() => leader.received.some((m) => m.type === "inbox" && m.data.autoSend), 5000, "autoSend on");
    await other.post("/api/elements", { elements: [textElement("m2", "auto text", { x: 900, y: 900 })], editingId: null });
    const auto = await until(() => readLog(logPath).find((e) => e.event === "MessageReceived"), 5000, "MessageReceived");
    assert.deepEqual([auto.id, auto.text], ["m2", "auto text"]);

    // The Signal reaches the pages.
    assert.equal((await call(CONTROL_PORT, "POST", "/v1/signal", { body: { state: "working" } })).status, 200);
    await until(() => other.received.some((m) => m.type === "signal" && m.data.state === "working"), 5000, "signal");
    assert.equal((await call(CONTROL_PORT, "POST", "/v1/signal", { body: { state: "bad" } })).json.error, "InvalidSignal");

    // The Control API is for local tools only.
    const fromPage = await call(CONTROL_PORT, "POST", "/v1/say", { body: { text: "x" }, headers: { origin: `http://127.0.0.1:${PORT}` } });
    assert.equal(fromPage.status, 403);
    const board = await call(CONTROL_PORT, "GET", "/v1/board");
    assert.deepEqual(board.json.items.map((i) => [i.id, i.isAnswer]), [["m1", false], ["a1", true], ["m2", false]]);

    leader.close();
    other.close();
    assert.equal((await call(CONTROL_PORT, "POST", "/v1/stop")).status, 202);
    assert.equal(await exited, 0);
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, "board.json"), "utf8"));
    assert.deepEqual(saved.elements.map((e) => e.id).sort(), ["a1", "m1", "m2"]);
    assert.equal(readLog(logPath).at(-1).event, "ServerStopped");
  } finally {
    child.kill();
  }
});

// @purity non-pure
async function startServer(dataDir, logPath) {
  // The log of an earlier run still has its ServerReady.
  fs.rmSync(logPath, { force: true });
  const child = spawn(process.execPath, [
    SERVER, "--data", dataDir, "--port", String(PORT), "--control-port", String(CONTROL_PORT), "--save-ms", "100",
  ], { stdio: "ignore" });
  const exited = new Promise((resolve) => child.on("exit", resolve));
  await untilReady(logPath);
  return { child, exited };
}

const PNG_FILE = Object.freeze({ id: "file0001abcd", mimeType: "image/png", dataURL: "data:image/png;base64,iVBORw0KGgo=", created: 5 });

test("image files go to the other pages, are saved, and come back after a restart (FR-081, FR-082)", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wbc-files-"));
  const logPath = path.join(dataDir, "server.log");
  let server = await startServer(dataDir, logPath);
  try {
    const token = fs.readFileSync(path.join(dataDir, "token.txt"), "utf8").trim();
    const first = openPage(token, "pageFILES1");
    const second = openPage(token, "pageFILES2");
    await until(() => first.find("hello") && second.find("hello"), 5000, "hello");
    assert.deepEqual(first.find("hello").data.files, []);

    const svg = { id: "file0002abcd", mimeType: "image/svg+xml", dataURL: "data:image/svg+xml;base64,PHN2Zz4=" };
    const reply = await first.post("/api/files", { files: [PNG_FILE, svg] });
    assert.equal(reply.json.added, 1);
    assert.deepEqual(reply.json.rejected.map((r) => r.id), ["file0002abcd"]);
    const got = await until(() => second.find("files"), 5000, "files on the other page");
    assert.deepEqual(got.data.files, [PNG_FILE]);
    assert.equal(first.received.some((m) => m.type === "files"), false, "the sender does not get its own file back");
    assert.ok(readLog(logPath).some((e) => e.event === "FileRejected" && e.id === "file0002abcd"));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, "files", "file0001abcd.json"), "utf8")), PNG_FILE);
    assert.equal((await first.post("/api/files", { files: [PNG_FILE] })).json.added, 0, "a known file is not added twice");

    first.close();
    second.close();
    await call(CONTROL_PORT, "POST", "/v1/stop");
    await server.exited;
    server = await startServer(dataDir, logPath);
    const later = openPage(token, "pageFILES3");
    await until(() => later.find("hello"), 5000, "hello after the restart");
    assert.deepEqual(later.find("hello").data.files, [PNG_FILE]);
    later.close();
    await call(CONTROL_PORT, "POST", "/v1/stop");
    await server.exited;
  } finally {
    server.child.kill();
  }
});
