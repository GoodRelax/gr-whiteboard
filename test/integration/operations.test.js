"use strict";

// Operations by Claude (0.5.0) on the real server.js: a fake page answers draw, edit, and mermaid Jobs
// with prepared Elements, so the Server side runs without a browser (spec 5).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { execFile, spawn, spawnSync } = require("child_process");

const SERVER = path.join(__dirname, "..", "..", "skills", "debug-board-server", "scripts", "server.js");
const CLIENT = path.join(__dirname, "..", "..", "skills", "talk-on-board", "scripts", "client.js");
// Below the dynamic port range, and apart from the ports of server.test.js (see there).
const PORT = 30000 + Math.floor(Math.random() * 9000);
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
        resolve({ status: res.statusCode, json });
      });
    });
    req.on("error", reject);
    req.end(data);
  });
}

// @purity non-pure
const control = (urlPath, body) => call(CONTROL_PORT, body === undefined ? "GET" : "POST", urlPath, { body });

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
    jobs: () => received.filter((m) => m.type === "job").map((m) => m.data),
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

// @purity non-pure
async function startServer(dataDir) {
  const logPath = path.join(dataDir, "server.log");
  fs.rmSync(logPath, { force: true });
  const child = spawn(process.execPath, [
    SERVER, "--data", dataDir, "--port", String(PORT), "--control-port", String(CONTROL_PORT),
    "--save-ms", "100", "--tick-ms", "50", "--job-timeout-ms", "3000",
  ], { stdio: "ignore" });
  const exited = new Promise((resolve) => child.on("exit", resolve));
  await untilReady(logPath);
  const token = fs.readFileSync(path.join(dataDir, "token.txt"), "utf8").trim();
  return { child, exited, logPath, token };
}

// @purity non-pure
async function stopServer(server) {
  await control("/v1/stop", {});
  await server.exited;
}

// @purity pure
function el(id, extra = {}) {
  return {
    id, type: "rectangle", version: 1, versionNonce: 11, isDeleted: false, x: 0, y: 0, width: 160, height: 80,
    updated: Date.now(), strokeColor: "#1971c2", backgroundColor: "transparent", ...extra,
  };
}

// What the page would make for SC-070 at the Origin (200, 300).
// @purity pure
function drawnFor(job) {
  const ox = job.x;
  const oy = job.y;
  return [
    el("web", { x: ox, y: oy, boundElements: [{ id: "web-l", type: "text" }, { id: "w2d", type: "arrow" }] }),
    el("web-l", { type: "text", text: "Web", containerId: "web", x: ox + 60, y: oy + 28, width: 40, height: 25 }),
    el("db", { x: ox + 300, y: oy, boundElements: [{ id: "w2d", type: "arrow" }] }),
    el("w2d", {
      type: "arrow", x: ox + 160, y: oy + 40, width: 140, height: 0, points: [[0, 0], [140, 0]],
      startBinding: { elementId: "web", focus: 0, gap: 1 }, endBinding: { elementId: "db", focus: 0, gap: 1 },
    }),
  ];
}

// Answers the next Job of `kind` on `page` with `make(job)` (a list of Elements or a reply object).
// @purity non-pure
async function answerJob(page, kind, make) {
  const seen = page.jobs().length;
  const job = await until(() => page.jobs().slice(seen).find((j) => j.kind === kind) || page.jobs().find((j) => j.kind === kind && !j.answered), 5000, `${kind} job`);
  job.answered = true;
  const made = make(job);
  const reply = Array.isArray(made) ? { ok: true, elements: made } : made;
  return page.post("/api/job", { jobId: job.jobId, ...reply });
}

// @purity non-pure
function runClient(args, input) {
  return spawnSync(process.execPath, [CLIENT, ...args, "--port", String(CONTROL_PORT)], { input, encoding: "utf8", timeout: 20000 });
}

