"use strict";

// BoardOps: the rules of spec 4.11 (draw, edit, delete, undo, Origin, result filters).

const test = require("node:test");
const assert = require("node:assert/strict");
const ops = require("../../skills/whiteboard-server/scripts/lib/board-ops");
const { toItems } = require("../../skills/whiteboard-server/scripts/lib/board-store");
const { placeAnswer } = require("../../skills/whiteboard-server/scripts/lib/answer-placement");

// @purity pure
function el(id, extra = {}) {
  return { id, type: "rectangle", version: 1, versionNonce: 5, isDeleted: false, x: 0, y: 0, width: 100, height: 50, updated: 1, ...extra };
}

// @purity pure
function board(list) {
  return new Map(list.map((e) => [e.id, e]));
}

// @purity pure
function errorOf(fn) {
  try {
    fn();
  } catch (error) {
    return { code: error.code, status: error.status, ...(error.details || {}) };
  }
  return null;
}

const MAX = 2000;

test("checkDraw takes the example of 4.11.1 and lists Board targets (FR-087, FR-090)", () => {
  const list = [
    { id: "pc", type: "rectangle", x: 0, y: 0, width: 140, height: 70, label: { text: "PC" } },
    { id: "router", type: "diamond", x: 240, y: -10, width: 120, height: 90, label: { text: "Router" } },
    { id: "a1", type: "arrow", x: 140, y: 35, points: [[0, 0], [100, 0]], start: { id: "pc" }, end: { id: "router" } },
    { id: "a2", type: "arrow", x: 360, y: 35, start: { id: "router" }, end: { id: "p1" }, label: { text: "LAN" } },
    { type: "text", x: 0, y: 200, text: "note", fontSize: 24, fontFamily: 5, textAlign: "left" },
  ];
  const checked = ops.checkDraw({ elements: list, at: { x: 200, y: 300 } }, board([el("p1")]), MAX);
  assert.equal(checked.skeletons, list);
  assert.deepEqual(checked.at, { x: 200, y: 300 });
  assert.deepEqual(checked.boardTargets, ["p1"]);
});

test("checkDraw refuses bad lists, types, fields, and values (FR-088, NFR-014)", () => {
  const empty = new Map();
  const box = { type: "rectangle", x: 0, y: 0 };
  assert.deepEqual(errorOf(() => ops.checkDraw({ elements: [] }, empty, MAX)), { code: "InvalidElements", status: 400, index: null, field: "elements" });
  assert.equal(errorOf(() => ops.checkDraw({ elements: new Array(501).fill(box) }, empty, MAX)).field, "elements");
  assert.deepEqual(errorOf(() => ops.checkDraw({ elements: [{ type: "embeddable", x: 0, y: 0 }] }, empty, MAX)),
    { code: "InvalidElements", status: 400, index: 0, field: "type" });
  for (const type of ["image", "freedraw", "frame", "magicframe", "iframe", "star"]) {
    assert.equal(errorOf(() => ops.checkDraw({ elements: [{ type, x: 0, y: 0 }] }, empty, MAX)).field, "type", type);
  }
  for (const field of ["link", "customData", "version", "versionNonce", "isDeleted", "boundElements", "containerId", "groupIds", "frameId", "foo"]) {
    assert.deepEqual(errorOf(() => ops.checkDraw({ elements: [box, { ...box, [field]: 1 }] }, empty, MAX)),
      { code: "InvalidElements", status: 400, index: 1, field }, field);
  }
  const bad = [
    [{ ...box, x: 100001 }, "x"],
    [{ type: "rectangle", y: 0 }, "x"],
    [{ ...box, width: -1 }, "width"],
    [{ ...box, angle: 7 }, "angle"],
    [{ ...box, strokeColor: "red" }, "strokeColor"],
    [{ ...box, backgroundColor: "#12345" }, "backgroundColor"],
    [{ ...box, fillStyle: "dots" }, "fillStyle"],
    [{ ...box, strokeWidth: 20 }, "strokeWidth"],
    [{ ...box, strokeStyle: "wavy" }, "strokeStyle"],
    [{ ...box, roughness: 3 }, "roughness"],
    [{ ...box, opacity: 50.5 }, "opacity"],
    [{ ...box, label: { text: " " } }, "label"],
    [{ ...box, label: { text: "a", link: "x" } }, "label"],
    [{ ...box, text: "a" }, "text"],
    [{ ...box, id: "bad id" }, "id"],
    [{ type: "text", x: 0, y: 0 }, "text"],
    [{ type: "text", x: 0, y: 0, text: "x".repeat(MAX + 1) }, "text"],
    [{ type: "text", x: 0, y: 0, text: "a", fontSize: 7 }, "fontSize"],
    [{ type: "text", x: 0, y: 0, text: "a", fontFamily: 4 }, "fontFamily"],
    [{ type: "text", x: 0, y: 0, text: "a", verticalAlign: "up" }, "verticalAlign"],
    [{ type: "text", x: 0, y: 0, text: "a", strokeWidth: 2 }, "strokeWidth"],
    [{ type: "text", x: 0, y: 0, text: "a", width: 2 }, "width"],
    [{ type: "line", x: 0, y: 0, points: [[0, 0]] }, "points"],
    [{ type: "line", x: 0, y: 0, start: { id: "a" } }, "start"],
    [{ type: "arrow", x: 0, y: 0, endArrowhead: "star" }, "endArrowhead"],
    [{ type: "arrow", x: 0, y: 0, angle: 1 }, "angle"],
  ];
  for (const [skeleton, field] of bad) {
    assert.equal(errorOf(() => ops.checkDraw({ elements: [skeleton] }, empty, MAX)).field, field, JSON.stringify(skeleton));
  }
  assert.equal(errorOf(() => ops.checkDraw({ elements: [box], at: { x: 1 } }, empty, MAX)).code, "InvalidAt");
});

