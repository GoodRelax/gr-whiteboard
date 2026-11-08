#!/usr/bin/env node
"use strict";

// Summary: The command line of comment-lint: reads files, runs the judge and prints the report.
// Exit codes: 0 no violation (or none over the baseline), 1 violations, 2 a tool error.
// Temporary: The summary has two sentences. Until: The design of comment-lint is in a specification.

const fs = require("node:fs");
const path = require("node:path");
const { ConfigError, normalizeConfig } = require("./lib/config");
const { ParseError, parseSource } = require("./lib/acorn-adapter");
const { judgeFile } = require("./lib/judge");
const { extractSpecIds } = require("./lib/rules/spec");
const { matchesAny } = require("./lib/glob");
const { baselineDocument, compareToBaseline, violationsOver } = require("./lib/baseline");
const { formatText, formatJson } = require("./lib/format");

const EXTENSIONS = new Set([".js", ".cjs", ".mjs"]);
const DEFAULT_CONFIG = path.join(__dirname, "comment-lint.config.json");
const USAGE = `usage: node cli.js [--json] [--config <file>] [--no-baseline] [--update-baseline] [file or folder ...]
  --json             print the report as JSON
  --config <file>    config file (default: comment-lint.config.json next to cli.js)
  --no-baseline      report every violation and ignore the baseline
  --update-baseline  write the current counts to the baseline file and exit 0
Without a file or folder, the paths of the config are checked.
`;

class UsageError extends Error {}

// @purity pure
function parseArgs(argv) {
  const options = { json: false, config: DEFAULT_CONFIG, useBaseline: true, updateBaseline: false, help: false, targets: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--no-baseline") options.useBaseline = false;
    else if (arg === "--update-baseline") options.updateBaseline = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--config") {
      if (index + 1 >= argv.length) throw new UsageError("--config needs a file");
      index += 1;
      options.config = argv[index];
    } else if (arg.startsWith("--")) throw new UsageError(`unknown option ${arg}`);
    else options.targets.push(arg);
  }
  return options;
}

// @purity pure
function slashPath(from, to) {
  return path.relative(from, to).split(path.sep).join("/");
}

// Section: file system and process

// @purity semi-pure-mutable
function loadConfig(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    throw new ConfigError(`cannot read the config ${file}: ${error.message}`);
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`the config ${file} is not valid JSON: ${error.message}`);
  }
  return normalizeConfig(raw, path.dirname(path.resolve(file)));
}

// @purity semi-pure-mutable
function collectFiles(target, config, found) {
  let stat;
  try {
    stat = fs.statSync(target);
  } catch (error) {
    throw new UsageError(`cannot read ${target}: ${error.message}`);
  }
  if (stat.isFile()) {
    found.add(target);
    return;
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const full = path.join(target, entry.name);
    const relative = slashPath(config.root, full);
    if (matchesAny(relative, config.exclude) || matchesAny(`${relative}/`, config.exclude)) continue;
    if (entry.isDirectory()) collectFiles(full, config, found);
    else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) found.add(full);
  }
}

// @purity semi-pure-mutable
function readSpecIds(config) {
  const ids = new Set();
  for (const file of config.specFiles) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (error) {
      throw new ConfigError(`cannot read the specification ${file}: ${error.message}`);
    }
    for (const id of extractSpecIds(text, config.specIdPattern)) ids.add(id);
  }
  return ids;
}

// @purity semi-pure-mutable
function readBaseline(file) {
  if (!fs.existsSync(file)) return { files: {} };
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new ConfigError(`the baseline ${file} is not valid JSON: ${error.message}`);
  }
}

// @purity semi-pure-mutable
function lintFiles(files, config, cwd) {
  const specIds = readSpecIds(config);
  const violations = [];
  const errors = [];
  for (const file of files) {
    const relative = slashPath(config.root, file);
    const display = slashPath(cwd, file);
    try {
      const input = parseSource(fs.readFileSync(file, "utf8"), path.extname(file));
      const found = judgeFile(input, {
        kinds: config.kinds,
        allowShebang: config.allowShebang,
        licenseHeaderPattern: config.licenseHeaderPattern,
        specIds,
        specIdPattern: config.specIdPattern,
        isPurityExemptFile: matchesAny(relative, config.purityExclude),
        exemptSingleExpressionLambdas: config.exemptSingleExpressionLambdas,
      });
      for (const violation of found) violations.push({ ...violation, file: relative, display });
    } catch (error) {
      if (error instanceof ParseError) errors.push({ display, line: error.line, column: error.column, message: `cannot parse: ${error.message}` });
      else if (error.code !== undefined) errors.push({ display, line: 1, column: 1, message: `cannot read: ${error.message}` });
      else throw error;
    }
  }
  return { violations, errors };
}

// @purity non-pure
function main(argv, cwd, stdout, stderr) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      stdout.write(USAGE);
      return 0;
    }
    const config = loadConfig(path.resolve(cwd, options.config));
    const targets = options.targets.length > 0
      ? options.targets.map((target) => path.resolve(cwd, target))
      : config.paths.map((target) => path.resolve(config.root, target));
    const found = new Set();
    for (const target of targets) collectFiles(target, config, found);
    const files = [...found].sort();
    const { violations, errors } = lintFiles(files, config, cwd);
    if (options.updateBaseline) {
      if (config.baseline === null) throw new UsageError("--update-baseline needs baseline in the config");
      fs.writeFileSync(config.baseline, `${JSON.stringify(baselineDocument(violations), null, 2)}\n`);
      stdout.write(`baseline written: ${slashPath(cwd, config.baseline)} (${violations.length} violations)\n`);
      return errors.length > 0 ? 2 : 0;
    }
    let baseline = null;
    let shown = violations;
    if (options.useBaseline && config.baseline !== null) {
      baseline = { ...compareToBaseline(violations, readBaseline(config.baseline)), display: slashPath(cwd, config.baseline) };
      shown = violationsOver(violations, baseline.over);
    }
    const report = { fileCount: files.length, violations, shown, errors, baseline };
    stdout.write(options.json ? formatJson(report) : formatText(report));
    if (errors.length > 0) return 2;
    return shown.length > 0 ? 1 : 0;
  } catch (error) {
    if (error instanceof UsageError || error instanceof ConfigError) {
      stderr.write(`comment-lint: ${error.message}\n`);
      if (error instanceof UsageError) stderr.write(USAGE);
      return 2;
    }
    stderr.write(`comment-lint: internal error: ${error.stack}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2), process.cwd(), process.stdout, process.stderr);

module.exports = { main, parseArgs };
