"use strict";

// Temporary: The limit is fixed. Until: The config has a limit, version 2.
// @purity pure
function limit() {
  return 10;
}

// Temporary: The retry is simple and runs
// over two lines. Until: The retry policy is in the
// specification.
// @purity pure
function retry() {
  return 1;
}

module.exports = { limit, retry };
