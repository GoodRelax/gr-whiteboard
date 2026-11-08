"use strict";

// Summary: Checks a parsed config object and turns it into the options of the judge, or throws ConfigError.

const path = require("node:path");
const { BUILT_IN_KINDS } = require("./units");

class ConfigError extends Error {}

// @purity pure
function stringList(value, name, fallback) {
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ConfigError(`config: ${name} must be a list of strings`);
  }
  return value;
}

// @purity pure
function regExpOf(source, name) {
  try {
    return new RegExp(source);
  } catch (error) {
    throw new ConfigError(`config: ${name} is not a valid regular expression: ${error.message}`);
  }
}

// @purity pure
function extraKindOf(item, index) {
  const name = `extraKinds[${index}]`;
  if (item === null || typeof item !== "object" || typeof item.name !== "string" || typeof item.pattern !== "string") {
    throw new ConfigError(`config: ${name} must be { "name": string, "pattern": string, "continues"?: boolean }`);
  }
  return Object.freeze({ name: item.name, pattern: regExpOf(item.pattern, `${name}.pattern`), continues: item.continues === true });
}

// @purity pure
function normalizeConfig(raw, configDir) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new ConfigError("config: the top level must be an object");
  const root = path.resolve(configDir, typeof raw.root === "string" ? raw.root : ".");
  const extraKinds = (raw.extraKinds === undefined ? [] : raw.extraKinds);
  if (!Array.isArray(extraKinds)) throw new ConfigError("config: extraKinds must be a list");
  const spec = raw.spec === undefined ? {} : raw.spec;
  const purity = raw.purity === undefined ? {} : raw.purity;
  if (typeof spec.idPattern !== "string") throw new ConfigError("config: spec.idPattern must be a string");
  return Object.freeze({
    root,
    paths: stringList(raw.paths, "paths", ["."]),
    exclude: stringList(raw.exclude, "exclude", ["**/node_modules/**"]),
    kinds: Object.freeze([...BUILT_IN_KINDS, ...extraKinds.map(extraKindOf)]),
    allowShebang: raw.allowShebang !== false,
    licenseHeaderPattern: typeof raw.licenseHeaderPattern === "string" ? regExpOf(raw.licenseHeaderPattern, "licenseHeaderPattern") : null,
    specFiles: stringList(spec.files, "spec.files", []).map((file) => path.resolve(root, file)),
    specIdPattern: regExpOf(spec.idPattern, "spec.idPattern"),
    purityExclude: stringList(purity.exclude, "purity.exclude", []),
    exemptSingleExpressionLambdas: purity.exemptSingleExpressionLambdas !== false,
    baseline: typeof raw.baseline === "string" ? path.resolve(root, raw.baseline) : null,
  });
}

module.exports = { ConfigError, normalizeConfig };
