"use strict";

// Small HTTP helpers shared by the Board API and the Control API.

const crypto = require("crypto");
const { AppError } = require("./app-error");
const { SCHEMA_VERSION } = require("./event-sink");

// @purity non-pure
function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify({ v: SCHEMA_VERSION, ...body }));
}

// @purity non-pure
async function readBody(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new AppError("TooLarge", 413, `body is larger than ${maxBytes} bytes`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// @purity pure
function parseJsonBody(text, allowEmpty) {
  if (text.trim() === "" && allowEmpty) return {};
  try {
    const value = JSON.parse(text);
    if (value === null || typeof value !== "object") throw new Error("not an object");
    return value;
  } catch (error) {
    throw new AppError("InvalidJson", 400, "body is not a valid JSON object");
  }
}

// Compares in constant time, so the time of a wrong guess says nothing about the Token.
// @purity pure
function sameSecret(given, expected) {
  if (typeof given !== "string") return false;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

// @purity non-pure
function sendError(res, error, redact) {
  const message = redact(String(error && error.message));
  if (error instanceof AppError) sendJson(res, error.status, { ...(error.details || {}), error: error.code, message });
  else sendJson(res, 500, { error: "Internal", message });
}

module.exports = { sendJson, readBody, parseJsonBody, sameSecret, sendError };
