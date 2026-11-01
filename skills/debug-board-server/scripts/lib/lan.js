"use strict";

// LAN addresses and the Board URLs. See spec FR-044 to FR-046.

// `interfaces` is the result of os.networkInterfaces(), passed in so this function stays pure.
// @purity pure
function lanAddresses(interfaces) {
  const addresses = [];
  for (const list of Object.values(interfaces || {})) {
    for (const info of list || []) {
      const isV4 = info.family === "IPv4" || info.family === 4;
      if (isV4 && !info.internal && !info.address.startsWith("169.254.")) addresses.push(info.address);
    }
  }
  return [...new Set(addresses)].sort();
}

// The Token is in the part after "#", so the browser does not send it with the page request
// and it does not appear in a Referer header.
// @purity pure
function boardUrls({ lan, port, token, addresses }) {
  const fragment = `/#t=${token}`;
  if (!lan) return { local: `http://127.0.0.1:${port}${fragment}`, lan: [] };
  return {
    local: `https://localhost:${port}${fragment}`,
    lan: addresses.map((address) => `https://${address}:${port}${fragment}`),
  };
}

module.exports = { lanAddresses, boardUrls };