const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("draw, edit, mermaid, delete, and undo on the real Server (FR-087 to FR-109)", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wbc-ops-"));
  let server = await startServer(dataDir);
  try {
    assert.equal(readLog(server.logPath).find((e) => e.event === "ServerReady").version, "0.7.16");
    const skeletons = [
      { id: "web", type: "rectangle", x: 0, y: 0, width: 160, height: 80, label: { text: "Web" } },
      { id: "db", type: "rectangle", x: 300, y: 0, width: 160, height: 80 },
      { id: "w2d", type: "arrow", x: 160, y: 40, start: { id: "web" }, end: { id: "db" } },
    ];

    // SC-073: no page.
    assert.deepEqual([(await control("/v1/draw", { elements: skeletons })).status, (await control("/v1/draw", { elements: skeletons })).json.error], [503, "NoPage"]);
    assert.equal((await control("/v1/mermaid", { source: "graph LR; A-->B" })).json.error, "NoPage");
    assert.equal((await control("/v1/status")).json.queueLength, 0);
    // SC-109: a scale outside (0, 1] is refused before any Job.
    for (const scale of [0, 2, "0.5"]) {
      const bad = await control("/v1/shot", { scale });
      assert.deepEqual([bad.status, bad.json.error], [400, "InvalidScale"]);
    }

    const page = openPage(server.token, "pageOPS0001");
    const other = openPage(server.token, "pageOPS0002");
    await until(() => page.find("hello") && other.find("hello"), 5000, "hello");

    // SC-071: bad Skeletons.
    const embed = await control("/v1/draw", { elements: [{ type: "embeddable", x: 0, y: 0 }] });
    assert.deepEqual([embed.status, embed.json.error, embed.json.index, embed.json.field], [400, "InvalidElements", 0, "type"]);
    assert.equal((await control("/v1/draw", { elements: [{ type: "rectangle", x: 0, y: 0, link: "https://x.example" }] })).json.field, "link");

    // SC-070: two boxes and an arrow.
    const drawing = control("/v1/draw", { elements: skeletons, at: { x: 200, y: 300 } });
    const posted = await answerJob(page, "draw", (job) => {
      assert.deepEqual([job.x, job.y, job.opId], [200, 300, 1]);
      return drawnFor(job);
    });
    assert.equal(posted.status, 200);
    const drawn = await drawing;
    assert.equal(drawn.status, 200);
    assert.deepEqual([drawn.json.opId, drawn.json.ids, drawn.json.count], [1, ["web", "db", "w2d"], 4]);
    assert.deepEqual([drawn.json.x, drawn.json.y, drawn.json.width, drawn.json.height], [200, 300, 460, 80]);
    const forOther = await until(() => other.received.find((m) => m.type === "elements"), 5000, "elements on the other page");
    assert.ok(forOther.data.elements.every((e) => e.customData.grwbKind === "claudeItem"), "FR-091 mark");
    assert.ok(fs.existsSync(path.join(dataDir, "snapshots", "1.json")), "FR-102 Snapshot");
    assert.equal((await control("/v1/draw", { elements: [skeletons[0]] })).json.error, "DuplicateId");

    // SC-074: Claude's drawing is not news. SC-092: board shows the arrow ends.
    await delay(200);
    const status = (await control("/v1/status")).json;
    assert.deepEqual([status.unsent, status.undoCount], [0, 1]);
    const items = (await control("/v1/board")).json.items;
    const w2d = items.find((i) => i.id === "w2d");
    assert.deepEqual([w2d.startId, w2d.endId], ["web", "db"]);
    assert.deepEqual([items.find((i) => i.id === "web").byClaude, items.find((i) => i.id === "web").strokeColor], [true, "#1971c2"]);
    assert.equal((await page.post("/api/send", {})).json.sent, 0);

    // SC-083: edit refused.
    assert.deepEqual([(await control("/v1/edit", { changes: [{ id: "nope", x: 1 }] })).json.error, (await control("/v1/edit", { changes: [{ id: "nope", x: 1 }] })).json.ids], ["UnknownItem", ["nope"]]);
    await other.post("/api/elements", { elements: [el("t1", { type: "text", text: "typing", x: 900, y: 900, customData: undefined })], editingId: "t1" });
    assert.equal((await control("/v1/edit", { changes: [{ id: "t1", text: "x" }] })).json.error, "ItemBusy");
    assert.equal((await control("/v1/edit", { changes: [{ id: "web", x: 1, dx: 1 }] })).json.index, 0);
    await other.post("/api/elements", { elements: [], editingId: null });

    // SC-082: move db; the Server takes only db, its arrow, and nothing else (FR-099).
    const editing = control("/v1/edit", { changes: [{ id: "db", dy: 200 }] });
    await answerJob(page, "edit", (job) => {
      assert.deepEqual(job.changes, [{ id: "db", dy: 200 }]);
      return [
        el("db", { version: 2, x: 500, y: 500, boundElements: [{ id: "w2d", type: "arrow" }], customData: { grwbKind: "answer" } }),
        el("w2d", { type: "arrow", version: 2, x: 360, y: 340, points: [[0, 0], [140, 200]], startBinding: { elementId: "web" }, endBinding: { elementId: "db" } }),
        el("t1", { type: "text", text: "hacked", version: 9 }),
      ];
    });
    const edited = await editing;
    assert.deepEqual([edited.status, edited.json.opId, edited.json.ids.sort()], [200, 2, ["db", "w2d"]]);
    const afterEdit = (await control("/v1/board")).json.items;
    assert.equal(afterEdit.find((i) => i.id === "t1").text, "typing", "edit ignores other Elements");
    assert.equal(afterEdit.find((i) => i.id === "db").byClaude, true, "the mark stays as it was");

    // SC-077 and SC-080: Mermaid errors.
    assert.equal((await control("/v1/mermaid", { source: "  " })).json.error, "InvalidSource");
    assert.equal((await control("/v1/mermaid", { source: "x".repeat(20001) })).json.error, "InvalidSource");
    // FR-093a: refused at once, no Job for the page.
    const styled = await control("/v1/mermaid", { source: "graph LR; A-->B; style A fill:#f00" });
    assert.deepEqual([styled.status, styled.json.error], [400, "InvalidSource"]);
    const broken = control("/v1/mermaid", { source: "graph LR; A -->" });
    await answerJob(page, "mermaid", () => ({ ok: false, code: "MermaidError", error: "Parse error on line 1" }));
    const brokenReply = await broken;
    assert.deepEqual([brokenReply.status, brokenReply.json.error, brokenReply.json.message], [422, "MermaidError", "Parse error on line 1"]);

    // SC-078: a picture becomes one image Element with a PNG file (FR-095).
    const pie = control("/v1/mermaid", { source: "pie title Pets\n \"Dogs\" : 3\n \"Cats\" : 2" });
    await answerJob(page, "mermaid", (job) => ({
      ok: true,
      elements: [el("pic1", { type: "image", fileId: "pngfile0001", x: job.x, y: job.y, width: 400, height: 300, status: "saved" })],
      files: [{ id: "pngfile0001", mimeType: "image/png", dataURL: TINY_PNG, created: 1 }],
    }));
    const pieReply = await pie;
    assert.deepEqual([pieReply.status, pieReply.json.image, pieReply.json.ids], [200, true, ["pic1"]]);
    assert.ok(fs.existsSync(path.join(dataDir, "files", "pngfile0001.json")), "the Server keeps the file as FR-083");
    await until(() => other.received.some((m) => m.type === "files"), 5000, "files on the other page");

    // An SVG picture is refused (FR-083, FR-095).
    const svg = control("/v1/mermaid", { source: "pie\n \"A\" : 1" });
    const refused = await answerJob(page, "mermaid", (job) => ({
      ok: true,
      elements: [el("pic2", { type: "image", fileId: "svgfile0001", x: job.x, y: job.y })],
      files: [{ id: "svgfile0001", mimeType: "image/svg+xml", dataURL: "data:image/svg+xml;base64,PHN2Zz4=", created: 1 }],
    }));
    assert.equal(refused.status, 409, "the page takes its drawing off again");
    assert.equal((await svg).json.error, "JobFailed");

    // Undo the pie chart, then the edit: db goes back up (FR-103).
    const undonePie = await control("/v1/undo", {});
    assert.deepEqual([undonePie.json.opId, undonePie.json.kind, undonePie.json.restored], [4, "mermaid", 1]);
    const undoneEdit = await control("/v1/undo", {});
    assert.deepEqual([undoneEdit.json.kind, undoneEdit.json.restored], ["edit", 2]);
    assert.equal((await control("/v1/board")).json.items.find((i) => i.id === "db").y, 300);

    // SC-075: a Person moves Claude's shape and presses Send.
    const webNow = (await control("/v1/board")).json.items.find((i) => i.id === "web");
    await other.post("/api/elements", { elements: [el("web", { version: 5, x: webNow.x + 100, y: webNow.y, customData: { grwbKind: "claudeItem" } })], editingId: null });
    await other.post("/api/send", {});
    const sent = await until(() => readLog(server.logPath).find((e) => e.event === "MessagesSent"), 5000, "MessagesSent");
    assert.deepEqual(sent.changes.map((c) => [c.kind, c.id, c.what, c.byClaude]), [["changed", "web", ["moved"], true]]);

    // SC-088: undo of the drawing stops, because the Person moved "web".
    const conflict = await control("/v1/undo", {});
    assert.deepEqual([conflict.status, conflict.json.error, conflict.json.ids], [409, "UndoConflict", ["web"]]);
    page.close();
    other.close();
    await delay(200);

    // SC-084: delete with no page; bindings are cleaned.
    const removed = await control("/v1/delete", { ids: ["web", "w2d"] });
    assert.deepEqual([removed.status, removed.json.count, removed.json.ids.sort()], [200, 2, ["w2d", "web", "web-l"]]);
    const dbAfter = JSON.parse(fs.readFileSync(path.join(dataDir, "snapshots", `${removed.json.opId}.json`), "utf8"));
    assert.equal(dbAfter.elements.find((e) => e.id === "web").isDeleted, false, "the Snapshot is the Board before the delete");
    assert.equal((await control("/v1/status")).json.unsent, 0, "FR-092");
    assert.deepEqual((await control("/v1/board")).json.items.map((i) => i.id).sort(), ["db", "t1"]);

    // SC-085: more than 20 Items need confirm.
    const many = openPage(server.token, "pageOPS0003");
    await until(() => many.find("hello"), 5000, "hello");
    await many.post("/api/elements", { elements: Array.from({ length: 23 }, (_, i) => el(`p${i}`, { x: i * 10, customData: undefined })), editingId: null });
    many.close();
    const ask = await control("/v1/delete", { all: true });
    assert.deepEqual([ask.status, ask.json.error, ask.json.count], [409, "ConfirmNeeded", 25]);
    assert.equal((await control("/v1/board")).json.items.length, 25, "the Board does not change");
    const erased = await control("/v1/delete", { all: true, confirm: true });
    assert.equal(erased.json.count, 25);
    assert.equal((await control("/v1/board")).json.items.length, 0);

    // SC-087: undo the erase.
    const back = await control("/v1/undo", {});
    assert.deepEqual([back.json.kind, back.json.restored], ["delete", 25]);
    assert.equal((await control("/v1/board")).json.items.length, 25);
    assert.equal((await control("/v1/status")).json.unsent, 0, "undo does not change the Send count (FR-092, SC-087)");
    const undoOpId = (await control("/v1/status")).json.undoCount;
    assert.equal(undoOpId, 2, "draw and the first delete are left");

    // SC-090: undo after a restart; the next Operation gets a new opId, never an undone one (R-023).
    await stopServer(server);
    server = await startServer(dataDir);
    assert.equal((await control("/v1/status")).json.undoCount, 2);
    const afterRestart = await control("/v1/undo", {});
    assert.deepEqual([afterRestart.json.kind, afterRestart.json.opId], ["delete", 6]);
    const next = await control("/v1/delete", { ids: ["p0"] });
    assert.equal(next.json.opId, 8, "opId 7 (the undone erase) is not given again (R-023)");

    // SC-093: the client reads a file; broken JSON makes no request.
    const okFile = path.join(dataDir, "draw.json");
    fs.writeFileSync(okFile, String.fromCharCode(0xfeff) + JSON.stringify([{ type: "rectangle", x: 0, y: 0 }]));
    const noPage = runClient(["draw", "--file", okFile, "--at", "200,300"]);
    assert.equal(noPage.status, 1);
    assert.equal(JSON.parse(noPage.stdout).error, "NoPage", "the client posted the file (and the Server has no page)");
    const brokenFile = path.join(dataDir, "broken.json");
    fs.writeFileSync(brokenFile, "[{");
    const bad = runClient(["draw", "--file", brokenFile]);
    assert.deepEqual([bad.status, JSON.parse(bad.stdout).error], [1, "InvalidJson"]);
    const clientDelete = runClient(["delete", "--all"]);
    assert.deepEqual([clientDelete.status, JSON.parse(clientDelete.stdout).error], [1, "ConfirmNeeded"]);
    const clientUndo = runClient(["undo"]);
    assert.deepEqual([clientUndo.status, JSON.parse(clientUndo.stdout).kind], [0, "delete"]);
    const forced = runClient(["undo", "--force"]);
    assert.equal(forced.status, 0, JSON.stringify(forced.stdout));
    assert.equal(JSON.parse(forced.stdout).kind, "draw");
    assert.equal(runClient(["undo"]).status, 1, "NothingToUndo");
    assert.ok(readLog(server.logPath).some((e) => e.event === "OperationUndone" && e.forced === true));
    await stopServer(server);
  } finally {
    server.child.kill();
  }
});

