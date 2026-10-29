"use strict";

// Makes the self-signed certificate for LAN mode (R-013 to R-015, spec FR-047).
// Node makes the key; node-forge (BSD-3-Clause) makes and signs the certificate.

const crypto = require("crypto");

const DAY_MS = 24 * 60 * 60 * 1000;
// Some browsers refuse certificates that are valid for longer than 398 days.
const VALID_DAYS = 397;
const COMMON_NAME = "Whiteboard Chat (self-signed)";

// @purity semi-pure-b
function createSelfSignedCert(forge, { addresses, nowMs }) {
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const keyPem = privateKey.export({ type: "pkcs1", format: "pem" });
  const forgeKey = forge.pki.privateKeyFromPem(keyPem);
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.setRsaPublicKey(forgeKey.n, forgeKey.e);
  // A positive serial number: the first hex digit is below 8.
  cert.serialNumber = "1" + crypto.randomBytes(15).toString("hex");
  cert.validity.notBefore = new Date(nowMs - DAY_MS);
  cert.validity.notAfter = new Date(nowMs + VALID_DAYS * DAY_MS);
  const subject = [{ name: "commonName", value: COMMON_NAME }];
  cert.setSubject(subject);
  cert.setIssuer(subject);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
    { name: "extKeyUsage", serverAuth: true },
    {
      name: "subjectAltName",
      altNames: [
        { type: 2, value: "localhost" },
        { type: 7, ip: "127.0.0.1" },
        ...addresses.map((ip) => ({ type: 7, ip })),
      ],
    },
  ]);
  cert.sign(forgeKey, forge.md.sha256.create());
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem,
    info: { addresses, createdMs: nowMs, notAfterMs: cert.validity.notAfter.getTime() },
  };
}

// The certificate must name every LAN address and must not expire soon.
// @purity pure
function certIsUsable(info, addresses, nowMs) {
  if (!info || !Array.isArray(info.addresses)) return false;
  if (!(info.notAfterMs - nowMs > 7 * DAY_MS)) return false;
  return addresses.every((address) => info.addresses.includes(address));
}

module.exports = { createSelfSignedCert, certIsUsable };
