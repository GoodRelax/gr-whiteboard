"use strict";

// The frame builder of consult-on-board (scripts/frame.js) and its framework data (data/frameworks.json).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const SKILL = path.join(__dirname, "..", "..", "skills", "consult-on-board");
const FRAME = path.join(SKILL, "scripts", "frame.js");
const { BUILDERS, buildFrame, buildSheet, frameSlots, locateSlot, specFromData } = require(FRAME);
const GRAY = "#868e96";
const DATA = require(path.join(SKILL, "data", "frameworks.json"));

// Rules of the board for draw_skeletons: no roundness, no negative size, no empty text.
function assertDrawable(elements, label) {
  const ids = new Set();
  for (const el of elements) {
    assert.ok(!ids.has(el.id), `${label}: duplicate id ${el.id}`);
    ids.add(el.id);
    assert.ok(!("roundness" in el), `${label}: roundness on ${el.id}`);
    assert.ok((el.width ?? 0) >= 0 && (el.height ?? 0) >= 0, `${label}: negative size on ${el.id}`);
    if (el.type === "text") assert.ok(el.text, `${label}: empty text ${el.id}`);
    assert.ok(Number.isFinite(el.x) && Number.isFinite(el.y), `${label}: bad place on ${el.id}`);
  }
}

test("every framework in the data builds a drawable frame", () => {
  assert.ok(DATA.frameworks.length >= 116);
  for (const f of DATA.frameworks.filter((e) => !e.skill)) {
    const elements = buildFrame(specFromData(DATA, f.id));
    assert.ok(elements.length > 1, f.id);
    assertDrawable(elements, f.id);
  }
});

test("an entry with skill points to a skill of the plugin and has no frame", () => {
  const withSkill = DATA.frameworks.filter((e) => e.skill);
  assert.deepEqual(withSkill.map((e) => e.skill).sort(), ["four-forms", "issue-driven"]);
  for (const f of withSkill) {
    assert.ok(fs.existsSync(path.join(SKILL, "..", f.skill, "SKILL.md")), f.skill);
    assert.equal(f.shape, undefined);
    assert.equal(f.cells, undefined);
    assert.throws(() => specFromData(DATA, f.id), /run the skill/);
  }
});

test("the data has unique ids, known shapes and purposes, and all fields", () => {
  const ids = new Set();
  for (const f of DATA.frameworks) {
    assert.ok(!ids.has(f.id), `duplicate ${f.id}`);
    ids.add(f.id);
    const keys = f.skill ? ["name", "nameJa", "category", "summary", "whenToUse"] : ["name", "nameJa", "category", "summary", "guideJa", "whenToUse", "shape", "cells"];
    for (const key of keys) assert.ok(f[key] !== undefined, `${f.id}: ${key}`);
    if (!f.skill) assert.ok(BUILDERS[f.shape], `${f.id}: shape ${f.shape}`);
    assert.ok(f.purposes.length > 0, `${f.id}: purposes`);
    for (const p of f.purposes) assert.ok(DATA.purposes.includes(p), `${f.id}: purpose ${p}`);
  }
  assert.deepEqual(Object.keys(BUILDERS).sort(), [...DATA.shapes].sort());
});

test("a cross has two double-headed axes and mirrored corner labels", () => {
  const els = buildFrame({ shape: "cross", prefix: "x", width: 1000, height: 800, quadrants: ["A", "B", "C", "D"] });
  const axes = els.filter((e) => e.type === "arrow");
  assert.equal(axes.length, 2);
  for (const a of axes) assert.deepEqual([a.startArrowhead, a.endArrowhead], ["arrow", "arrow"]);
  const q = Object.fromEntries(els.filter((e) => /-q\d$/.test(e.id)).map((e) => [e.id.slice(-2), e]));
  assert.equal(q.q1.x, q.q3.x);
  assert.equal(q.q2.x, q.q4.x);
  assert.equal(q.q1.y, q.q2.y);
  assert.equal(q.q3.y, q.q4.y);
  assert.ok(q.q2.x > q.q1.x && q.q3.y > q.q1.y);
});

test("a grid has no outer frame unless asked, and uses L for headers and M for cells", () => {
  const rows = [["H1", "H2"], ["R1", "v"], ["R2", "w"]];
  const open = buildFrame({ shape: "grid", prefix: "g", rows });
  assert.deepEqual(open.filter((e) => e.type === "line").map((e) => e.id).sort(), ["g-h1", "g-h2", "g-v1"]);
  const framed = buildFrame({ shape: "grid", prefix: "g", rows, frame: true });
  assert.equal(framed.filter((e) => e.type === "line").length, 7);
  const size = Object.fromEntries(open.filter((e) => e.type === "text").map((e) => [e.id, e.fontSize]));
  assert.deepEqual([size["g-r1c2"], size["g-r2c1"], size["g-r2c2"]], [28, 28, 20]);
});