test("DrawingAdded counts a Person's drawings, never Claude Items (FR-091, SC-074)", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wbc-ops-auto-"));
  const server = await startServer(dataDir);
  try {
    const page = openPage(server.token, "pageAUTO0001");
    await until(() => page.find("hello"), 5000, "hello");
    assert.equal((await page.post("/api/auto-send", { on: true })).status, 200);
    const added = () => readLog(server.logPath).filter((e) => e.event === "DrawingAdded");
    await page.post("/api/elements", { elements: [el("pen1", { customData: undefined })], editingId: null });
    await until(() => added().length === 1, 5000, "DrawingAdded for the Person's shape");

    const drawing = control("/v1/draw", { elements: [{ id: "box", type: "rectangle", x: 0, y: 0 }] });
    await answerJob(page, "draw", (job) => [el("box", { x: job.x, y: job.y, customData: { grwbKind: "claudeItem" } })]);
    assert.equal((await drawing).status, 200);
    await delay(300);
    assert.equal(added().length, 1, "Claude's box adds no DrawingAdded");

    await page.post("/api/elements", { elements: [el("pen2", { x: 500, customData: undefined })], editingId: null });
    await until(() => added().length === 2, 5000, "DrawingAdded for the second Person shape");
    assert.equal(added()[1].drawingCount, 2, "the count has the two Person shapes only");
    page.close();
    await stopServer(server);
  } finally {
    server.child.kill();
  }
});

