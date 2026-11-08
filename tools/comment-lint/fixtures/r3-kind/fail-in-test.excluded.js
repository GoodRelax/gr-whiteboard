"use strict";

// Why: This file stands for test code (*.excluded.js); test code stays under the R3 comment rules.
const test = require("node:test");

// Given no files, when the tool runs, then it reads nothing
test("the tool reads no files", () => {
  const files = [];
  return files;
});
