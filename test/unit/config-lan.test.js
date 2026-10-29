"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { parseConfig, readFlags } = require("../../skills/whiteboard-server/scripts/lib/config");
const { lanAddresses, boardUrls } = require("../../skills/whiteboard-server/scripts/lib/lan");
const { contentSecurityPolicy, importMapOf, isSameOrigin } = require("../../skills/whiteboard-server/scripts/lib/board-api");
const { validateAnswer, isLocalTool } = require("../../skills/whiteboard-server/scripts/lib/control-api");
const { certIsUsable } = require("../../skills/whiteboard-server/scripts/lib/cert");

const SKILL = path.resolve("skill");
const TEMP = path.resolve("temp");

test("defaults: this computer only, ports 47830 and 47831, data in <skill>/.data", () => {
  const { ok, config } = parseConfig([], TEMP, SKILL);
  assert.equal(ok, true);
  assert.equal(config.lan, false);
  assert.equal(config.port, 47830);
  assert.equal(config.controlPort, 47831);
  assert.equal(config.dataDir, path.join(SKILL, ".data"));
  assert.equal(config.logPath, path.join(SKILL, ".data", "server.log"));
  assert.equal(config.shotDir, path.join(TEMP, "whiteboard-chat"));
});

test("--lan is a switch and does not eat the next flag", () => {
  const { config } = parseConfig(["--lan", "--port", "5000"], TEMP, SKILL);
  assert.equal(config.lan, true);
  assert.equal(config.port, 5000);
  assert.equal(readFlags(["--check", "--data", "d"]).get("--data"), "d");
});

test("bad numbers and equal ports are InvalidConfig", () => {
  assert.equal(parseConfig(["--port", "80"], TEMP, SKILL).reason, "InvalidConfig");
  assert.equal(parseConfig(["--settle-ms=x"], TEMP, SKILL).reason, "InvalidConfig");
  assert.equal(parseConfig(["--port", "5000", "--control-port", "5000"], TEMP, SKILL).reason, "InvalidConfig");
});

test("lanAddresses keeps external IPv4 only", () => {
  const interfaces = {
    lo: [{ family: "IPv4", address: "127.0.0.1", internal: true }],
    eth: [{ family: "IPv4", address: "192.168.1.5", internal: false }, { family: "IPv6", address: "fe80::1", internal: false }],
    wifi: [{ family: 4, address: "10.0.0.2", internal: false }, { family: "IPv4", address: "169.254.3.4", internal: false }],
  };
  assert.deepEqual(lanAddresses(interfaces), ["10.0.0.2", "192.168.1.5"]);
});

test("Board URLs: http on 127.0.0.1, https in LAN mode, Token after # (FR-044 to FR-046)", () => {
  assert.deepEqual(boardUrls({ lan: false, port: 47830, token: "TOK", addresses: ["10.0.0.2"] }), {
    local: "http://127.0.0.1:47830/#t=TOK", lan: [],
  });
  assert.deepEqual(boardUrls({ lan: true, port: 47830, token: "TOK", addresses: ["10.0.0.2"] }), {
    local: "https://localhost:47830/#t=TOK", lan: ["https://10.0.0.2:47830/#t=TOK"],
  });
});

test("the page may load scripts only from itself, esm.sh, and its own import map", () => {
  const html = '<script type="importmap">{"imports":{}}</script>';
  assert.equal(importMapOf(html), '{"imports":{}}');
  const csp = contentSecurityPolicy("HASH");
  assert.match(csp, /script-src 'self' https:\/\/esm\.sh 'sha256-HASH'/);
  assert.match(csp, /frame-ancestors 'none'/);
});

test("Board API refuses requests from other sites (FR-048)", () => {
  assert.equal(isSameOrigin({ headers: { host: "127.0.0.1:47830" } }), true);
  assert.equal(isSameOrigin({ headers: { host: "127.0.0.1:47830", origin: "http://127.0.0.1:47830" } }), true);
  assert.equal(isSameOrigin({ headers: { host: "127.0.0.1:47830", origin: "https://evil.example" } }), false);
  assert.equal(isSameOrigin({ headers: { host: "127.0.0.1:47830", origin: "null" } }), false);
});

test("Control API is for local tools only (FR-049)", () => {
  assert.equal(isLocalTool({ headers: { host: "127.0.0.1:47831" } }, 47831), true);
  assert.equal(isLocalTool({ headers: { host: "localhost:47831" } }, 47831), true);
  assert.equal(isLocalTool({ headers: { host: "127.0.0.1:47831", origin: "http://127.0.0.1:47830" } }, 47831), false);
  assert.equal(isLocalTool({ headers: { host: "evil.example:47831" } }, 47831), false);
});

test("validateAnswer checks text and at", () => {
  assert.equal(validateAnswer({ text: "hi" }, 10), null);
  assert.equal(validateAnswer({ text: "  " }, 10).code, "InvalidText");
  assert.equal(validateAnswer({ text: "x".repeat(11) }, 10).code, "InvalidText");
  assert.equal(validateAnswer({ text: "hi", at: { x: 1 } }, 10).code, "InvalidAt");
  assert.equal(validateAnswer({ text: "hi", at: { x: 1, y: 2 } }, 10), null);
});

test("a certificate is usable only if it names every LAN address and is not about to expire", () => {
  const day = 24 * 60 * 60 * 1000;
  const info = { addresses: ["10.0.0.2"], notAfterMs: 100 * day };
  assert.equal(certIsUsable(info, ["10.0.0.2"], 0), true);
  assert.equal(certIsUsable(info, ["10.0.0.3"], 0), false);
  assert.equal(certIsUsable(info, ["10.0.0.2"], 95 * day), false);
  assert.equal(certIsUsable(null, [], 0), false);
});