test("client.js posts the request bodies of draw, mermaid, edit, delete, and undo (FR-109, SC-093, SC-104)", async () => {
  const bodies = [];
  const fake = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      bodies.push({ method: req.method, url: req.url, body: JSON.parse(raw) });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ v: 1, opId: 1, ids: ["r1"], count: 1 }));
    });
  });
  await new Promise((resolve) => fake.listen(0, "127.0.0.1", resolve));
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wbc-ops-client-"));
    const file = path.join(dir, "draw.json");
    const skeletons = [{ id: "r1", type: "rectangle", x: 0, y: 0 }];
    fs.writeFileSync(file, String.fromCharCode(0xfeff) + JSON.stringify(skeletons));
    const run = (args, input) => new Promise((resolve) => {
      const child = execFile(process.execPath, [CLIENT, ...args, "--port", String(fake.address().port)],
        { encoding: "utf8", timeout: 20000 }, (error, stdout) => resolve({ code: error ? error.code : 0, stdout }));
      child.stdin.end(input || "");
    });
    const mmd = path.join(dir, "diagram.mmd");
    fs.writeFileSync(mmd, "graph LR\n  A --> B\n");
    const edits = path.join(dir, "edit.json");
    fs.writeFileSync(edits, JSON.stringify([{ id: "r1", dx: 10 }]));
    for (const args of [
      ["draw", "--file", file, "--at", "200,300"],
      ["mermaid", "--file", mmd],
      ["edit", "--file", edits],
      ["delete", "r1", "r2"],
      ["delete", "--all", "--confirm"],
      ["undo", "--force"],
    ]) {
      const out = await run(args);
      assert.equal(out.code, 0, `${args[0]}: ${out.stdout}`);
    }
    assert.equal((await run(["mermaid"], "pie\n  \"A\" : 1\n")).code, 0, "mermaid reads standard input");
    assert.deepEqual(bodies.map((b) => [b.method, b.url, b.body]), [
      ["POST", "/v1/draw", { elements: skeletons, at: { x: 200, y: 300 } }],
      ["POST", "/v1/mermaid", { source: "graph LR\n  A --> B" }],
      ["POST", "/v1/edit", { changes: [{ id: "r1", dx: 10 }] }],
      ["POST", "/v1/delete", { ids: ["r1", "r2"] }],
      ["POST", "/v1/delete", { all: true, confirm: true }],
      ["POST", "/v1/undo", { force: true }],
      ["POST", "/v1/mermaid", { source: "pie\n  \"A\" : 1" }],
    ]);
  } finally {
    fake.close();
  }
});

