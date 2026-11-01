"use strict";

// EventSink (Adapter). Writes one Event per line. Removes secrets first (NFR-005).

const SCHEMA_VERSION = 1;
const REDACTED = "[redacted]";

// @purity pure
function redact(text, secrets) {
  let out = text;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join(REDACTED);
  }
  return out;
}

// `write` and `nowMs` are injected so tests can capture output and fix the clock.
// @purity non-pure
function createEventSink({ write, nowMs, secrets }) {
  return Object.freeze({
    // @purity non-pure
    emit(event) {
      const line = JSON.stringify({ v: SCHEMA_VERSION, ...event, atMs: nowMs() });
      write(redact(line, secrets) + "\n");
    },
  });
}

module.exports = { SCHEMA_VERSION, createEventSink, redact };
