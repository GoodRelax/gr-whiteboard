"use strict";

// Why: The fixture shows every built-in kind.
// Section: helpers
// Consistency: one call
// Summary: When called, double shall return twice its input.
// Spec: FR-001
// @purity pure
function double(value) {
  return value * 2;
}

// eslint-disable-next-line no-unused-vars
/* Why: A block comment can carry a kind too. */
/**
 * Summary: A JSDoc description starts with a kind.
 * @param {number} value the input
 * @returns {number} the output
 * @purity pure
 */
function triple(value) {
  return value * 3;
}

module.exports = { double, triple };
