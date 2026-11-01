"use strict";

// 0.6.1: the idle stop (R-039) and the CA of the board (R-040). Pure parts, with a fake clock.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const path = require("path");

const LIB = path.join(__dirname, "..", "..", "skills", "debug-board-server", "scripts", "lib");
const { createIdleTimer, warnTimeOf } = require(path.join(LIB, "idle-timer"));
const { toExcalidrawFile, exportFileName } = require(path.join(LIB, "excalidraw-file"));
const { createBoardCa, createServerCert, certIsUsable, isPermittedAddress, trustCommand } = require(path.join(LIB, "cert"));

// @purity non-pure
function fakeClock() {
  let now = 1000;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms) {
      const id = nextId;
      nextId += 1;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = until;
    },
  };
}

test("the idle timer warns 5 minutes before, stops after the idle time, and a touch starts it again (FR-159, FR-160)", () => {
  const clock = fakeClock();
  const seen = [];
  const idleMs = 60 * 60000;
  const idle = createIdleTimer({
    clock, idleMs, warnMs: warnTimeOf(idleMs, 5 * 60000),
    onWarn: (stopAtMs) => seen.push(["warn", stopAtMs]), onClear: () => seen.push(["clear"]), onIdle: () => seen.push(["idle", clock.now()]),
  });
  idle.touch();
  clock.advance(54 * 60000);
  assert.deepEqual(seen, []);
  clock.advance(60000);
  assert.deepEqual(seen, [["warn", 1000 + idleMs]]);
  assert.equal(idle.warningStopAtMs(), 1000 + idleMs);
  idle.touch();
  assert.deepEqual(seen.at(-1), ["clear"]);
  assert.equal(idle.warningStopAtMs(), null);
  clock.advance(59 * 60000);
  idle.touch();
  clock.advance(59 * 60000);
  assert.equal(seen.filter(([kind]) => kind === "idle").length, 0, "every touch starts the time again");
  clock.advance(60000);
  assert.deepEqual(seen.at(-1), ["idle", 1000 + 55 * 60000 + 59 * 60000 + 60 * 60000]);
  assert.equal(warnTimeOf(4000, 300000), 2000, "a short idle time warns at half of it");
});

test("idle time 0 never stops (FR-159)", () => {
  const clock = fakeClock();
  let stopped = false;
  const idle = createIdleTimer({ clock, idleMs: 0, warnMs: 0, onWarn: () => {}, onClear: () => {}, onIdle: () => { stopped = true; } });
  idle.touch();
  clock.advance(10 * 24 * 60 * 60000);
  assert.equal(stopped, false);
});

test("the .excalidraw file has the Elements that are not deleted and only their files (FR-161)", () => {
  const elements = new Map([
    ["a", { id: "a", type: "rectangle" }],
    ["gone", { id: "gone", type: "text", isDeleted: true }],
    ["img", { id: "img", type: "image", fileId: "f1" }],
  ]);
  const files = new Map([["f1", { id: "f1", mimeType: "image/png", dataURL: "data:image/png;base64,AA", created: 5, extra: 1 }], ["f2", { id: "f2" }]]);
  const file = toExcalidrawFile(elements, files);
  assert.deepEqual([file.type, file.version, file.elements.map((e) => e.id), Object.keys(file.files)], ["excalidraw", 2, ["a", "img"], ["f1"]]);
  assert.deepEqual(file.files.f1, { id: "f1", mimeType: "image/png", dataURL: "data:image/png;base64,AA", created: 5 });
  assert.equal(exportFileName(new Date(2026, 10, 1, 9, 5, 7)), "whiteboard-20261101-090507.excalidraw");
});

test("the CA may sign only for localhost and private addresses (FR-155)", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.254", "192.168.10.3"]) assert.equal(isPermittedAddress(ip), true, ip);
  for (const ip of ["172.15.0.1", "172.32.0.1", "100.64.1.2", "8.8.8.8", "192.169.0.1", "fe80::1"]) assert.equal(isPermittedAddress(ip), false, ip);
  assert.equal(trustCommand("win32", "C:\\d\\ca.crt"), "certutil -user -addstore Root \"C:\\d\\ca.crt\"");
  assert.match(trustCommand("darwin", "/d/ca.crt"), /^security add-trusted-cert -r trustRoot .* "\/d\/ca\.crt"$/);
});

test("the CA signs a server certificate for the private LAN addresses; a new CA needs a new one (FR-155, FR-156)", (t) => {
  let forge;
  try {
    forge = require(require.resolve("node-forge", { paths: [path.join(__dirname, "..", "..", "skills", "debug-board-server")] }));
  } catch (error) {
    t.skip("node-forge is not installed (it comes with setup.js --lan)");
    return;
  }
  const nowMs = Date.UTC(2026, 10, 1);
  const ca = createBoardCa(forge, { nowMs });
  const made = createServerCert(forge, { caCertPem: ca.caCertPem, caKeyPem: ca.caKeyPem, addresses: ["192.168.10.3", "100.64.1.2"], nowMs });
  const [leafPem] = made.certPem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
  const leaf = new crypto.X509Certificate(leafPem);
  const caCert = new crypto.X509Certificate(ca.caCertPem);
  assert.equal(caCert.ca, true);
  assert.equal(leaf.checkIssued(caCert), true);
  assert.equal(leaf.verify(caCert.publicKey), true);
  assert.equal(made.certPem.endsWith(ca.caCertPem), true, "the chain ends with the CA");
  assert.equal(leaf.subjectAltName, "DNS:localhost, IP Address:127.0.0.1, IP Address:192.168.10.3", "a public address stays out");
  const constraints = forge.pki.certificateFromPem(ca.caCertPem).extensions.find((e) => e.id === "2.5.29.30");
  assert.equal(constraints.critical, true);
  const der = Buffer.from(constraints.value, "binary").toString("hex");
  for (const hex of ["82096c6f63616c686f7374", "8708c0a80000ffff0000", "ac100000fff00000", "0a000000ff000000", "7f000000ff000000"]) assert.ok(der.includes(hex), hex);
  assert.equal(certIsUsable(made.info, ["192.168.10.3"], nowMs, ca.serial), true);
  assert.equal(certIsUsable(made.info, ["192.168.10.3"], nowMs, "other"), false, "a certificate of another CA (or self-signed, 0.6.0)");
  assert.equal(certIsUsable({ addresses: ["192.168.10.3"], notAfterMs: nowMs + 30 * 86400000 }, ["192.168.10.3"], nowMs, ca.serial), false);
  assert.equal(Math.round((leaf.validToDate - nowMs) / 86400000), 397);
});
