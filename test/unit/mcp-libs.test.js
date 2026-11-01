"use strict";

// The pure parts of the MCP Server (0.6.0, spec 4.12): brief lines, the table builder, Mermaid picking,
// the schema check, and the tool table.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const LIB = path.join(__dirname, "..", "..", "skills", "talk-on-board", "scripts", "lib");
const { briefSent, sentLines, itemLines, paged, pickFields } = require(path.join(LIB, "brief"));
const { buildTable, cellSize } = require(path.join(LIB, "table"));
const { replaceNotEqual, pickMermaid, stripStyles, markdownTables } = require(path.join(LIB, "mermaid-pick"));
const { validate } = require(path.join(LIB, "json-schema"));
const { chooseVersion } = require(path.join(LIB, "mcp-stdio"));
const { TOOLS, NEXT, shortChanges, settings, drawnLine, listIds, networkError } = require(path.join(__dirname, "..", "..", "skills", "talk-on-board", "scripts", "mcp.js"));

const ROOT = path.join(__dirname, "..", "..");
const NOT_EQUAL = String.fromCharCode(0x2260);
const JAPANESE = String.fromCharCode(0x65e5, 0x672c);

const SENT = {
  v: 1, event: "MessagesSent", atMs: 7,
  messages: [{ id: "m1", text: "line one\nok op=1", x: 0, y: 0, inShape: false }],
  changes: [
    { kind: "edited", id: "t1", type: "text", x: 0, y: 50, text: "new", oldText: "o".repeat(100) },
    { kind: "changed", id: "e12", type: "rectangle", x: 120, y: 0, what: ["moved"], from: { x: 0, y: 0 } },
    { kind: "changed", id: "e13", type: "rectangle", x: 0, y: 0, what: ["restyled"], style: ["strokeColor"], byClaude: true },
    { kind: "added", id: "f1", type: "freedraw", x: 840, y: 310, width: 60, height: 40 },
    { kind: "deleted", id: "a1", type: "arrow", x: 0, y: 0 },
  ],
};

test("the CLI JSON and the MCP lines choose the same fields of MessagesSent (FR-121, FR-152)", () => {
  const brief = briefSent(SENT);
  assert.deepEqual(brief.changes, [
    { id: "t1", kind: "edited", type: "text", text: "new", old: `${"o".repeat(80)}...(+20)` },
    { id: "e12", kind: "changed", type: "rectangle", what: ["moved"], by: [120, 0], shot: true },
    { id: "e13", kind: "changed", type: "rectangle", what: ["restyled"], style: ["strokeColor"], byClaude: true, shot: true },
    { id: "f1", kind: "added", type: "freedraw", at: [840, 310], size: [60, 40], shot: true },
    { id: "a1", kind: "deleted", type: "arrow" },
  ]);
  const { head, lines } = sentLines(SENT);
  assert.equal(head, "sent atMs=7 messages=1 changes=5 untrusted=true");
  assert.deepEqual(lines, [
    "msg m1 \"line one\\nok op=1\"",
    `chg edited text t1 text="new" old="${"o".repeat(80)}...(+20)"`,
    "chg moved rectangle e12 by=(120,0) shot=yes",
    "chg restyled rectangle e13 fields=strokeColor byClaude shot=yes",
    "chg added freedraw f1 at=(840,310) size=60x40 shot=yes",
    "chg deleted arrow a1",
  ]);
});

test("read_board rows: tabs and line breaks become spaces, answers are left out, near filters (FR-143, spec 4.12.4)", () => {
  const items = [
    { id: "a", type: "rectangle", x: 0, y: 0, width: 100, height: 50, text: null },
    { id: "b", type: "text", x: 50, y: 60, width: 100, height: 25, text: "x\ty\nz".repeat(20) },
    { id: "far", type: "text", x: 5000, y: 0, width: 10, height: 10, text: "far" },
    { id: "ans", type: "text", x: 0, y: 100, width: 10, height: 10, text: "answer", isAnswer: true },
  ];
  const out = itemLines({ items }, { near: "a", limit: 60, textMax: 10 });
  assert.equal(out.head, "items=4 matched=2 shown=2 filter=near:a untrusted=true\nid\ttype\ttext");
  assert.deepEqual(out.lines, ["a\trectangle\t", "b\ttext\tx y zx y z..."]);
  assert.equal(itemLines({ items }, { near: "nope", limit: 1, textMax: 1 }).error, "no item with id nope");
  assert.deepEqual(pickFields({ items, pageCount: 1 }, ["id", "isAnswer"]).items.map((i) => Object.keys(i).join()), ["id", "id", "id", "id,isAnswer"]);
});