test("a canvas draws each shared edge once and no outer frame", () => {
  const areas = [{ x: 0, y: 0, w: 1, h: 1, label: "a" }, { x: 1, y: 0, w: 1, h: 1, label: "b" }, { x: 0, y: 1, w: 2, h: 1, label: "c" }];
  const lines = buildFrame({ shape: "canvas", prefix: "c", unit: 100, areas }).filter((e) => e.type === "line");
  const keys = lines.map((l) => `${l.x},${l.y},${l.points[1][0]},${l.points[1][1]}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(keys.sort(), ["0,100,200,0", "100,0,0,100"]);
});

test("a title is XL and a sheet moves each frame to its place", () => {
  const [title] = buildFrame({ shape: "list", prefix: "l", title: "T", items: ["a"] });
  assert.equal(title.fontSize, 36);
  const [alone] = buildFrame({ shape: "list", prefix: "s", items: ["a"] });
  const [moved] = buildSheet([{ shape: "list", prefix: "s", items: ["a"], at: { x: 500, y: 700 } }]);
  assert.deepEqual([moved.x - alone.x, moved.y - alone.y], [500, 700]);
});

test("a guide is a gray line under the title and pushes the body down", () => {
  const plain = buildFrame({ shape: "list", prefix: "l", title: "T", items: ["a"] });
  const guided = buildFrame({ shape: "list", prefix: "l", title: "T", guide: "what it is for", items: ["a"] });
  const guide = guided.find((e) => e.id === "l-guide");
  assert.equal(guide.strokeColor, GRAY);
  assert.ok(guide.y > guided[0].y);
  assert.ok(guided.find((e) => e.id === "l-i1").y > plain.find((e) => e.id === "l-i1").y);
});

test("examples fill the slots in gray, skip empty ones, and refuse extras", () => {
  const spec = { shape: "contrast", prefix: "c", columns: ["A", "B", "C"] };
  assert.equal(frameSlots(spec).length, 3);
  const els = buildFrame({ ...spec, examples: ["e.g. one", "", "e.g. three"] });
  const ex = els.filter((e) => /-ex\d$/.test(e.id));
  assert.deepEqual(ex.map((e) => e.id), ["c-ex1", "c-ex3"]);
  for (const e of ex) assert.deepEqual([e.strokeColor, e.fontSize], [GRAY, 20]);
  assert.throws(() => buildFrame({ ...spec, examples: ["1", "2", "3", "4"] }), /3 slots/);
});

test("every shape of the data has a slot for each place to write, except fixed labels", () => {
  const counts = { cross: 4, venn: 7, contrast: 2 };
  assert.equal(frameSlots(specFromData(DATA, "swot")).length, counts.cross);
  assert.equal(frameSlots(specFromData(DATA, "will-can-must")).length, counts.venn);
  assert.equal(frameSlots(specFromData(DATA, "pros-cons")).length, counts.contrast);
});

test("a three-set Venn keeps the circles close so the middle has room", () => {
  const els = buildFrame({ shape: "venn", prefix: "v", radius: 300, sets: ["A", "B", "C"] });
  const [a, b] = els.filter((e) => e.type === "ellipse");
  assert.ok(b.x - a.x <= 0.9 * 300, `center distance ${b.x - a.x}`);
});

test("every label has the English term beside the Japanese one (codes and numbers aside)", () => {
  const japanese = /[\u3040-\u30ff\u4e00-\u9fff]/;
  const code = /^[A-Za-z]{0,3}\s?[0-9QW]*$|^[pP][mM]$|^KGI$|^KPI$|^KR \d$/;
  const bad = [];
  const walk = (v, id) => {
    if (typeof v === "string") {
      if (v && !code.test(v) && !(japanese.test(v) && /[A-Za-z]/.test(v))) bad.push(`${id}: ${v}`);
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, id));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (!["x", "y", "w", "h", "points"].includes(k)) walk(x, id);
  };
  for (const f of DATA.frameworks.filter((e) => !e.skill)) walk(f.cells, f.id);
  assert.deepEqual(bad, []);
  assert.equal(specFromData(DATA, "pros-cons").title, "\u30e1\u30ea\u30c3\u30c8\u30fb\u30c7\u30e1\u30ea\u30c3\u30c8 Pros and Cons List");
  assert.equal(specFromData(DATA, "kpt").title.includes("KPT"), true);
});

test("a subject follows the framework name in the title", () => {
  assert.equal(specFromData(DATA, "swot", undefined, "en", "Sample Inc. products").title, "SWOT Analysis  Sample Inc. products");
  assert.equal(specFromData(DATA, "swot", undefined, "en").title, "SWOT Analysis");
  const run = spawnSync(process.execPath, [FRAME, "--spec", "swot", "--lang", "en", "--subject", "Sample Inc."], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).title, "SWOT Analysis  Sample Inc.");
});

test("locate gives the slot nearest to a point", () => {
  const spec = { shape: "contrast", prefix: "c", columns: ["A", "B"] };
  const [first, second] = frameSlots(spec);
  assert.equal(locateSlot(spec, second.x + 30, second.y + 200).n, 2);
  assert.equal(locateSlot(spec, first.x, first.y).distance, 0);
});

test("bad specs fail with a clear message", () => {
  assert.throws(() => buildFrame({ shape: "nope", prefix: "p" }), /unknown shape/);
  assert.throws(() => buildFrame({ shape: "list", prefix: "bad prefix!" }), /prefix/);
  assert.throws(() => specFromData(DATA, "nope"), /unknown framework id/);
});

test("the command line draws a framework by id", () => {
  const run = spawnSync(process.execPath, [FRAME, "--id", "swot", "--prefix", "sw1"], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const els = JSON.parse(run.stdout);
  assert.equal(els[0].id, "sw1-title");
  assert.ok(els.some((e) => e.id === "sw1-guide"));
  assertDrawable(els, "cli");
  const spec = spawnSync(process.execPath, [FRAME, "--spec", "swot", "--lang", "en"], { encoding: "utf8" });
  assert.equal(spec.status, 0, spec.stderr);
  const parsed = JSON.parse(spec.stdout);
  assert.deepEqual([parsed.shape, parsed.title], ["cross", "SWOT Analysis"]);
});
