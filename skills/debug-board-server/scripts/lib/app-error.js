"use strict";

// Error with a code from spec 4.8 and the HTTP status that goes with it.
// `details` are extra reply fields, for example { index, field } or { ids } (spec 4.8).
class AppError extends Error {
  // @purity pure
  constructor(code, status, message, details = null) {
    super(message || code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

module.exports = { AppError };
