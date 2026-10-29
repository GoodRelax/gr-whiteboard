"use strict";

// Error with a code from spec 4.8 and the HTTP status that goes with it.
class AppError extends Error {
  // @purity pure
  constructor(code, status, message) {
    super(message || code);
    this.code = code;
    this.status = status;
  }
}

module.exports = { AppError };
