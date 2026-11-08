"use strict";

// Why: Only ASCII is used here, even in "quotes" and `code`; a string may hold any text.
// @purity pure
function greet() {
  return "こんにちは";
}

module.exports = { greet };