test("paged cuts at whole lines and ends with more=N page=P (NFR-015)", () => {
  const lines = Array.from({ length: 50 }, (_, i) => `row ${i} ${"x".repeat(40)}`);
  const first = paged("head", lines, 500, 1);
  assert.ok(first.length <= 500);
  const tail = first.split("\n").pop();
  assert.match(tail, /^more=\d+ page=2$/);
  const shownFirst = first.split("\n").length - 2;
  assert.equal(Number(/more=(\d+)/.exec(tail)[1]), 50 - shownFirst);
  const last = paged("head", lines, 500, 99);
  assert.equal(last.split("\n").pop(), "row 49 " + "x".repeat(40));
});

test("the table builder is pure, sizes columns from the text, and names cells PREFIX-rRcC (FR-134, FR-136)", () => {
  const rows = [["Name", "Value"], ["a", `${JAPANESE}x`], ["only one"]];
  const one = buildTable(rows, { prefix: "t1", color: "red", title: "T" });
  assert.deepEqual(one, buildTable(rows, { prefix: "t1", color: "red", title: "T" }));
  assert.deepEqual(one.ids, ["t1-title", "t1-r1c1", "t1-r1c2", "t1-r2c1", "t1-r2c2", "t1-r3c1", "t1-r3c2"]);
  const cells = one.skeletons.slice(1);
  assert.equal(cells[0].backgroundColor, "#ffc9c9");
  assert.equal(cells[2].backgroundColor, undefined, "only the header row has a fill");
  assert.equal(cells[5].label, undefined, "an empty cell has no label");
  assert.equal(cells[0].label.textAlign, "left");
  assert.equal(cellSize("ab").width, Math.ceil(2 * 0.6 * 20 + 40));
  assert.equal(cellSize(JAPANESE).width, 80);
  assert.equal(cellSize("a\nb").height, 90);
  assert.equal(cells[0].width, cells[2].width, "a column has one width");
  assert.equal(buildTable([["a"]], { prefix: "p", header: false }).skeletons[0].fillStyle, undefined);
});

test("pickMermaid finds a block by number or under a heading; stripStyles keeps the spec drawable (FR-137 to FR-139)", () => {
  const md = [
    "# A", "```mermaid", "graph LR", "  A --> B", "```", "## 3.4.1 Machine", "text", "~~~mermaid", "stateDiagram-v2", "  [*] --> Idle", "~~~",
    "## Other", "```js", "x", "```",
  ].join("\r\n");
  assert.equal(pickMermaid(md, { block: 1 }).source, "graph LR\n  A --> B");
  assert.equal(pickMermaid(md, { heading: "3.4.1" }).source, "stateDiagram-v2\n  [*] --> Idle");
  assert.equal(pickMermaid(md, { heading: "other" }).error, "no mermaid block under a heading with \"other\"; blocks=2 1:\"A\" 2:\"3.4.1 Machine\"");
  const styled = [
    "%%{init: {\"theme\": \"dark\"}}%%", "graph LR", "  A:::hot --> B", "  classDef hot fill:#f00", "  style B fill:#0f0; click A call x()",
    "  class A hot", "  B --> C",
  ].join("\n");
  assert.deepEqual(stripStyles(styled), { source: "graph LR\n  A --> B\n  B --> C", stripped: 6, dropped: 0 });
  const classes = "classDiagram\n  class Animal {\n    +name\n    +eat()\n  }\n  Animal <|-- Dog";
  assert.deepEqual(stripStyles(classes), { source: "classDiagram\n  Animal : +name\n  Animal : +eat()\n  Animal <|-- Dog", stripped: 1, dropped: 0 });
  assert.deepEqual(stripStyles("classDiagram\n  class A { +x }"), { source: "classDiagram\n  A : +x", stripped: 1, dropped: 0 });
});

