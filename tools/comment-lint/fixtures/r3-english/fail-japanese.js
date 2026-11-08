"use strict";

// Why: ASCII first, then 日本語.
// @purity pure
function greet() {
  return "hello";
}

/* Why: A block comment
 * with an accent: café. */
module.exports = { greet };
