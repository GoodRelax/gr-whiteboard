"use strict";

// ControlClient (Adapter). Calls the Control API of the Board Server on 127.0.0.1 (spec 4.4).
// The CLI (client.js) and the MCP Server (mcp.js) both use it.

const http = require("http");

const DEFAULT_TIMEOUT_MS = 90000;

// Resolves to { status, text }. Rejects with the network error (for example ECONNREFUSED: no Server).
// @purity non-pure
function request(port, method, urlPath, body, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? "" : JSON.stringify(body);
    const req = http.request({
      host: "127.0.0.1", port, method, path: urlPath,
      headers: { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(data) },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      const error = new Error(`no reply within ${timeoutMs} ms`);
      error.code = "Timeout";
      req.destroy(error);
    });
    req.end(data);
  });
}

// Like request, with the reply parsed: { status, json } (json is null when the reply is not JSON).
// @purity non-pure
async function requestJson(port, method, urlPath, body, timeoutMs) {
  const reply = await request(port, method, urlPath, body, timeoutMs);
  let json = null;
  try {
    json = JSON.parse(reply.text);
  } catch (error) {
    json = null;
  }
  return { status: reply.status, json };
}

// True for the errors of a Control API that does not run (nothing listens on the port).
// @purity pure
function isNoServer(error) {
  return Boolean(error && ["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH"].includes(error.code));
}

// True when the Control API took longer than the timeout (the Server runs, but a Job did not end in time).
// @purity pure
function isTimeout(error) {
  return Boolean(error && error.code === "Timeout");
}

module.exports = { request, requestJson, isNoServer, isTimeout, DEFAULT_TIMEOUT_MS };
