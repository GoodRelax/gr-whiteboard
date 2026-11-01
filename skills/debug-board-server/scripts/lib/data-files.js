"use strict";

// DataFiles (Adapter). Reads and writes the files in the data folder. See spec 4.5.
//   board.json   the Board (FR-040)
//   token.txt    the Token (FR-045)
//   baseline.json  the Board at the last Send, as summaries (FR-076)
//   cert.pem, key.pem, cert-info.json   the server certificate for LAN mode (FR-047)
//   ca.crt, ca-key.pem   the CA of this board that signs it (0.6.1, FR-155)
//   files/<id>.json   one image file of the Board (FR-082)
//   snapshots/<opId>.json   the whole Board before Operation opId (FR-102)

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const BOARD_FILE_VERSION = 1;
const TOKEN_BYTES = 18;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

// @purity pure
function dataPaths(dataDir) {
  return Object.freeze({
    board: path.join(dataDir, "board.json"),
    token: path.join(dataDir, "token.txt"),
    baseline: path.join(dataDir, "baseline.json"),
    cert: path.join(dataDir, "cert.pem"),
    key: path.join(dataDir, "key.pem"),
    certInfo: path.join(dataDir, "cert-info.json"),
    ca: path.join(dataDir, "ca.crt"),
    caKey: path.join(dataDir, "ca-key.pem"),
    files: path.join(dataDir, "files"),
    snapshots: path.join(dataDir, "snapshots"),
  });
}

// Writes to a temporary file first, so a crash never leaves half a file.
// @purity non-pure
function writeFileAtomic(filePath, text) {
  const temp = `${filePath}.tmp`;
  fs.writeFileSync(temp, text, "utf8");
  fs.renameSync(temp, filePath);
}

// Returns { elements, warning }. A broken file is kept under another name, and the Board starts empty.
// @purity non-pure
function loadBoard(filePath, nowMs) {
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    return { elements: [], warning: null };
  }
  try {
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.elements)) throw new Error("no elements array");
    return { elements: data.elements, warning: null };
  } catch (error) {
    const keptAs = `${filePath}.broken-${nowMs}`;
    fs.renameSync(filePath, keptAs);
    return { elements: [], warning: `board.json could not be read (${error.message}); kept as ${path.basename(keptAs)}` };
  }
}

// @purity non-pure
function saveBoard(filePath, elements) {
  writeFileAtomic(filePath, JSON.stringify({ v: BOARD_FILE_VERSION, elements }));
}

// The Token stays the same across restarts, so a page that is open can connect again.
// @purity non-pure
function loadOrCreateToken(filePath) {
  try {
    const token = fs.readFileSync(filePath, "utf8").trim();
    if (TOKEN_PATTERN.test(token)) return token;
  } catch (error) {
    // No token yet.
  }
  const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
  writeFileAtomic(filePath, token + "\n");
  return token;
}

// @purity semi-pure-b
function readJsonOrNull(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return null;
  }
}

// Returns every file object in `filesDir` (the caller checks them). Broken files are skipped.
// @purity semi-pure-b
function loadFiles(filesDir) {
  let names = [];
  try {
    names = fs.readdirSync(filesDir).filter((name) => name.endsWith(".json"));
  } catch (error) {
    return [];
  }
  return names.map((name) => readJsonOrNull(path.join(filesDir, name))).filter((file) => file !== null);
}

// `file` was checked (board-files.js), so its id is safe as a file name.
// @purity non-pure
function saveFile(filesDir, file) {
  fs.mkdirSync(filesDir, { recursive: true });
  writeFileAtomic(path.join(filesDir, `${file.id}.json`), JSON.stringify(file));
}

const SNAPSHOT_NAME = /^([1-9][0-9]{0,15})\.json$/;
const LAST_OP_ID_NAME = "last-op-id.json";

// The Snapshot file port of OperationLog (FR-102, FR-105). `nowMs()` names broken files.
// @purity non-pure
function createSnapshotStore(snapshotsDir, nowMs) {
  const fileOf = (opId) => path.join(snapshotsDir, `${opId}.json`);
  return Object.freeze({
    // @purity non-pure
    write(opId, data) {
      fs.mkdirSync(snapshotsDir, { recursive: true });
      writeFileAtomic(fileOf(opId), JSON.stringify(data));
    },
    // @purity semi-pure-b
    read(opId) {
      return JSON.parse(fs.readFileSync(fileOf(opId), "utf8"));
    },
    // @purity non-pure
    remove(opId) {
      fs.rmSync(fileOf(opId), { force: true });
    },
    // The last opId given out, so that an undone opId is not given again after a restart (R-023).
    // @purity semi-pure-b
    readLastOpId() {
      const data = readJsonOrNull(path.join(snapshotsDir, LAST_OP_ID_NAME));
      return data && Number.isInteger(data.opId) && data.opId > 0 ? data.opId : 0;
    },
    // @purity non-pure
    writeLastOpId(opId) {
      fs.mkdirSync(snapshotsDir, { recursive: true });
      writeFileAtomic(path.join(snapshotsDir, LAST_OP_ID_NAME), JSON.stringify({ opId }));
    },
    // A file that cannot be read is renamed to <name>.broken-<ms> (FR-105).
    // @purity non-pure
    readAll() {
      let names = [];
      try {
        names = fs.readdirSync(snapshotsDir).filter((name) => SNAPSHOT_NAME.test(name));
      } catch (error) {
        return { snapshots: [], warnings: [] };
      }
      const snapshots = [];
      const warnings = [];
      for (const name of names) {
        const filePath = path.join(snapshotsDir, name);
        try {
          const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
          const opId = Number(SNAPSHOT_NAME.exec(name)[1]);
          if (!data || data.opId !== opId || !Array.isArray(data.elements) || !Array.isArray(data.changed)) {
            throw new Error("not a snapshot");
          }
          snapshots.push(data);
        } catch (error) {
          const keptAs = `${filePath}.broken-${nowMs()}`;
          try {
            fs.renameSync(filePath, keptAs);
          } catch (renameError) {
            // Leave it; it is read again at the next start.
          }
          warnings.push(`snapshot ${name} could not be read (${error.message}); kept as ${path.basename(keptAs)}`);
        }
      }
      return { snapshots, warnings };
    },
  });
}

module.exports = { createSnapshotStore, dataPaths, writeFileAtomic, loadBoard, saveBoard, loadOrCreateToken, readJsonOrNull, loadFiles, saveFile };
