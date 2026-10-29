#!/usr/bin/env node
"use strict";

// Setup (spec 4.9).
//   node scripts/setup.js --check   no network; reports what is there
//   node scripts/setup.js --lan     only for LAN mode: installs node-forge (fixed version) and makes
//                                   the self-signed certificate for this computer's LAN addresses
// Optional: --data DIR (default <skill folder>/.data).
// Prints one JSON line. Exit code 0 if ok, 1 if not.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { readFlags } = require("./lib/config");
const { dataPaths, writeFileAtomic, readJsonOrNull } = require("./lib/data-files");
const { lanAddresses } = require("./lib/lan");
const { createSelfSignedCert, certIsUsable } = require("./lib/cert");

const SKILL_DIR = path.resolve(__dirname, "..");
const MIN_NODE_MAJOR = 20;
const TAIL_LINES = 20;

// @purity pure
function nodeIsNewEnough(version) {
  return Number(version.replace(/^v/, "").split(".")[0]) >= MIN_NODE_MAJOR;
}

// @purity pure
function tail(text, lines) {
  return String(text || "").split(/\r?\n/).filter((line) => line.trim() !== "").slice(-lines);
}

// @purity semi-pure-b
function loadForge() {
  try {
    return require(require.resolve("node-forge", { paths: [SKILL_DIR] }));
  } catch (error) {
    return null;
  }
}

// @purity semi-pure-b
function check(paths) {
  const addresses = lanAddresses(os.networkInterfaces());
  const info = readJsonOrNull(paths.certInfo);
  const certFiles = fs.existsSync(paths.cert) && fs.existsSync(paths.key);
  return {
    v: 1,
    ok: nodeIsNewEnough(process.version),
    node: process.version,
    nodeOk: nodeIsNewEnough(process.version),
    lanReady: loadForge() !== null && certFiles && certIsUsable(info, addresses, Date.now()),
    forge: loadForge() !== null,
    cert: certFiles,
    lanAddresses: addresses,
  };
}

// npm is a .cmd file on Windows, so it needs a shell there. Its arguments have no spaces.
// @purity non-pure
function runNpm(args) {
  return spawnSync("npm", args, { cwd: SKILL_DIR, encoding: "utf8", shell: process.platform === "win32" });
}

// @purity non-pure
function setupLan(paths) {
  if (!nodeIsNewEnough(process.version)) {
    return { v: 1, ok: false, step: "node", tail: [`Node.js ${process.version} is too old; version ${MIN_NODE_MAJOR} or later is needed`] };
  }
  if (loadForge() === null) {
    const npm = runNpm(["install", "--omit=dev", "--no-audit", "--no-fund"]);
    if (npm.status !== 0 || loadForge() === null) {
      return { v: 1, ok: false, step: "npm", tail: tail(`${npm.stdout}\n${npm.stderr}\n${npm.error || ""}`, TAIL_LINES) };
    }
  }
  const addresses = lanAddresses(os.networkInterfaces());
  if (addresses.length === 0) {
    return { v: 1, ok: false, step: "address", tail: ["this computer has no LAN address (IPv4); connect it to a network first"] };
  }
  const info = readJsonOrNull(paths.certInfo);
  const certFiles = fs.existsSync(paths.cert) && fs.existsSync(paths.key);
  if (certFiles && certIsUsable(info, addresses, Date.now())) {
    return { v: 1, ok: true, step: "done", madeCert: false, lanAddresses: addresses, tail: [] };
  }
  fs.mkdirSync(path.dirname(paths.cert), { recursive: true });
  const made = createSelfSignedCert(loadForge(), { addresses, nowMs: Date.now() });
  writeFileAtomic(paths.key, made.keyPem);
  writeFileAtomic(paths.cert, made.certPem);
  writeFileAtomic(paths.certInfo, JSON.stringify(made.info) + "\n");
  return { v: 1, ok: true, step: "done", madeCert: true, lanAddresses: addresses, tail: [] };
}

// @purity non-pure
function main() {
  const argv = process.argv.slice(2);
  const flags = readFlags(argv);
  const paths = dataPaths(path.resolve(flags.get("--data") || path.join(SKILL_DIR, ".data")));
  let result;
  if (argv.includes("--check")) result = check(paths);
  else if (argv.includes("--lan")) result = setupLan(paths);
  else {
    process.stderr.write("usage: setup.js --check | --lan [--data DIR]\n");
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(result) + "\n");
  process.exit(result.ok ? 0 : 1);
}

main();