test("checkDraw: ids are unique, not on the Board, and arrows bind to shapes only (FR-088, FR-090)", () => {
  const box = { id: "web", type: "rectangle", x: 0, y: 0 };
  assert.equal(errorOf(() => ops.checkDraw({ elements: [box, box] }, new Map(), MAX)).field, "id");
  assert.deepEqual(errorOf(() => ops.checkDraw({ elements: [box] }, board([el("web")]), MAX)), { code: "DuplicateId", status: 409, ids: ["web"] });
  // A deleted Element keeps its id on the Board.
  assert.equal(errorOf(() => ops.checkDraw({ elements: [box] }, board([el("web", { isDeleted: true })]), MAX)).code, "DuplicateId");
  const arrow = (end) => ({ type: "arrow", x: 0, y: 0, end: { id: end } });
  const onBoard = board([el("line1", { type: "line" }), el("gone", { isDeleted: true }), el("pic", { type: "image" }), el("t", { type: "text" })]);
  assert.equal(errorOf(() => ops.checkDraw({ elements: [arrow("nope")] }, onBoard, MAX)).field, "end");
  assert.equal(errorOf(() => ops.checkDraw({ elements: [arrow("line1")] }, onBoard, MAX)).field, "end");
  assert.equal(errorOf(() => ops.checkDraw({ elements: [arrow("gone")] }, onBoard, MAX)).field, "end");
  assert.equal(errorOf(() => ops.checkDraw({ elements: [{ id: "l", type: "line", x: 0, y: 0 }, arrow("l")] }, onBoard, MAX)).field, "end");
  assert.deepEqual(ops.checkDraw({ elements: [arrow("pic"), arrow("t")] }, onBoard, MAX).boardTargets, ["pic", "t"]);
});

test("checkMermaid takes 1 to 20000 characters that are not blank (FR-093)", () => {
  assert.deepEqual(ops.checkMermaid({ source: "graph LR; A-->B" }), { source: "graph LR; A-->B", at: null });
  for (const source of [undefined, "", "   ", "x".repeat(20001), 5]) {
    assert.equal(errorOf(() => ops.checkMermaid({ source })).code, "InvalidSource");
  }
  const long = `graph LR\n%%${"x".repeat(19989)}`;
  assert.equal(ops.checkMermaid({ source: long }).source.length, long.length);
});

test("checkMermaid lets through the 6 diagram types (FR-093a)", () => {
  const sources = [
    "graph LR; A[Client] --> B[Server]",
    "flowchart TD\n  A --> B",
    "sequenceDiagram\n  Alice->>Bob: Hello",
    "classDiagram\n  Animal <|-- Dog\n  Animal : +name",
    "stateDiagram\n  [*] --> Idle",
    "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Busy",
    "erDiagram\n  CUSTOMER ||--o{ ORDER : places",
    "pie title Pets\n  \"Dogs\" : 3",
    "%% a comment first\n\ngraph LR\n  A --> B",
  ];
  for (const source of sources) assert.equal(ops.checkMermaid({ source }).source, source);
});