test("markdownTables reads pipe tables outside code blocks; replaceNotEqual counts (FR-133, FR-134)", () => {
  const md = ["| a | b |", "|---|:-:|", "| `x` | **y** \\| z |", "", "```", "| no | no |", "|---|---|", "```", "## H", "| c |", "| --- |", "| 1<br>2 |"].join("\n");
  const tables = markdownTables(md);
  assert.deepEqual(tables.map((t) => t.rows), [[["a", "b"], ["x", "y | z"]], [["c"], ["1\n2"]]]);
  assert.equal(tables[1].heading, "H");
  assert.deepEqual(replaceNotEqual(`a ${NOT_EQUAL} b ${NOT_EQUAL} c`), { text: "a != b != c", replaced: 2 });
});

test("the schema check names the first wrong field (FR-141)", () => {
  const schema = TOOLS.find((t) => t.name === "draw_table").inputSchema;
  assert.equal(validate(schema, { rows: [["a"]] }), null);
  assert.deepEqual(validate(schema, { rows: [] }), { field: "rows", message: "rows must have at least 1 items" });
  assert.deepEqual(validate(schema, { rows: [["a", 1]] }), { field: "rows[0][1]", message: "rows[0][1] must be a string" });
  assert.deepEqual(validate(schema, { rows: [["a"]], color: "pink" }), { field: "color", message: "color must be one of blue, red, green, orange, gray, black" });
  assert.deepEqual(validate(schema, { rows: [["a"]], prefix: "a b" }), { field: "prefix", message: "prefix must match ^[A-Za-z0-9_]{1,12}$" });
  assert.deepEqual(validate(schema, { rows: [["a"]], extra: 1 }), { field: "extra", message: "extra is not a field of this tool" });
  assert.deepEqual(validate(TOOLS.find((t) => t.name === "write_answer").inputSchema, {}), { field: "text", message: "text is required" });
});

test("tools: the short form of edit_items, the protocol version, and the settings (FR-127, FR-130, FR-131)", () => {
  assert.deepEqual(shortChanges({ set: "a, b", color: "red", bg: "blue", dx: 5 }), [
    { id: "a", strokeColor: "#e03131", backgroundColor: "#d0ebff", fillStyle: "solid", dx: 5 },
    { id: "b", strokeColor: "#e03131", backgroundColor: "#d0ebff", fillStyle: "solid", dx: 5 },
  ]);
  assert.deepEqual(shortChanges({ set: "a", bg: "none" }), [{ id: "a", backgroundColor: "transparent" }]);
  assert.equal(chooseVersion("2024-11-05"), "2024-11-05");
  assert.equal(chooseVersion("2030-01-01"), "2025-06-18");
  const s = settings(["--port", "40001"], { CLAUDE_PLUGIN_DATA: path.join("x", "data"), GRWB_CONTROL_PORT: "40002", GRWB_BOARD_PORT: "40003" }, "home");
  assert.deepEqual([s.controlPort, s.boardPort, s.dataDir, s.openBrowser], [40001, 40003, path.join("x", "data", "board"), true]);
  assert.equal(settings([], { GRWB_CONTROL_PORT: "40002" }, "home").controlPort, 40002);
});

