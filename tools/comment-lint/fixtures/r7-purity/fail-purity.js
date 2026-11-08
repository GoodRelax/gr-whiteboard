"use strict";

function untagged() {
  return 1;
}

// @purity semi-pure-b
function legacy() {
  return 2;
}

// @purity pure
// @purity non-pure
function twice() {
  return 3;
}

// @purity impure
function unknown() {
  return 4;
}

// @purity
function empty() {
  return 5;
}

class Box {
  open() {
    this.isOpen = true;
    return this;
  }
}

// @purity pure
const value = 6;

// @purity pure
function outer(values) {
  return values.map((item) => {
    const next = item + 1;
    return next;
  });
}

module.exports = { untagged, legacy, twice, unknown, empty, Box, value, outer };
