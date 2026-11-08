"use strict";

// @purity pure
function add(a, b) {
  return a + b;
}

// @purity semi-pure-immutable
const readLimit = (settings) => {
  const limit = settings.limit;
  return limit;
};

class Clock {
  // @purity semi-pure-mutable
  now() {
    return Date.now();
  }

  /** @purity non-pure */
  reset() {
    this.count = 0;
    return this;
  }
}

const handlers = {
  // @purity non-pure
  log(message) {
    process.stdout.write(message);
    process.stdout.write("\n");
  },
};

// @purity pure
function doubleAll(values) {
  const doubled = values.map((value) => value * 2);
  values.forEach(() => {});
  return doubled.filter(function (value) { return value > 0; });
}

// @purity pure
function sumAll(values) {
  return values.reduce((sum, value) => {
    // @purity pure
    const next = sum + value;
    return next;
  }, 0);
}

module.exports = { add, readLimit, Clock, handlers, doubleAll, sumAll };
