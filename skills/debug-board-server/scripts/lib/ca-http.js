"use strict";

// CaHttp (Adapter). LAN mode only (0.7.1, NG-3, FR-166): a plain http server on its own port that gives
// the CA certificate of the board, and nothing else. iPad Safari does not install a profile from an https
// page that it does not trust yet, so the CA file must come over http. The file is public (no key).

const dgram = require("dgram");
const http = require("http");

// @purity non-pure
function createCaHttpServer(caDer) {
  return http.createServer((req, res) => {
    const pathname = String(req.url || "").split("?")[0];
    if ((req.method === "GET" || req.method === "HEAD") && pathname === "/ca.crt") {
      res.writeHead(200, {
        "content-type": "application/x-x509-ca-cert",
        "content-length": caDer.length,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      res.end(req.method === "HEAD" ? undefined : caDer);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" });
    res.end("not found\n");
  });
}

// The local address that the default route uses, or null (FR-163). A UDP socket that only connects sends
// no packet; the system picks the interface of the route. 192.0.2.1 is a documentation address.
// @purity non-pure
function defaultRouteAddress() {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    const done = (value) => {
      try {
        socket.close();
      } catch (error) {
        // Already closed.
      }
      resolve(value);
    };
    socket.on("error", () => done(null));
    try {
      socket.connect(9, "192.0.2.1", () => {
        try {
          done(socket.address().address);
        } catch (error) {
          done(null);
        }
      });
    } catch (error) {
      done(null);
    }
  });
}

module.exports = { createCaHttpServer, defaultRouteAddress };