test("checkMermaid refuses each style, link, and config word (FR-093a)", () => {
  const sources = {
    "%%{": "%%{init: {\"theme\": \"dark\"}}%%\ngraph LR\n  A --> B",
    "%%{ later": "graph LR\n  A --> B\n  %%{init: {}}%%",
    classDef: "stateDiagram-v2\n  classDef bad fill:#f00\n  [*] --> A",
    class: "graph LR\n  A --> B\n  class A bad",
    style: "graph LR; A --> B; style A fill:#f00",
    linkStyle: "graph LR\n  A --> B\n  linkStyle 0 stroke:#f00",
    click: "graph LR\n  A --> B\n  click A \"https://example.com\"",
    "upper case": "graph LR\n  A --> B\n  STYLE A fill:#f00",
    ":::": "graph LR\n  A:::foo --> B",
    "class :::": "classDiagram\n  class Animal:::foo",
    cssClass: "classDiagram\n  Animal <|-- Dog\n  cssClass \"Animal\" foo",
    "style after }": "stateDiagram-v2\n  state X {\n    [*] --> A } style A fill:red",
    "classDef after {": "stateDiagram-v2\n  state X { classDef bad fill:#f00\n  }",
  };
  for (const [name, source] of Object.entries(sources)) {
    assert.equal(errorOf(() => ops.checkMermaid({ source })).code, "InvalidSource", name);
  }
});

test("checkMermaid refuses diagram types outside the 6 (FR-093a)", () => {
  const sources = [
    "gantt\n  title Plan", "journey\n  title Day", "mindmap\n  root", "---\ntitle: x\n---\ngraph LR; A-->B",
    "A --> B", "%% only a comment",
  ];
  for (const source of sources) {
    assert.equal(errorOf(() => ops.checkMermaid({ source })).code, "InvalidSource", source);
  }
});

test("checkEdit checks fields, unknown Items, types, and typing (FR-097)", () => {
  const onBoard = board([
    el("web"), el("lbl", { type: "text", containerId: "web", text: "Web" }), el("t1", { type: "text", text: "hi" }),
    el("plain"), el("arr", { type: "arrow" }),
  ]);
  const none = new Set();
  const check = (changes, busy = none) => ops.checkEdit({ changes }, onBoard, busy, MAX);
  assert.equal(check([{ id: "web", backgroundColor: "#ffc9c9", text: "Web server" }]).length, 1);
  assert.equal(check([{ id: "t1", text: "new", fontSize: 30 }]).length, 1);
  assert.deepEqual(errorOf(() => check([{ id: "web", x: 1, dx: 1 }])), { code: "InvalidChanges", status: 400, index: 0, field: "dx" });
  assert.equal(errorOf(() => check([])).field, "changes");
  assert.equal(errorOf(() => check(new Array(201).fill({ id: "web", x: 1 }))).field, "changes");
  assert.equal(errorOf(() => check([{ id: "web" }])).code, "InvalidChanges");
  assert.equal(errorOf(() => check([{ id: "web", x: 1 }, { id: "web", y: 1 }])).field, "id");
  for (const field of ["type", "link", "customData", "points", "startBinding", "boundElements"]) {
    assert.equal(errorOf(() => check([{ id: "web", [field]: 1 }])).field, field);
  }
  assert.equal(errorOf(() => check([{ id: "web", width: 0 }])).field, "width");
  assert.deepEqual(errorOf(() => check([{ id: "nope", x: 1 }, { id: "gone", x: 1 }])), { code: "UnknownItem", status: 409, ids: ["nope", "gone"] });
  assert.equal(errorOf(() => check([{ id: "t1", width: 10 }])).field, "width");
  assert.equal(errorOf(() => check([{ id: "plain", text: "x" }])).field, "text");
  assert.equal(errorOf(() => check([{ id: "t1", strokeWidth: 2 }])).field, "strokeWidth");
  assert.equal(errorOf(() => check([{ id: "arr", fillStyle: "solid" }])).field, "fillStyle");
  assert.deepEqual(errorOf(() => check([{ id: "t1", text: "x" }], new Set(["t1"]))), { code: "ItemBusy", status: 409, ids: ["t1"] });
  // Typing in the label makes the shape busy too.
  assert.equal(errorOf(() => check([{ id: "web", x: 5 }], new Set(["lbl"]))).code, "ItemBusy");
});

