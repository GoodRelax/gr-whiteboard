"use strict";

// Temporary: The limit is fixed.
// @purity pure
function limit() {
  return 10;
}

// Temporary: Until: Later.
// @purity pure
function soon() {
  return 1;
}

// Temporary: The retry is simple. Until:
// @purity pure
function retry() {
  return 1;
}

module.exports = { limit, soon, retry };
