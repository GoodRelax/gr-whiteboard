"use strict";

// This comment has no kind.
// It runs over two lines.
// @purity pure
function identity(value) {
  return value; // returns the input
}

/* a block without a kind */
module.exports = { identity };
