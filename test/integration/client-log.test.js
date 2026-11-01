"use strict";

// client.js wait / watch against a real log file (FR-062, FR-063). Runs node as a child process.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const CLIENT = path.join(__dirname, "..", "..", "skills", "whiteboard-chat", "scripts", "client.js");
// "konnichiwa" in Japanese, built from code points so this file stays ASCII.
const JAPANESE_TEXT = String.fromCharCode(0x3053, 0x3093, 0x306b, 0x3061, 0x306f);

// @purity non-pure
function tempLog() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wbc-test-"));
  return path.join(dir, "server.log");
}

// @purity pure
function eventLine(event, extra = {}) {
  return JSON.stringify({ v: 1, event, ...extra }) + "\n";
}

// @purity non-pure
function runClient(args) {
  const child = spawn(process.execPath, [CLIENT, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (chunk) => { out += chunk; });
  const done = new Promise((resolve) => child.on("exit", (code) => resolve({ code, out })));
  return { child, done, output: () => out };
}

// @purity non-pure
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("wait ignores an old ServerReady and prints the new one", async () => {
  const log = tempLog();
  fs.writeFileSync(log, eventLine("ServerReady", { atMs: Date.now() - 60000 }));
  const run = runClient(["wait", "--log", log, "--timeout-ms", "5000"]);
  await delay(500);
  fs.writeFileSync(log, eventLine("ServerReady", { atMs: Date.now(), port: 1 }));
  const { code, out } = await run.done;
  assert.equal(code, 0);
  assert.equal(JSON.parse(out).port, 1);
});

test("wait times out with WaitTimeout and exit code 1", async () => {
  const log = tempLog();
  const { code, out } = await runClient(["wait", "--log", log, "--timeout-ms", "700"]).done;
  assert.equal(code, 1);
  assert.equal(JSON.parse(out).event, "WaitTimeout");
});

test("watch prints only new watched events, keeps UTF-8, and survives truncation", async () => {
  const log = tempLog();
  fs.writeFileSync(log, eventLine("MessageReceived", { text: "old" }));
  const run = runClient(["watch", "--log", log]);
  await delay(500);
  fs.appendFileSync(log, eventLine("AnswerQueued", { jobId: 1 }));
  fs.appendFileSync(log, eventLine("MessageReceived", { text: JAPANESE_TEXT }));
  await delay(700);
  fs.writeFileSync(log, eventLine("ServerReady", { atMs: 1 }));
  await delay(700);
  run.child.kill();
  await run.done;
  const lines = run.output().trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(lines.map((e) => e.event), ["MessageReceived", "ServerReady"]);
  assert.equal(lines[0].text, JAPANESE_TEXT);
});

// @purity pure
function sentLine(atMs, changeCount) {
  const changes = Array.from({ length: changeCount }, (_, i) => ({ kind: "changed", id: `c${i}`, what: ["moved"] }));
  return eventLine("MessagesSent", { messages: [{ id: "m1", text: JAPANESE_TEXT }], changes, atMs });
}

test("watch prints MessagesSent as a short line that names board_inbox, and sent prints it in full (FR-078, FR-145)", async () => {
  const log = tempLog();
  fs.writeFileSync(log, "");
  const run = runClient(["watch", "--log", log]);
  await delay(500);
  fs.appendFileSync(log, sentLine(1000, 200));
  fs.appendFileSync(log, sentLine(2000, 1));
  await delay(700);
  run.child.kill();
  await run.done;
  const short = run.output().trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(short[0], {
    v: 1, event: "MessagesSent", atMs: 1000, messageCount: 1, changeCount: 200, read: "board_inbox atMs=1000",
  });
  assert.ok(run.output().split("\n")[0].length < 200);

  const first = await runClient(["sent", "--log", log, "--at-ms", "1000"]).done;
  assert.equal(first.code, 0);
  assert.equal(JSON.parse(first.out).changes.length, 200);
  assert.equal(JSON.parse(first.out).messages[0].text, JAPANESE_TEXT);
  const last = await runClient(["sent", "--log", log]).done;
  assert.equal(JSON.parse(last.out).atMs, 2000);
});

test("sent says NoSent with exit code 1 when the log has no MessagesSent", async () => {
  const log = tempLog();
  fs.writeFileSync(log, eventLine("ServerReady", { atMs: 1 }));
  const { code, out } = await runClient(["sent", "--log", log]).done;
  assert.equal(code, 1);
  assert.equal(JSON.parse(out).error, "NoSent");
});

test("watch without --log follows the log that the Server names, also when it appears later (FR-131, FR-146)", async () => {
  const log = tempLog();
  const http = require("http");
  const fake = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ v: 1, logPath: log }));
  });
  await new Promise((resolve) => fake.listen(0, "127.0.0.1", resolve));
  try {
    const run = runClient(["watch", "--port", String(fake.address().port)]);
    await delay(700);
    fs.writeFileSync(log, eventLine("MessageReceived", { text: "first" }));
    await delay(700);
    run.child.kill();
    await run.done;
    const lines = run.output().trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(lines.map((e) => e.text), ["first"]);
  } finally {
    fake.close();
  }
});
