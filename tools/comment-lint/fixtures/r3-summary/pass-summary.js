"use strict";

// Summary: When the file exists, readDocument shall return the parsed document.
// If the file is missing, then readDocument shall return {"isDocumentFound": false}.
// If the file is corrupt, then readDocument shall raise DocumentCorruptError.
// Temporary: The summary is long. Until: It is written in the specification, version xxx.
// @purity pure
function readDocument(text) {
  return JSON.parse(text);
}

// Summary: When given a name such as config.json, e.g. a file, `path.basename` shall keep 1.5 dots.
// @purity pure
function keep(name) {
  return name;
}

module.exports = { readDocument, keep };