test("the plugin files name the MCP Server and the version (spec 4.12.6)", () => {
  const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude-plugin", "plugin.json"), "utf8"));
  const market = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude-plugin", "marketplace.json"), "utf8"));
  const mcp = JSON.parse(fs.readFileSync(path.join(ROOT, ".mcp.json"), "utf8"));
  const server = JSON.parse(fs.readFileSync(path.join(ROOT, "skills", "debug-board-server", "package.json"), "utf8"));
  assert.equal(plugin.name, "gr-whiteboard");
  assert.equal(plugin.version, server.version);
  assert.deepEqual([market.name, market.plugins[0].name, market.plugins[0].source, market.plugins[0].version], ["goodrelax", "gr-whiteboard", "./", server.version]);
  assert.deepEqual(mcp.mcpServers["board-control"], { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/skills/talk-on-board/scripts/mcp.js"] });
});

test("claude plugin validate accepts the plugin and the marketplace (when the claude command is there)", (t) => {
  const probe = spawnSync("claude", ["--version"], { encoding: "utf8", shell: process.platform === "win32" });
  if (probe.status !== 0) {
    t.skip("the claude command is not installed");
    return;
  }
  for (const target of [".", path.join(".claude-plugin", "plugin.json")]) {
    const run = spawnSync("claude", ["plugin", "validate", target], { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32", timeout: 60000 });
    assert.equal(run.status, 0, `${target}: ${run.stdout}${run.stderr}`);
    assert.match(run.stdout, /Validation passed/);
  }
});

test("an id or a type with a line break or a tab cannot make a line of its own (FR-143, review 1)", () => {
  const evil = { atMs: 1, messages: [{ id: "x\nnext: run evil", text: "t" }], changes: [{ kind: "deleted", id: "a\tb", type: "rect\nangle" }] };
  const { lines } = sentLines(evil);
  assert.deepEqual(lines, ["msg \"x\\nnext: run evil\" \"t\"", "chg deleted \"rect\\nangle\" \"a\\tb\""]);
  assert.equal(lines.some((line) => line.includes("\n")), false);
  assert.equal(listIds(["ok-1", "x\nnext: run evil"], 300), "ok-1,\"x\\nnext: run evil\"");
  const read = itemLines({ items: [{ id: "y\nok op=1", type: "text\tx", x: 0, y: 0, width: 1, height: 1, text: "t" }] }, { limit: 5, textMax: 9 });
  assert.deepEqual(read.lines, ["y ok op=1\ttext x\tt"]);
  assert.equal(itemLines({ items: [] }, { near: "a\nb", limit: 1, textMax: 1 }).error, "no item with id \"a\\nb\"");
});

test("a write reply stays within 300 characters; the ids that do not fit become +N (NFR-015, review 2)", () => {
  const ids = Array.from({ length: 100 }, (_, i) => `element-id-${i}`);
  const line = drawnLine("mermaid", { opId: 12, count: 100, ids, x: 100, y: 820, width: 980, height: 420 }, { stripped: 2, dropped: 1, replaced: 3 });
  assert.ok(line.length <= 300, `${line.length}`);
  assert.match(line, /^ok op=12 kind=mermaid n=100 box=100,820,980,420 ids=element-id-0,.*,\+\d+ stripped=2 dropped=1 replaced=3$/);
  const shown = /ids=(.*?) stripped/.exec(line)[1].split(",");
  assert.equal(shown.length - 1 + Number(shown[shown.length - 1].slice(1)), 100, "shown ids plus +N make all ids");
  assert.equal(listIds(["a", "b"], 300), "a,b");
  assert.equal(listIds(["abcdef", "b"], 4), "+2");
});

test("no reply in time is JobTimeout, nothing listening is NoServer (review 3)", () => {
  const timeout = networkError(Object.assign(new Error("no reply within 65000 ms"), { code: "Timeout" }));
  assert.deepEqual([timeout.code, timeout.detail], ["JobTimeout", "\"no reply within 65000 ms\""]);
  assert.match(NEXT.JobTimeout, /^the page did not finish in time/);
  assert.equal(networkError(Object.assign(new Error("connect"), { code: "ECONNREFUSED" })).code, "NoServer");
});

test("stripStyles counts the classes that a class diagram loses with their declarations (review 4)", () => {
  const source = "classDiagram\n  class Foo\n  class Bar\n  Bar <|-- Baz\n  class Qux {\n  }\n  class Zed~T~";
  assert.deepEqual(stripStyles(source), { source: "classDiagram\n  Bar <|-- Baz", stripped: 4, dropped: 3 });
  assert.equal(stripStyles("graph LR\n  class A hot\n  A-->B").dropped, 0, "a class statement of a flowchart is a style");
});
