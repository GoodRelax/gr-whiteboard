"use strict";

// Reads the Server settings from command-line flags. See spec 4.2.

const path = require("path");

const INTEGER_SETTINGS = Object.freeze([
  { name: "port", flag: "--port", defaultValue: 47830, min: 1024, max: 65535 },
  { name: "controlPort", flag: "--control-port", defaultValue: 47831, min: 1024, max: 65535 },
  { name: "tickMs", flag: "--tick-ms", defaultValue: 250, min: 50, max: 10000 },
  { name: "settleMs", flag: "--settle-ms", defaultValue: 1500, min: 0, max: 60000 },
  { name: "saveMs", flag: "--save-ms", defaultValue: 3000, min: 100, max: 600000 },
  { name: "jobTimeoutMs", flag: "--job-timeout-ms", defaultValue: 15000, min: 1000, max: 120000 },
  { name: "maxTextChars", flag: "--max-text-chars", defaultValue: 2000, min: 1, max: 20000 },
  { name: "answerGapPx", flag: "--answer-gap-px", defaultValue: 40, min: 0, max: 1000 },
]);

// Flags that take no value.
const SWITCHES = new Set(["--lan", "--check"]);

// @purity pure
function readFlags(argv) {
  const flags = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq > 0) flags.set(arg.slice(0, eq), arg.slice(eq + 1));
    else if (SWITCHES.has(arg)) flags.set(arg, "true");
    else {
      flags.set(arg, argv[i + 1]);
      i += 1;
    }
  }
  return flags;
}

// @purity pure
function parseInteger(raw, setting) {
  if (raw === undefined) return { ok: true, value: setting.defaultValue };
  const value = Number(raw);
  if (!Number.isInteger(value) || value < setting.min || value > setting.max) {
    return { ok: false, message: `${setting.flag} must be an integer from ${setting.min} to ${setting.max}` };
  }
  return { ok: true, value };
}

// Returns { ok: true, config } or { ok: false, reason, message, logPath }.
// `tempDir` and `skillDir` are passed in so this function stays pure.
// `logPath` is in the failure result too, so the failure can be written to the log.
// @purity pure
function parseConfig(argv, tempDir, skillDir) {
  const flags = readFlags(argv);
  const dataDir = path.resolve(flags.get("--data") || path.join(skillDir, ".data"));
  const logPath = path.join(dataDir, "server.log");
  const config = { dataDir, logPath, lan: flags.get("--lan") === "true" };
  for (const setting of INTEGER_SETTINGS) {
    const result = parseInteger(flags.get(setting.flag), setting);
    if (!result.ok) return { ok: false, reason: "InvalidConfig", message: result.message, logPath };
    config[setting.name] = result.value;
  }
  if (config.port === config.controlPort) {
    return { ok: false, reason: "InvalidConfig", message: "--port and --control-port must differ", logPath };
  }
  config.shotDir = path.resolve(flags.get("--shot-dir") || path.join(tempDir, "whiteboard-chat"));
  return { ok: true, config: Object.freeze(config) };
}

module.exports = { parseConfig, readFlags };
