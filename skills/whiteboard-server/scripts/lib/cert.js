"use strict";

// The certificates of LAN mode (spec FR-047, FR-155 to FR-158; ruling R-040).
// 0.6.1: a small certificate authority (CA) of this board signs the server certificate. The CA may sign only
// for localhost, 127.0.0.0/8, and the private networks (nameConstraints), so the user can trust it once,
// and a new LAN address needs only a new server certificate. Node makes the keys; node-forge (BSD-3-Clause)
// makes and signs the certificates.

const crypto = require("crypto");

const DAY_MS = 24 * 60 * 60 * 1000;
// Browsers refuse server certificates that are valid for longer than 398 days.
const VALID_DAYS = 397;
const CA_VALID_DAYS = 3650;
const RENEW_BEFORE_DAYS = 7;
const CA_NAME = "Whiteboard Chat local CA";
const SERVER_NAME = "Whiteboard Chat board";
// The names that the CA may sign for (R-040): [address, mask].
const PERMITTED_NETWORKS = Object.freeze([
  ["127.0.0.0", "255.0.0.0"],
  ["10.0.0.0", "255.0.0.0"],
  ["172.16.0.0", "255.240.0.0"],
  ["192.168.0.0", "255.255.0.0"],
]);
const PERMITTED_HOSTS = Object.freeze(["localhost"]);

// @purity pure
function ipToNumber(ip) {
  return ip.split(".").reduce((sum, part) => sum * 256 + Number(part), 0);
}

// True for an IPv4 address inside one of PERMITTED_NETWORKS. Only such addresses go into the server
// certificate: an address outside the name constraints would make the whole certificate invalid.
// @purity pure
function isPermittedAddress(ip) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return false;
  const value = ipToNumber(ip);
  return PERMITTED_NETWORKS.some(([net, mask]) => {
    const size = 2 ** 32 - ipToNumber(mask);
    return Math.floor(value / size) === Math.floor(ipToNumber(net) / size);
  });
}

// @purity pure
function ipBytes(ip) {
  return String.fromCharCode(...ip.split(".").map(Number));
}

// The nameConstraints extension (RFC 5280 4.2.1.10): permitted subtrees only.
// @purity pure
function nameConstraints(forge) {
  const { asn1 } = forge;
  const subtree = (generalName) => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [generalName]);
  const subtrees = [
    ...PERMITTED_HOSTS.map((host) => subtree(asn1.create(asn1.Class.CONTEXT_SPECIFIC, 2, false, host))),
    ...PERMITTED_NETWORKS.map(([net, mask]) => subtree(asn1.create(asn1.Class.CONTEXT_SPECIFIC, 7, false, ipBytes(net) + ipBytes(mask)))),
  ];
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, subtrees),
  ]);
}

// @purity semi-pure-b
function newKey(forge) {
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const keyPem = privateKey.export({ type: "pkcs1", format: "pem" });
  return { keyPem, forgeKey: forge.pki.privateKeyFromPem(keyPem) };
}

// A positive serial number of 16 bytes: the first hex digit is below 8. An even number of hex digits,
// so the serial read back from the certificate is the same text (setup compares it, FR-156).
// @purity semi-pure-b
function newSerial() {
  return `1${crypto.randomBytes(16).toString("hex").slice(1)}`;
}

// Makes the CA of this board (R-040). Its name has a random part, so two boards never share a name.
// @purity semi-pure-b
function createBoardCa(forge, { nowMs }) {
  const { keyPem, forgeKey } = newKey(forge);
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.setRsaPublicKey(forgeKey.n, forgeKey.e);
  cert.serialNumber = newSerial();
  cert.validity.notBefore = new Date(nowMs - DAY_MS);
  cert.validity.notAfter = new Date(nowMs + CA_VALID_DAYS * DAY_MS);
  const subject = [{ name: "commonName", value: `${CA_NAME} ${crypto.randomBytes(3).toString("hex")}` }];
  cert.setSubject(subject);
  cert.setIssuer(subject);
  cert.setExtensions([
    { name: "basicConstraints", cA: true, pathLenConstraint: 0, critical: true },
    { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true },
    { id: "2.5.29.30", critical: true, value: nameConstraints(forge) },
    { name: "subjectKeyIdentifier" },
  ]);
  cert.sign(forgeKey, forge.md.sha256.create());
  return { caCertPem: forge.pki.certificateToPem(cert), caKeyPem: keyPem, serial: cert.serialNumber };
}

// Makes the server certificate for localhost, 127.0.0.1, and the LAN addresses inside the name constraints,
// signed by the CA. `certPem` holds the server certificate and then the CA (the chain).
// @purity semi-pure-b
function createServerCert(forge, { caCertPem, caKeyPem, addresses, nowMs }) {
  const ca = forge.pki.certificateFromPem(caCertPem);
  const caKey = forge.pki.privateKeyFromPem(caKeyPem);
  const { keyPem, forgeKey } = newKey(forge);
  const named = addresses.filter(isPermittedAddress);
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.setRsaPublicKey(forgeKey.n, forgeKey.e);
  cert.serialNumber = newSerial();
  cert.validity.notBefore = new Date(nowMs - DAY_MS);
  cert.validity.notAfter = new Date(nowMs + VALID_DAYS * DAY_MS);
  cert.setSubject([{ name: "commonName", value: SERVER_NAME }]);
  cert.setIssuer(ca.subject.attributes);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true },
    { name: "extKeyUsage", serverAuth: true },
    { name: "subjectKeyIdentifier" },
    { name: "authorityKeyIdentifier", keyIdentifier: ca.generateSubjectKeyIdentifier().getBytes() },
    {
      name: "subjectAltName",
      altNames: [
        { type: 2, value: "localhost" },
        { type: 7, ip: "127.0.0.1" },
        ...named.map((ip) => ({ type: 7, ip })),
      ],
    },
  ]);
  cert.sign(caKey, forge.md.sha256.create());
  return {
    certPem: forge.pki.certificateToPem(cert) + caCertPem,
    keyPem,
    info: { addresses, named, caSerial: ca.serialNumber, createdMs: nowMs, notAfterMs: cert.validity.notAfter.getTime() },
  };
}

// The server certificate must come from this CA, name every LAN address, and not expire soon.
// @purity pure
function certIsUsable(info, addresses, nowMs, caSerial) {
  if (!info || !Array.isArray(info.addresses)) return false;
  if (caSerial !== undefined && info.caSerial !== caSerial) return false;
  if (!(info.notAfterMs - nowMs > RENEW_BEFORE_DAYS * DAY_MS)) return false;
  return addresses.every((address) => info.addresses.includes(address));
}

// The command that the user runs once to trust the CA on this computer (FR-157). Claude never runs it.
// @purity pure
function trustCommand(platform, caPath) {
  if (platform === "win32") return `certutil -user -addstore Root "${caPath}"`;
  if (platform === "darwin") return `security add-trusted-cert -r trustRoot -k "$HOME/Library/Keychains/login.keychain-db" "${caPath}"`;
  return `import "${caPath}" as a certificate authority in your browser settings`;
}

module.exports = { createBoardCa, createServerCert, certIsUsable, isPermittedAddress, trustCommand, PERMITTED_NETWORKS };