test("the id of a deleted Item can be drawn again, above the tombstone's version (FR-088, FR-090, R-184)", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wbc-ops-reuse-"));
  const server = await startServer(dataDir);
  try {
    const page = openPage(server.token, "pageOPS0004");
    const other = openPage(server.token, "pageOPS0005");
    await until(() => page.find("hello") && other.find("hello"), 5000, "hello");
    const box = [{ id: "w5-r2", type: "rectangle", x: 0, y: 0, width: 160, height: 80 }];
    const drawBox = async (version) => {
      const drawing = control("/v1/draw", { elements: box });
      let sent = null;
      await answerJob(page, "draw", (job) => {
        sent = job;
        return [el("w5-r2", { x: job.x, y: job.y, version })];
      });
      return { reply: await drawing, job: sent };
    };
    assert.equal((await drawBox(1)).reply.status, 200);
    assert.equal((await control("/v1/draw", { elements: box })).json.error, "DuplicateId", "a live id stays taken");
    const removed = await control("/v1/delete", { ids: ["w5-r2"] });
    assert.equal(removed.json.count, 1);

    // The page must draw above the tombstone; the job tells it the tombstone's version.
    const low = await drawBox(1);
    assert.deepEqual([low.reply.status, low.reply.json.error], [502, "JobFailed"]);
    assert.equal(low.job.reused["w5-r2"], 2, "the job carries the version of the tombstone");
    const again = await drawBox(3);
    assert.deepEqual([again.reply.status, again.reply.json.ids], [200, ["w5-r2"]]);
    assert.deepEqual((await control("/v1/board")).json.items.map((i) => i.id), ["w5-r2"]);
    const forOther = await until(() => other.received.filter((m) => m.type === "elements").map((m) => m.data.elements.find((e) => e.id === "w5-r2")).filter(Boolean).find((e) => e.version === 3), 5000, "the new box on the other page");
    assert.equal(forOther.isDeleted, false);

    // Undo goes last first: undo of the new drawing deletes it again, then undo of the delete brings back the first box.
    const undoDraw = await control("/v1/undo", {});
    assert.deepEqual([undoDraw.status, undoDraw.json.kind], [200, "draw"]);
    assert.deepEqual((await control("/v1/board")).json.items, []);
    const undoDelete = await control("/v1/undo", {});
    assert.deepEqual([undoDelete.status, undoDelete.json.kind], [200, "delete"]);
    assert.deepEqual((await control("/v1/board")).json.items.map((i) => i.id), ["w5-r2"]);
    page.close();
    other.close();
    await stopServer(server);
  } finally {
    server.child.kill();
  }
});

