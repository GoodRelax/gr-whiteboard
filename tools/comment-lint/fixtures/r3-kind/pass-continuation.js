"use strict";

// Why: A unit may run over several lines,
// and the lines after the first need no kind.
// @purity pure
function identity(value) {
  return value;
}

module.exports = { identity };
