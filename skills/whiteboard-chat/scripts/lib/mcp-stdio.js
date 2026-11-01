"use strict";

// McpStdio (Adapter). JSON-RPC 2.0 over standard input and output, one JSON object per line (spec 4.12.1,
// FR-125, FR-126). Answers initialize, ping, tools/list, and tools/call; everything else gets "method not found".
// It writes only JSON-RPC messages to standard output (FR-126).

const SUPPORTED_VERSIONS = Object.freeze(["2025-06-18", "2025-03-26", "2024-11-05"]);
const LATEST_VERSION = SUPPORTED_VERSIONS[0];
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

// The protocol version for an initialize request (FR-127).
// @purity pure
function chooseVersion(asked) {
  return SUPPORTED_VERSIONS.includes(asked) ? asked : LATEST_VERSION;
}

// server: { name, version, instructions, tools: [{ name, description, inputSchema }], callTool(name, args) -> Promise<result> }.
// io: { input (readable), output (writable), log(line) }. Returns a Promise that resolves when input ends.
// @purity non-pure
function serveStdio(server, io) {
  const write = (message) => io.output.write(`${JSON.stringify(message)}\n`);
  const reply = (id, result) => write({ jsonrpc: "2.0", id, result });
  const fail = (id, code, message) => write({ jsonrpc: "2.0", id, error: { code, message } });
  const pending = new Set();

  // @purity non-pure
  async function handle(message) {
    if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      if (message && message.id !== undefined) fail(message.id, INVALID_REQUEST, "not a JSON-RPC 2.0 request");
      return;
    }
    const isNotification = message.id === undefined || message.id === null;
    if (isNotification) return;
    const params = message.params || {};
    switch (message.method) {
      case "initialize":
        reply(message.id, {
          protocolVersion: chooseVersion(params.protocolVersion),
          capabilities: { tools: {} },
          serverInfo: { name: server.name, version: server.version },
          instructions: server.instructions,
        });
        return;
      case "ping":
        reply(message.id, {});
        return;
      case "tools/list":
        reply(message.id, { tools: server.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
        return;
      case "tools/call": {
        try {
          reply(message.id, await server.callTool(String(params.name || ""), params.arguments || {}));
        } catch (error) {
          io.log(`tools/call failed: ${error && error.message}`);
          fail(message.id, INTERNAL_ERROR, String((error && error.message) || error));
        }
        return;
      }
      default:
        fail(message.id, METHOD_NOT_FOUND, `method ${message.method} not found`);
    }
  }

  return new Promise((resolve) => {
    let buffer = "";
    io.input.setEncoding("utf8");
    io.input.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const raw of lines) {
        const line = raw.replace(/\r$/, "").trim();
        if (line === "") continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch (error) {
          fail(null, PARSE_ERROR, "the line is not JSON");
          continue;
        }
        const job = handle(message).catch((error) => io.log(`internal error: ${error && error.message}`));
        pending.add(job);
        job.finally(() => pending.delete(job));
      }
    });
    io.input.on("end", async () => {
      await Promise.all([...pending]);
      resolve();
    });
  });
}

module.exports = { serveStdio, chooseVersion, SUPPORTED_VERSIONS };