test("a Snapshot that cannot be written stops the Operation (FR-106, SC-086)", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wbc-ops-fail-"));
  // A file where the snapshots folder should be: the Server cannot write there.
  fs.writeFileSync(path.join(dataDir, "snapshots"), "not a folder");
  fs.writeFileSync(path.join(dataDir, "board.json"), JSON.stringify({ v: 1, elements: [el("db")] }));
  const server = await startServer(dataDir);
  try {
    const reply = await control("/v1/delete", { ids: ["db"] });
    assert.deepEqual([reply.status, reply.json.error], [500, "SnapshotFailed"]);
    assert.equal((await control("/v1/board")).json.items.length, 1, "db is still on the Board");
    assert.ok(readLog(server.logPath).some((e) => e.event === "OperationFailed" && e.error === "SnapshotFailed"));
    await stopServer(server);
  } finally {
    server.child.kill();
  }
});

test("client.js sent --brief, board --fields, and shot --scale keep the replies small (FR-121, FR-122, FR-123, FR-152)", async () => {
  const bodies = [];
  const board = {
    items: [
      { id: "r1", type: "rectangle", x: 1, y: 2, width: 3, height: 4, text: null, strokeColor: "#1971c2" },
      { id: "l1", type: "line", x: 5, y: 6, width: 0, height: 730, points: [[0, 0], [0, 730]], startId: null, endId: null },
    ],
    pageCount: 1,
  };
  const fake = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      bodies.push({ method: req.method, url: req.url, body: raw === "" ? null : JSON.parse(raw) });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(req.url === "/v1/board" ? board : { path: "shot.png" }));
    });
  });
  await new Promise((resolve) => fake.listen(0, "127.0.0.1", resolve));
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wbc-ops-brief-"));
    const log = path.join(dir, "server.log");
    const sent = {
      v: 1, event: "MessagesSent", atMs: 7,
      messages: [{ id: "m1", text: "draw it", x: 0, y: 0, inShape: false }],
      changes: [
        { kind: "edited", id: "t1", type: "text", x: 0, y: 50, text: "new words", oldText: "old words" },
        { kind: "changed", id: "a1", type: "arrow", x: 9, y: 9, what: ["moved"], from: { x: 0, y: 0 }, byClaude: true },
      ],
    };
    fs.writeFileSync(log, `${JSON.stringify(sent)}\n`);
    const run = (args) => new Promise((resolve) => {
      execFile(process.execPath, [CLIENT, ...args, "--port", String(fake.address().port), "--log", log],
        { encoding: "utf8", timeout: 20000 }, (error, stdout) => resolve({ code: error ? error.code : 0, json: JSON.parse(stdout) }));
    });
    assert.deepEqual((await run(["sent", "--brief"])).json, {
      v: 1, event: "MessagesSent", atMs: 7,
      messages: [{ id: "m1", text: "draw it" }],
      changes: [
        { id: "t1", kind: "edited", type: "text", text: "new words", old: "old words" },
        { id: "a1", kind: "changed", type: "arrow", what: ["moved"], by: [9, 9], byClaude: true, shot: true },
      ],
    });
    assert.deepEqual((await run(["sent"])).json, sent, "without --brief, sent prints the whole event");
    assert.deepEqual((await run(["board", "--fields", "id,type,points"])).json, {
      items: [{ id: "r1", type: "rectangle" }, { id: "l1", type: "line", points: [[0, 0], [0, 730]] }], pageCount: 1,
    });
    assert.equal((await run(["shot", "r1", "--scale", "0.5"])).code, 0);
    assert.equal((await run(["shot"])).code, 0);
    assert.deepEqual(bodies.filter((b) => b.url === "/v1/shot").map((b) => b.body), [{ focusId: "r1", scale: 0.5 }, {}]);
  } finally {
    fake.close();
  }
});
