"use strict";

// BoardApi (Adapter). Serves the page and talks with it. See spec 4.3.
//   GET  /                 the page (no Token needed: it holds no Board data)
//   GET  /app.js           the page script
//   GET  /api/stream       Server-Sent Events to one page (Token in the query, as EventSource has no headers)
//                          events: hello, elements, files, role, job, signal, inbox, ping, bye
//   POST /api/elements     changed elements from a page
//   POST /api/job          the result of a Job from the Leader page
//   POST /api/send         the Person pressed Send (FR-072)
//   POST /api/auto-send    the Person turned automatic sending on or off (FR-074)
//   POST /api/files        new image files from a page (FR-081)
//   POST /api/visibility   the page was shown or hidden (FR-085)

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { AppError } = require("./app-error");
const { sendJson, readBody, parseJsonBody, sameSecret, sendError } = require("./http-util");

const PAGE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_ELEMENTS_BYTES = 8 * 1024 * 1024;
const MAX_JOB_BYTES = 32 * 1024 * 1024;
// A few images at a time; each one is checked again in board-files.js.
const MAX_FILES_BYTES = 40 * 1024 * 1024;
const KEEP_ALIVE_MS = 20000;
const PAGE_ORIGIN = "https://esm.sh";

// The page loads React and Excalidraw from esm.sh (R-005). Nothing else may be loaded or called.
// @purity pure
function contentSecurityPolicy(importMapHash) {
  return [
    "default-src 'self'",
    `script-src 'self' ${PAGE_ORIGIN} 'sha256-${importMapHash}'`,
    `style-src 'self' 'unsafe-inline' ${PAGE_ORIGIN}`,
    `font-src 'self' data: ${PAGE_ORIGIN}`,
    "img-src 'self' data: blob:",
    `connect-src 'self' ${PAGE_ORIGIN}`,
    `worker-src 'self' blob: ${PAGE_ORIGIN}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

// @purity pure
function importMapOf(html) {
  const match = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html);
  return match ? match[1] : "";
}

// @purity semi-pure-b
function loadPageFiles(pageDir) {
  const html = fs.readFileSync(path.join(pageDir, "index.html"), "utf8");
  const script = fs.readFileSync(path.join(pageDir, "app.js"), "utf8");
  const hash = crypto.createHash("sha256").update(importMapOf(html)).digest("base64");
  return Object.freeze({ html, script, csp: contentSecurityPolicy(hash) });
}

// A request from another web site has another Origin. Pages of this Server send their own.
// @purity pure
function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch (error) {
    return false;
  }
}

// hub: BoardHub. token: the Token. redact(text) hides secrets.
// inbox: { send(pageId) -> { sent }, setAutoSend(on) } (the Send handling in server.js).
// @purity non-pure
function createBoardApi({ hub, inbox, token, pageDir, redact, clock, caDer = null, onActivity = () => {} }) {
  const files = loadPageFiles(pageDir);
  // pageId -> the open stream of that page. A page that connects again replaces its old stream.
  const streams = new Map();

  // @purity non-pure
  function sendFile(res, type, body) {
    res.writeHead(200, {
      "content-type": `${type}; charset=utf-8`,
      "cache-control": "no-store",
      "content-security-policy": files.csp,
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    });
    res.end(body);
  }

  // @purity non-pure
  function openStream(req, res, url) {
    if (!sameSecret(url.searchParams.get("t"), token)) throw new AppError("BadToken", 403, "wrong or missing token");
    const pageId = url.searchParams.get("page") || "";
    if (!PAGE_ID_PATTERN.test(pageId)) throw new AppError("BadPageId", 400, "page id is missing or wrong");
    // A Page that opens is a touch too (FR-159).
    onActivity();
    const old = streams.get(pageId);
    if (old) endStream(pageId, old);
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    });
    res.write("retry: 2000\n\n");
    // @purity non-pure
    const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    // A real event (not a comment), so the page can see that the stream is alive (FR-023a).
    const keepAlive = clock.setInterval(() => send("ping", {}), KEEP_ALIVE_MS);
    const stream = { res, keepAlive };
    streams.set(pageId, stream);
    req.on("close", () => {
      if (streams.get(pageId) === stream) endStream(pageId, stream);
    });
    hub.addPage(pageId, send, url.searchParams.get("visible") !== "0");
  }

  // @purity non-pure
  function endStream(pageId, stream) {
    clock.clearInterval(stream.keepAlive);
    streams.delete(pageId);
    hub.removePage(pageId);
    stream.res.end();
  }

  // @purity non-pure
  async function readPost(req, maxBytes) {
    if (!sameSecret(req.headers["x-board-token"], token)) throw new AppError("BadToken", 403, "wrong or missing token");
    if (!String(req.headers["content-type"] || "").startsWith("application/json")) {
      throw new AppError("BadContentType", 415, "content-type must be application/json");
    }
    return parseJsonBody(await readBody(req, maxBytes), false);
  }

  // @purity non-pure
  async function route(req, res) {
    const url = new URL(req.url, "http://localhost");
    const key = `${req.method} ${url.pathname}`;
    if (!isSameOrigin(req)) throw new AppError("BadOrigin", 403, "request from another site");
    switch (key) {
      case "GET /":
      case "GET /index.html":
        return sendFile(res, "text/html", files.html);
      case "GET /app.js":
        return sendFile(res, "text/javascript", files.script);
      case "GET /favicon.ico":
        res.writeHead(204);
        return res.end();
      // The CA of this board, for an iPad or another computer to trust (0.6.1, FR-156). It is a public
      // certificate (no key), so it needs no Token; it exists only in LAN mode.
      case "GET /ca.crt":
        if (!caDer) throw new AppError("NotFound", 404, "no CA certificate (LAN mode only)");
        res.writeHead(200, {
          "content-type": "application/x-x509-ca-cert",
          "content-disposition": "attachment; filename=\"whiteboard-chat-ca.crt\"",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        });
        return res.end(caDer);
      case "GET /api/stream":
        return openStream(req, res, url);
      // A Person touched the Page (keys, pointer); the Page sends this at most every 20 s (FR-159).
      case "POST /api/activity": {
        await readPost(req, MAX_ELEMENTS_BYTES);
        onActivity();
        return sendJson(res, 200, {});
      }
      case "POST /api/elements": {
        const body = await readPost(req, MAX_ELEMENTS_BYTES);
        onActivity();
        const changed = hub.receiveElements(String(body.page || ""), body.elements, body.editingId);
        return sendJson(res, 200, { changed });
      }
      case "POST /api/visibility": {
        const body = await readPost(req, MAX_ELEMENTS_BYTES);
        hub.setVisible(String(body.page || ""), body.visible === true);
        return sendJson(res, 200, {});
      }
      case "POST /api/files": {
        const body = await readPost(req, MAX_FILES_BYTES);
        onActivity();
        return sendJson(res, 200, hub.receiveFiles(String(body.page || ""), body.files));
      }
      case "POST /api/job": {
        const body = await readPost(req, MAX_JOB_BYTES);
        hub.finishJob(String(body.page || ""), body);
        return sendJson(res, 200, {});
      }
      case "POST /api/send": {
        const body = await readPost(req, MAX_ELEMENTS_BYTES);
        onActivity();
        return sendJson(res, 200, inbox.send(String(body.page || "")));
      }
      case "POST /api/auto-send": {
        const body = await readPost(req, MAX_ELEMENTS_BYTES);
        onActivity();
        inbox.setAutoSend(body.on === true);
        return sendJson(res, 200, { autoSend: body.on === true });
      }
      default:
        throw new AppError("NotFound", 404, `no route for ${key}`);
    }
  }

  // @purity non-pure
  async function handle(req, res) {
    try {
      await route(req, res);
    } catch (error) {
      if (!res.headersSent) sendError(res, error, redact);
      else res.end();
    }
  }

  // @purity non-pure
  function closeStreams() {
    for (const [pageId, stream] of [...streams]) endStream(pageId, stream);
  }

  return Object.freeze({ handle, closeStreams });
}

module.exports = { createBoardApi, contentSecurityPolicy, importMapOf, isSameOrigin };