test("checkDeleteBody needs ids or all, not both (4.8 InvalidIds)", () => {
  assert.deepEqual(ops.checkDeleteBody({ ids: ["a", "a", "b"] }), { ids: ["a", "b"], all: false, confirm: false });
  assert.deepEqual(ops.checkDeleteBody({ all: true, confirm: true }), { ids: null, all: true, confirm: true });
  for (const body of [{}, { ids: [] }, { ids: ["a"], all: true }, { ids: "a" }, { ids: [""] }, { ids: new Array(2001).fill("a") }]) {
    assert.equal(errorOf(() => ops.checkDeleteBody(body)).code, "InvalidIds", JSON.stringify(body).slice(0, 40));
  }
});

test("planDelete deletes Items with their labels and cleans the bindings (FR-100, SC-084)", () => {
  const onBoard = board([
    el("web", { boundElements: [{ id: "lbl", type: "text" }, { id: "w2d", type: "arrow" }] }),
    el("lbl", { type: "text", containerId: "web", text: "Web" }),
    el("db", { boundElements: [{ id: "w2d", type: "arrow" }] }),
    el("w2d", { type: "arrow", startBinding: { elementId: "web" }, endBinding: { elementId: "db" } }),
  ]);
  let n = 100;
  const plan = ops.planDelete(onBoard, { ids: ["web", "w2d"], all: false, confirm: false }, new Set(), 777, () => (n += 1));
  assert.deepEqual(plan.ids.sort(), ["lbl", "w2d", "web"]);
  assert.equal(plan.count, 2);
  const byId = new Map(plan.changed.map((e) => [e.id, e]));
  for (const id of ["web", "lbl", "w2d"]) {
    assert.equal(byId.get(id).isDeleted, true);
    assert.equal(byId.get(id).version, 2);
    assert.equal(byId.get(id).updated, 777);
  }
  assert.deepEqual(byId.get("db").boundElements, []);
  assert.equal(byId.get("db").version, 2);
  assert.notEqual(byId.get("db").versionNonce, 5);
});

test("planDelete: unknown, busy, ConfirmNeeded above 20, and all (FR-100, FR-101, SC-085)", () => {
  const many = board(Array.from({ length: 30 }, (_, i) => el(`e${i}`)));
  const none = new Set();
  const nonce = () => 9;
  assert.deepEqual(errorOf(() => ops.planDelete(many, { ids: ["e1", "x"] }, none, 1, nonce)), { code: "UnknownItem", status: 409, ids: ["x"] });
  assert.deepEqual(errorOf(() => ops.planDelete(many, { ids: ["e1"] }, new Set(["e1"]), 1, nonce)), { code: "ItemBusy", status: 409, ids: ["e1"] });
  assert.deepEqual(errorOf(() => ops.planDelete(many, { all: true }, none, 1, nonce)), { code: "ConfirmNeeded", status: 409, count: 30 });
  const twenty = Array.from({ length: 20 }, (_, i) => `e${i}`);
  assert.equal(ops.planDelete(many, { ids: twenty }, none, 1, nonce).count, 20, "20 Items need no confirm");
  assert.equal(errorOf(() => ops.planDelete(many, { ids: [...twenty, "e20"] }, none, 1, nonce)).count, 21);
  const all = ops.planDelete(many, { all: true, confirm: true }, new Set(["e3"]), 1, nonce);
  assert.equal(all.count, 29, "all leaves out the Item that a Person is typing in");
  assert.ok(!all.ids.includes("e3"));
});

test("planUndo restores the Snapshot states with a higher version; added Elements become deleted (FR-103)", () => {
  const now = board([el("web", { version: 4, isDeleted: true }), el("new1", { version: 1 })]);
  const snapshot = board([el("web", { version: 3, x: 10 })]);
  const changed = [{ id: "web", version: 4 }, { id: "new1", version: 1 }];
  assert.deepEqual(ops.undoConflicts(changed, now), []);
  const { restored, restoredCount } = ops.planUndo(changed, snapshot, now, 50, () => 1);
  const byId = new Map(restored.map((e) => [e.id, e]));
  assert.deepEqual([byId.get("web").isDeleted, byId.get("web").version, byId.get("web").x, byId.get("web").updated], [false, 5, 10, 1]);
  assert.deepEqual([byId.get("new1").isDeleted, byId.get("new1").version, byId.get("new1").updated], [true, 2, 50]);
  assert.equal(restoredCount, 2);
  assert.deepEqual(ops.undoConflicts(changed, board([el("web", { version: 6 }), el("new1")])), ["web"]);
});

