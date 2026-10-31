"use strict";

// ControlApi (Adapter). The local API for Claude Code (client.js and board.js). See spec 4.4.
// It listens on 127.0.0.1 only, also in LAN mode, so only this computer can post Answers (R-004).

const http = require("http");
const { AppError } = require("./app-error");
const { sendJson, readBody, parseJsonBody, sendError } = require("./http-util");

const HOST = "127.0.0.1";
const MAX_BODY_BYTES = 1024 * 1024;

// @purity pure
function validateAnswer(request, maxTextChars) {
  const text = request && request.text;
  if (typeof text !== "string" || text.trim() === "" || text.length > maxTextChars) {
    return new AppError("InvalidText", 400, `text must be 1 to ${maxTextChars} characters and not blank`);
  }
  const at = request.at;
  if (at !== undefined && !(at && Number.isFinite(at.x) && Number.isFinite(at.y))) {
    return new AppError("InvalidAt", 400, "at must be {\"x\": number, \"y\": number}");
  }
  return null;
}

// Browsers send an Origin header; client.js does not. A web page must not use this API,
// and a Host other than ours means DNS rebinding.
// @purity pure
function isLocalTool(req, port) {
  if (req.headers.origin !== undefined) return false;
  const host = String(req.headers.host || "");
  return host === `${HOST}:${port}` || host === `localhost:${port}`;
}

// @purity non-pure
function within(promise, ms, clock) {
  return new Promise((resolve, reject) => {
    const timer = clock.setTimeout(() => resolve({ timedOut: true }), ms);
    promise.then(
      (value) => { clock.clearTimeout(timer); resolve({ timedOut: false, value }); },
      (error) => { clock.clearTimeout(timer); reject(error); },
    );
  });
}

// handlers: { status(), board(), say(text, at) -> { jobId, done }, shot(focusId) -> Promise<{ path }>,
//             signal(state), stop(),
//             draw(body), mermaid(body), edit(body) -> Promise<reply>, delete(body), undo(body) -> reply (0.5.0, spec 4.4) }
// @purity non-pure
function createControlApi({ handlers, maxTextChars, sayWaitMs, redact, clock }) {
  let port = 0;

  // @purity non-pure
  async function route(req) {
    if (!isLocalTool(req, port)) throw new AppError("NotLocal", 403, "only local tools may use this API");
    const key = `${req.method} ${req.url}`;
    switch (key) {
      case "GET /v1/status":
        return [200, handlers.status()];
      case "GET /v1/board":
        return [200, handlers.board()];
      case "POST /v1/say": {
        const request = parseJsonBody(await readBody(req, MAX_BODY_BYTES), false);
        const invalid = validateAnswer(request, maxTextChars);
        if (invalid) throw invalid;
        const at = request.at ? { x: request.at.x, y: request.at.y } : null;
        const queued = handlers.say(request.text, at);
        const result = await within(queued.done, sayWaitMs, clock);
        if (result.timedOut) return [202, { queued: true, jobId: queued.jobId, pageCount: handlers.status().pageCount }];
        return [200, result.value];
      }
      case "POST /v1/shot": {
        const request = parseJsonBody(await readBody(req, MAX_BODY_BYTES), true);
        return [200, await handlers.shot(request.focusId)];
      }
      case "POST /v1/signal": {
        const request = parseJsonBody(await readBody(req, MAX_BODY_BYTES), false);
        handlers.signal(String(request.state || ""));
        return [200, { state: request.state }];
      }
      // Operations by Claude (0.5.0). The handlers check the body; draw, mermaid, and edit wait for the Leader.
      case "POST /v1/draw":
      case "POST /v1/mermaid":
      case "POST /v1/edit":
      case "POST /v1/delete":
      case "POST /v1/undo": {
        const request = parseJsonBody(await readBody(req, MAX_BODY_BYTES), key === "POST /v1/undo");
        const name = key.slice("POST /v1/".length);
        return [200, await handlers[name](request)];
      }
      case "POST /v1/stop":
        clock.setTimeout(handlers.stop, 0);
        return [202, {}];
      default:
        throw new AppError("NotFound", 404, `no route for ${key}`);
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const [status, body] = await route(req);
      sendJson(res, status, body);
    } catch (error) {
      sendError(res, error, redact);
    }
  });

  return Object.freeze({
    // @purity non-pure
    listen(wantedPort) {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(wantedPort, HOST, () => {
          port = server.address().port;
          resolve(port);
        });
      });
    },
    // @purity non-pure
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  });
}

module.exports = { createControlApi, validateAnswer, isLocalTool };
