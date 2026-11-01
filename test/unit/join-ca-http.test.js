"use strict";

// 0.7.1: the "Join" dialog targets (NG-1, FR-163), the CA over http (NG-3, FR-166), and the ports.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const path = require("path");

const LIB = path.join(__dirname, "..", "..", "skills", "debug-board-server", "scripts", "lib");
const { lanInterfaces, joinTargets, kindOf } = require(path.join(LIB, "lan"));
const { createCaHttpServer, defaultRouteAddress } = require(path.join(LIB, "ca-http"));
const { parseConfig } = require(path.join(LIB, "config"));

const INTERFACES = {
  "vEthernet (Default Switch)": [{ family: "IPv4", address: "172.21.144.1", internal: false }],
  "Wi-Fi": [{ family: "IPv4", address: "192.168.10.3", internal: false }, { family: "IPv6", address: "fe80::1", internal: false }],
  "vEthernet (Onboard-Internal)": [{ family: "IPv4", address: "192.168.100.1", internal: false }],
  Ethernet: [{ family: "IPv4", address: "169.254.11.218", internal: false }],
  "Loopback Pseudo-Interface 1": [{ family: "IPv4", address: "127.0.0.1", internal: true }],
};

test("each LAN address gets its kind and label; the address of the default route is recommended and first (FR-163)", () => {
  assert.deepEqual(lanInterfaces(INTERFACES), [
    { address: "172.21.144.1", name: "vEthernet (Default Switch)" },
    { address: "192.168.10.3", name: "Wi-Fi" },
    { address: "192.168.100.1", name: "vEthernet (Onboard-Internal)" },
  ]);
  const targets = joinTargets({ interfaces: lanInterfaces(INTERFACES), port: 47830, caPort: 47832, token: "TOK", routeAddress: "192.168.10.3" });
  assert.deepEqual(targets.map((t) => [t.address, t.kind, t.recommended]), [
    ["192.168.10.3", "wifi", true], ["172.21.144.1", "virtual", false], ["192.168.100.1", "virtual", false],
  ]);
  assert.deepEqual([targets[0].url, targets[0].caUrl, targets[0].label], ["https://192.168.10.3:47830/#t=TOK", "http://192.168.10.3:47832/ca.crt", "Wi-Fi"]);
  assert.match(targets[1].label, /^Virtual switch/);
  const noRoute = joinTargets({ interfaces: lanInterfaces(INTERFACES), port: 1, caPort: null, token: "T", routeAddress: null });
  assert.deepEqual([noRoute[0].address, noRoute[0].recommended, noRoute[0].caUrl], ["192.168.10.3", false, null], "without a route, Wi-Fi still comes first");
  assert.deepEqual(["en0", "eth0", "wlan0", "docker0", "utun3", "Mobile"].map(kindOf), ["wired", "wired", "wifi", "virtual", "virtual", "other"]);
});

test("the CA port gives only GET and HEAD /ca.crt; every other path is 404 (FR-166)", async () => {
  const der = Buffer.from([0x30, 0x03, 0x02, 0x01, 0x01]);
  const server = createCaHttpServer(der);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const call = (method, urlPath) => new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: server.address().port, method, path: urlPath }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, type: res.headers["content-type"], body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
  try {
    const got = await call("GET", "/ca.crt");
    assert.deepEqual([got.status, got.type, got.body.equals(der)], [200, "application/x-x509-ca-cert", true]);
    assert.equal((await call("GET", "/ca.crt?x=1")).status, 200);
    assert.deepEqual([(await call("HEAD", "/ca.crt")).status, (await call("HEAD", "/ca.crt")).body.length], [200, 0]);
    for (const [method, urlPath] of [["GET", "/"], ["GET", "/v1/status"], ["GET", "/api/stream"], ["GET", "/ca-key.pem"], ["POST", "/ca.crt"], ["GET", "/ca.crt/x"]]) {
      assert.equal((await call(method, urlPath)).status, 404, `${method} ${urlPath}`);
    }
  } finally {
    server.close();
  }
});

test("the CA port must differ from the other ports; the default route gives an address or null (FR-166, FR-163)", async () => {
  assert.equal(parseConfig([], "", "skill").config.caPort, 47832);
  const same = parseConfig(["--ca-port", "47830"], "", "skill");
  assert.deepEqual([same.ok, same.reason], [false, "InvalidConfig"]);
  const route = await defaultRouteAddress();
  assert.ok(route === null || /^\d+\.\d+\.\d+\.\d+$/.test(route), String(route));
});