test("after undo of a deletion, the Answer goes below the newest Message, not an old one (FR-103, 4.6, UAT-10)", () => {
  const before = board([
    el("old", { type: "text", text: "first", x: 100, y: 100, height: 25, updated: 5 }),
    el("last", { type: "text", text: "undo that", x: 400, y: 900, height: 25, updated: 9 }),
  ]);
  const plan = ops.planDelete(before, { ids: [], all: true, confirm: true }, new Set(), 50, () => 1);
  const afterDelete = new Map([...before, ...plan.changed.map((e) => [e.id, e])]);
  const changed = plan.changed.map((e) => ({ id: e.id, version: e.version }));
  const { restored } = ops.planUndo(changed, before, afterDelete, 60, () => 2);
  const afterUndo = toItems(new Map([...afterDelete, ...restored.map((e) => [e.id, e])]));
  assert.deepEqual(placeAnswer(afterUndo, new Set(), 12, 170), { x: 230, y: 937 });
});

test("chooseOrigin: at, empty Board, else below the lowest Item at the Answer x (4.11.4, FR-089)", () => {
  assert.deepEqual(ops.chooseOrigin([], { x: 200.4, y: 300 }, new Set(), 170), { x: 200, y: 300 });
  assert.deepEqual(ops.chooseOrigin([], null, new Set(), 170), { x: 100, y: 100 });
  const items = toItems(board([
    el("m1", { type: "text", text: "hi", x: 100, y: 100, height: 25, updated: 5 }),
    el("low", { x: 600, y: 400, height: 60, updated: 1 }),
  ]));
  assert.deepEqual(ops.chooseOrigin(items, null, new Set(), 170), { x: -70, y: 500 });
});

test("boxOf counts the points of arrows", () => {
  assert.deepEqual(ops.boxOf([el("a", { x: 10, y: 20, width: 100, height: 50 }), { x: 0, y: 100, points: [[0, 0], [-20, 30]] }]),
    { x: -20, y: 20, width: 130, height: 110 });
});

test("filterDrawResult marks new Elements, keeps Board targets as they are, and refuses bad results (FR-090, FR-091, NFR-014)", () => {
  const onBoard = board([el("p1", { customData: undefined }), el("other")]);
  const result = [
    el("w2d", { type: "arrow", link: "https://x.example", endBinding: { elementId: "p1" } }),
    el("p1", { version: 2, boundElements: [{ id: "w2d", type: "arrow" }] }),
    el("other", { version: 2, x: 999 }),
  ];
  const { added, targets } = ops.filterDrawResult(result, onBoard, ["p1"], false);
  assert.deepEqual(added.map((e) => [e.id, e.customData.whiteboardChat, e.link]), [["w2d", "claude", null]]);
  assert.deepEqual(targets.map((e) => [e.id, e.customData]), [["p1", undefined]], "the Person's shape keeps no mark");
  assert.equal(errorOf(() => ops.filterDrawResult([el("img", { type: "image" })], onBoard, [], false)).code, "JobFailed");
  assert.equal(ops.filterDrawResult([el("img", { type: "image" })], onBoard, [], true).added.length, 1, "mermaid may add an image");
  assert.equal(errorOf(() => ops.filterDrawResult([el("f", { type: "embeddable" })], onBoard, [], true)).code, "JobFailed");
  assert.equal(errorOf(() => ops.filterDrawResult([], onBoard, [], false)).code, "JobFailed");
  assert.equal(errorOf(() => ops.filterDrawResult(new Array(5001).fill(el("a")), onBoard, [], false)).code, "JobFailed");
});

test("filterEditResult takes only the listed Items, their labels, and their arrows; marks stay (FR-099, SC-082)", () => {
  const onBoard = board([
    el("db", { customData: { whiteboardChat: "claude" }, boundElements: [{ id: "w2d", type: "arrow" }] }),
    el("lbl", { type: "text", containerId: "db" }),
    el("w2d", { type: "arrow", endBinding: { elementId: "db" } }),
    el("web"),
  ]);
  const result = ["db", "lbl", "w2d", "web", "new"].map((id) => el(id, { version: 2, customData: { whiteboardChat: "answer" } }));
  const out = ops.filterEditResult(result, onBoard, ["db"]);
  assert.deepEqual(out.map((e) => e.id), ["db", "lbl", "w2d"]);
  assert.deepEqual(out.map((e) => e.customData && e.customData.whiteboardChat), ["claude", undefined, undefined]);
});
