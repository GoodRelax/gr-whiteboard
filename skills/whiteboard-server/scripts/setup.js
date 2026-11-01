#!/usr/bin/env node
"use strict";

// Setup (spec 4.9).
//   node scripts/setup.js --check   no network; reports what is there
//   node scripts/setup.js --lan     only for LAN mode: installs node-forge (fixed version) and makes
//                                   the self-signed certificate for this computer's LAN addresses
// Optional: --data DIR (default <skill folder>/.data), --forge-dir DIR (where node-forge goes; default the skill
// folder). The plugin (0.6.0) passes its data folder, because the plugin folder changes at each update (FR-131).
// Prints one JSON line. Exit code 0 if ok, 1 if not.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { readFlags } = require("./lib/config");
const { dataPaths, writeFileAtomic, readJsonOrNull } = require("./lib/data-files");
const { lanAddresses } = require("./lib/lan");
const { createBoardCa, createServerCert, certIsUsable } = require("./lib/cert");

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

let forgeDir = SKILL_DIR;
const FORGE_VERSION = require("../package.json").dependencies["node-forge"];

// @purity semi-pure-b
function loadForge() {
  try {
    return require(require.resolve("node-forge", { paths: [forgeDir, SKILL_DIR] }));
  } catch (error) {
    return null;
  }
}

// The serial number of the CA in the data folder, or null (FR-155).
// @purity semi-pure-b
function caSerialOf(paths, forge) {
  if (!forge || !fs.existsSync(paths.ca) || !fs.existsSync(paths.caKey)) return null;
  try {
    return forge.pki.certificateFromPem(fs.readFileSync(paths.ca, "utf8")).serialNumber;
  } catch (error) {
    return null;
  }
}

// @purity semi-pure-b
function check(paths) {
  const addresses = lanAddresses(os.networkInterfaces());
  const info = readJsonOrNull(paths.certInfo);
  const certFiles = fs.existsSync(paths.cert) && fs.existsSync(paths.key);
  const caSerial = caSerialOf(paths, loadForge());
  return {
    v: 1,
    ok: nodeIsNewEnough(process.version),
    node: process.version,
    nodeOk: nodeIsNewEnough(process.version),
    lanReady: loadForge() !== null && caSerial !== null && certFiles && certIsUsable(info, addresses, Date.now(), caSerial),
    forge: loadForge() !== null,
    ca: caSerial !== null,
    cert: certFiles,
    lanAddresses: addresses,
  };
}

// npm is a .cmd file on Windows, so it needs a shell there. Its arguments have no spaces.
// @purity non-pure
function runNpm(args) {
  return spawnSync("npm", args, { cwd: forgeDir, encoding: "utf8", shell: process.platform === "win32" });
}

// @purity non-pure
function setupLan(paths) {
  if (!nodeIsNewEnough(process.version)) {
    return { v: 1, ok: false, step: "node", tail: [`Node.js ${process.version} is too old; version ${MIN_NODE_MAJOR} or later is needed`] };
  }
  if (loadForge() === null) {
    // In the skill folder: its package.json pins the version. Elsewhere: the same fixed version, by name.
    const npm = forgeDir === SKILL_DIR
      ? runNpm(["install", "--omit=dev", "--no-audit", "--no-fund"])
      : runNpm(["install", `node-forge@${FORGE_VERSION}`, "--prefix", ".", "--no-save", "--no-package-lock", "--omit=dev", "--no-audit", "--no-fund"]);
    if (npm.status !== 0 || loadForge() === null) {
      return { v: 1, ok: false, step: "npm", tail: tail(`${npm.stdout}\n${npm.stderr}\n${npm.error || ""}`, TAIL_LINES) };
    }
  }
  const addresses = lanAddresses(os.networkInterfaces());
  if (addresses.length === 0) {
    return { v: 1, ok: false, step: "address", tail: ["this computer has no LAN address (IPv4); connect it to a network first"] };
  }
  const forge = loadForge();
  fs.mkdirSync(path.dirname(paths.cert), { recursive: true });
  // The CA is made once and kept; the user trusts it once (FR-155, FR-157).
  let caSerial = caSerialOf(paths, forge);
  const madeCa = caSerial === null;
  if (madeCa) {
    const ca = createBoardCa(forge, { nowMs: Date.now() });
    writeFileAtomic(paths.caKey, ca.caKeyPem);
    writeFileAtomic(paths.ca, ca.caCertPem);
    caSerial = ca.serial;
  }
  const info = readJsonOrNull(paths.certInfo);
  const certFiles = fs.existsSync(paths.cert) && fs.existsSync(paths.key);
  const result = { v: 1, ok: true, step: "done", madeCa, madeCert: false, caPath: paths.ca, lanAddresses: addresses, tail: [] };
  if (certFiles && certIsUsable(info, addresses, Date.now(), caSerial)) return result;
  // A new LAN address, an old self-signed certificate (0.6.0), or a near end date: a new server certificate.
  const made = createServerCert(forge, {
    caCertPem: fs.readFileSync(paths.ca, "utf8"), caKeyPem: fs.readFileSync(paths.caKey, "utf8"), addresses, nowMs: Date.now(),
  });
  writeFileAtomic(paths.key, made.keyPem);
  writeFileAtomic(paths.cert, made.certPem);
  writeFileAtomic(paths.certInfo, JSON.stringify(made.info) + "\n");
  return { ...result, madeCert: true, namedAddresses: made.info.named };
}

// @purity non-pure
function main() {
  const argv = process.argv.slice(2);
  const flags = readFlags(argv);
  if (flags.get("--forge-dir")) {
    forgeDir = path.resolve(flags.get("--forge-dir"));
    fs.mkdirSync(forgeDir, { recursive: true });
  }
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
